import { describe, expect, it } from 'vitest';
import { runPatchToRow, runToRow } from '@/lib/database/mappers';

describe('run row mapping', () => {
  it('translates only the keys a partial patch contains', () => {
    // The level-15 auto-claim writes just this patch; it must not null out the
    // randomness commitment or any other column it does not mention.
    expect(runPatchToRow({ claimedLevel: 15 })).toEqual({ claimed_level: 15 });
  });

  it('keeps explicit nulls, which are deliberate writes', () => {
    expect(runPatchToRow({ finishedAt: null, status: 'ACTIVE' })).toEqual({ finished_at: null, status: 'ACTIVE' });
  });

  it('maps a full run the same way as an insert row', () => {
    const run = {
      id: 'r1',
      userId: 'u1',
      isGuest: false,
      roomKey: 'practice',
      championKey: 'pyra',
      opponentKey: 'nova',
      mode: 'demo',
      entryFee: '0',
      currency: 'credits',
      status: 'ACTIVE',
      level: 2,
      streak: 2,
      roundNumber: 3,
      resolvedRounds: 2,
      ties: 1,
      wins: 2,
      losses: 0,
      claimedLevel: null,
      claimedAt: null,
      finishedAt: null,
      requiresPayment: false,
      entryTxHash: null,
      randomnessCommitment: 'abc',
      randomnessProvider: 'simulated-v1',
      createdAt: 't0',
      updatedAt: 't1',
    };
    expect(runPatchToRow(run)).toEqual(runToRow(run));
  });

  it('drops keys that are not run columns', () => {
    expect(runPatchToRow({ level: 1, odds: { level: 1 }, canPlay: true })).toEqual({ level: 1 });
  });
});
