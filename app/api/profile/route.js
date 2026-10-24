import { withApi } from '@/lib/security/apiHandler';
import { getActor, requireActor } from '@/lib/auth/session';
import { getRepository } from '@/lib/database/repository';
import { parseBody, profileSchema } from '@/lib/security/validation';
import { AUDIT_EVENTS, audit, ipFrom } from '@/lib/security/audit';
import { getPlayerRank } from '@/services/leaderboardService';
import { RUN_STATUS, isTerminal } from '@/lib/game/stateMachine';

export const dynamic = 'force-dynamic';

/** Enough to cover any real history; stats must not stop at the recent list. */
const STATS_RUN_LIMIT = 5000;
const RECENT_RUNS = 10;

/**
 * Lifetime stats for the profile and its achievements. Runs arrive newest
 * first; `cleanClaimStreak` is the longest stretch of claims with no lost run
 * in between.
 */
function summariseRuns(runs, earned) {
  const stats = {
    runs: 0,
    finishedRuns: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    bestLevel: 0,
    longestStreak: 0,
    claimed: 0,
    cleanClaimStreak: 0,
  };
  let streak = 0;
  for (const run of [...runs].reverse()) {
    stats.runs += 1;
    stats.wins += run.wins;
    stats.losses += run.losses;
    stats.ties += run.ties;
    stats.bestLevel = Math.max(stats.bestLevel, run.claimedLevel ?? run.level);
    // A loss ends a run, so its wins were all consecutive.
    stats.longestStreak = Math.max(stats.longestStreak, run.wins);
    if (isTerminal(run.status)) stats.finishedRuns += 1;
    if (run.status === RUN_STATUS.CLAIMED) {
      stats.claimed += 1;
      streak += 1;
      stats.cleanClaimStreak = Math.max(stats.cleanClaimStreak, streak);
    } else if (run.status === RUN_STATUS.LOST) {
      streak = 0;
    }
  }
  stats.distinctTiers = new Set(earned.map((reward) => reward.reward_level)).size;
  return stats;
}

export const GET = withApi(
  async () => {
    const actor = await getActor();
    if (!actor) return { profile: null };
    const repo = getRepository();
    const [wallets, earned, runs, rank] = await Promise.all([
      repo.listWallets(actor.userId),
      repo.listEarnedRewards({ userId: actor.userId, limit: STATS_RUN_LIMIT }),
      repo.listRuns({ userId: actor.userId, limit: STATS_RUN_LIMIT }),
      getPlayerRank({ userId: actor.userId }),
    ]);

    return {
      profile: actor.profile,
      session: { userId: actor.userId, isGuest: actor.isGuest, email: actor.email },
      wallets,
      earnedCount: earned.length,
      recentRuns: runs.slice(0, RECENT_RUNS),
      rank,
      stats: summariseRuns(runs, earned),
    };
  },
  { name: 'profile-get', limit: 120 }
);

export const PATCH = withApi(
  async ({ request, body }) => {
    const input = parseBody(profileSchema, body);
    const actor = await requireActor();
    const profile = await getRepository().upsertProfile({
      id: actor.userId,
      display_name: input.displayName,
      champion_key: input.championKey,
      avatar_seed: input.avatarSeed,
      is_guest: actor.isGuest,
    });
    await audit(AUDIT_EVENTS.PROFILE_UPDATED, { userId: actor.userId, ip: ipFrom(request) });
    return { profile };
  },
  { name: 'profile-patch', limit: 30 }
);
