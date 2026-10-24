import { Interface, JsonRpcProvider, formatEther, id, parseEther } from 'ethers';
import { getChain } from '@/config/chains';
import { publicEnv } from '@/config/env';

/**
 * Server-side verification of an entry-fee transaction.
 *
 * The client tells us a transaction hash; that claim is worthless on its own.
 * This reads the receipt from an RPC node and requires the arena contract's own
 * `GameEntered` event for *this* run, room, and player. Binding to the run id
 * is what stops one payment from being replayed to activate several runs — the
 * contract refuses a second entry for the same run id.
 */

const ARENA_EVENTS = new Interface([
  'event GameEntered(bytes32 indexed runId, address indexed player, bytes32 indexed roomKey, uint256 entryFee, uint256 nonce)',
]);

/** The bytes32 the arena contract stores for an off-chain run id. */
export const onChainRunId = (runId) => id(String(runId));

/** The bytes32 the arena contract uses for a room, e.g. keccak256("bronze"). */
export const onChainRoomKey = (roomKey) => id(String(roomKey));

const providers = new Map();

function providerFor(chainId) {
  const chain = getChain(chainId);
  if (!chain) return null;
  const rpcUrl = process.env.RPC_URL_OVERRIDE || chain.rpcUrls[0];
  if (!providers.has(chainId)) providers.set(chainId, new JsonRpcProvider(rpcUrl, chainId));
  return providers.get(chainId);
}

export class ChainVerificationError extends Error {
  constructor(message, code = 'CHAIN_VERIFICATION_FAILED', status = 400) {
    super(message);
    this.name = 'ChainVerificationError';
    this.code = code;
    this.status = status;
  }
}

/** Finds the arena's GameEntered log in a receipt, or null. */
function findEntryLog(receipt, arena) {
  for (const log of receipt.logs || []) {
    if (log.address?.toLowerCase() !== arena) continue;
    try {
      const parsed = ARENA_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'GameEntered') return parsed;
    } catch {
      // A different event from the same contract.
    }
  }
  return null;
}

/**
 * @param {object} input
 * @param {string} input.runId off-chain run id; must match the event's runId
 * @param {string} input.roomKey room key; must match the event's roomKey
 * @param {string[]} input.allowedPlayers linked wallet addresses (any case)
 */
export async function verifyEntryPayment({
  txHash,
  chainId,
  runId,
  roomKey,
  expectedFee,
  allowedPlayers = [],
  minConfirmations = 1,
}) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    throw new ChainVerificationError('Transaction hash is malformed.', 'BAD_TX_HASH');
  }

  // Without a known arena address any transfer to anyone would pass, so refuse
  // outright rather than skip the recipient check.
  const arena = publicEnv.arenaContract?.toLowerCase();
  if (!arena) {
    throw new ChainVerificationError(
      'Paid entry is unavailable: NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS is not configured.',
      'ARENA_NOT_CONFIGURED',
      503
    );
  }

  const chain = getChain(chainId);
  if (chain && !chain.testnet && !publicEnv.allowMainnet) {
    throw new ChainVerificationError('Mainnet is disabled in this deployment.', 'MAINNET_DISABLED');
  }

  const provider = providerFor(chainId);
  if (!provider) throw new ChainVerificationError(`Unsupported chain id ${chainId}.`, 'UNSUPPORTED_CHAIN');

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new ChainVerificationError('Transaction not found yet. Wait for it to be mined and retry.', 'TX_PENDING');
  if (receipt.status !== 1) throw new ChainVerificationError('The entry transaction reverted on chain.', 'TX_REVERTED');

  const confirmations = await receipt.confirmations();
  if (confirmations < minConfirmations) {
    throw new ChainVerificationError('Transaction needs more confirmations. Try again in a moment.', 'TX_UNCONFIRMED');
  }

  const entry = findEntryLog(receipt, arena);
  if (!entry) {
    throw new ChainVerificationError('Transaction did not enter a game on the arena contract.', 'WRONG_RECIPIENT');
  }
  if (entry.args.runId.toLowerCase() !== onChainRunId(runId).toLowerCase()) {
    throw new ChainVerificationError('That entry payment belongs to a different run.', 'WRONG_RUN');
  }
  if (entry.args.roomKey.toLowerCase() !== onChainRoomKey(roomKey).toLowerCase()) {
    throw new ChainVerificationError('That entry payment was made for a different arena.', 'WRONG_ROOM');
  }

  const player = entry.args.player.toLowerCase();
  const allowed = allowedPlayers.filter(Boolean).map((address) => address.toLowerCase());
  if (!allowed.includes(player)) {
    throw new ChainVerificationError('Transaction was sent from a wallet that is not linked to your account.', 'WRONG_SENDER');
  }

  const paid = entry.args.entryFee;
  const required = parseEther(String(expectedFee));
  if (paid < required) {
    throw new ChainVerificationError(
      `Entry fee underpaid: sent ${formatEther(paid)}, required ${expectedFee}.`,
      'UNDERPAID'
    );
  }

  return {
    verified: true,
    txHash,
    from: player,
    value: formatEther(paid),
    blockNumber: receipt.blockNumber,
    confirmations,
  };
}

export async function getNativeBalance({ address, chainId }) {
  const provider = providerFor(chainId);
  if (!provider) return null;
  const balance = await provider.getBalance(address);
  return formatEther(balance);
}
