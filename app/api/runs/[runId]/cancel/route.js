import { z } from 'zod';
import { withApi } from '@/lib/security/apiHandler';
import { parseBody, uuidSchema } from '@/lib/security/validation';
import { requireActor } from '@/lib/auth/session';
import { abandonRun } from '@/services/runService';
import { ipFrom } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

/** Abandons an unfinished run so the player can start a fresh one. */
export const POST = withApi(
  async ({ request, context }) => {
    const { runId } = await context.params;
    parseBody(z.object({ runId: uuidSchema }), { runId });
    const actor = await requireActor();
    return abandonRun({ actor, runId, ip: ipFrom(request) });
  },
  { name: 'run-cancel', limit: 30 }
);
