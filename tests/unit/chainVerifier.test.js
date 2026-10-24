import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, id, parseEther } from 'ethers';

const ARENA = '0x1111111111111111111111111111111111111111';
const PLAYER = '0x2222222222222222222222222222222222222222';
const STRANGER = '0x3333333333333333333333333333333333333333';
const TX = `0x${'ab'.repeat(32)}`;

const chain = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111';
  return { receipt: null };
});

// No network in unit tests: the RPC provider hands back whatever receipt the
// test scripted.
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal();
  class ScriptedProvider {
    async getTransactionReceipt() {
      return chain.receipt;
    }
  }
  return { ...actual, JsonRpcProvider: ScriptedProvider };
});

const { verifyEntryPayment } = await import('@/lib/wallet/chainVerifier');

const ARENA_EVENTS = new Interface([
  'event GameEntered(bytes32 indexed runId, address indexed player, bytes32 indexed roomKey, uint256 entryFee, uint256 nonce)',
]);

function entryReceipt({ runId, roomKey = 'bronze', player = PLAYER, fee = '0.01', address = ARENA, status = 1 }) {
  const { topics, data } = ARENA_EVENTS.encodeEventLog('GameEntered', [id(runId), player, id(roomKey), parseEther(fee), 0n]);
  return { status, blockNumber: 42, confirmations: async () => 3, logs: [{ address, topics, data }] };
}

const verify = (overrides = {}) =>
  verifyEntryPayment({
    txHash: TX,
    chainId: 2021,
    runId: 'run-a',
    roomKey: 'bronze',
    expectedFee: '0.01',
    allowedPlayers: [PLAYER],
    ...overrides,
  });

describe('entry payment verification', () => {
  beforeEach(() => {
    chain.receipt = null;
  });

  it('accepts the arena entry event for this run, room, and linked wallet', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a' });
    await expect(verify()).resolves.toMatchObject({ verified: true, from: PLAYER, value: '0.01' });
  });

  it('refuses to reuse one payment for a different run', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a' });
    await expect(verify({ runId: 'run-b' })).rejects.toMatchObject({ code: 'WRONG_RUN' });
  });

  it('refuses a payment made for a different arena', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a', roomKey: 'silver' });
    await expect(verify()).rejects.toMatchObject({ code: 'WRONG_ROOM' });
  });

  it('accepts any linked wallet and refuses an unlinked one', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a', player: PLAYER });
    await expect(verify({ allowedPlayers: [STRANGER, PLAYER.toUpperCase().replace('0X', '0x')] })).resolves.toBeTruthy();
    await expect(verify({ allowedPlayers: [STRANGER] })).rejects.toMatchObject({ code: 'WRONG_SENDER' });
  });

  it('refuses an underpaid entry', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a', fee: '0.001' });
    await expect(verify()).rejects.toMatchObject({ code: 'UNDERPAID' });
  });

  it('ignores lookalike events emitted by other contracts', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a', address: STRANGER });
    await expect(verify()).rejects.toMatchObject({ code: 'WRONG_RECIPIENT' });
  });

  it('refuses a reverted transaction', async () => {
    chain.receipt = entryReceipt({ runId: 'run-a', status: 0 });
    await expect(verify()).rejects.toMatchObject({ code: 'TX_REVERTED' });
  });

  it('refuses outright when no arena contract is configured', async () => {
    vi.resetModules();
    const previous = process.env.NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS;
    process.env.NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS = '';
    try {
      const fresh = await import('@/lib/wallet/chainVerifier');
      chain.receipt = entryReceipt({ runId: 'run-a' });
      await expect(
        fresh.verifyEntryPayment({ txHash: TX, chainId: 2021, runId: 'run-a', roomKey: 'bronze', expectedFee: '0.01', allowedPlayers: [PLAYER] })
      ).rejects.toMatchObject({ code: 'ARENA_NOT_CONFIGURED', status: 503 });
    } finally {
      process.env.NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS = previous;
    }
  });
});
