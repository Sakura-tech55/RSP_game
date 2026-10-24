import { withApi } from '@/lib/security/apiHandler';
import { parseBody, createRunSchema } from '@/lib/security/validation';
import { getActor, requireActor } from '@/lib/auth/session';
import { getActiveRun, startRun } from '@/services/runService';
import { ipFrom } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

/** The caller's unfinished run in `?room=`, so reopening the arena resumes it. */
export const GET = withApi(
  async ({ request }) => {
    const { roomKey } = parseBody(createRunSchema.pick({ roomKey: true }), {
      roomKey: new URL(request.url).searchParams.get('room'),
    });
    const actor = await getActor();
    if (!actor) return { run: null };
    return getActiveRun({ actor, roomKey });
  },
  { name: 'run-active', limit: 120 }
);

export const POST = withApi(
  async ({ request, body }) => {
    const { roomKey, championKey } = parseBody(createRunSchema, body);
    // A guest session is created on demand so Practice Arena needs no sign-up.
    const actor = await requireActor({ createGuest: true });
    return startRun({ actor, roomKey, championKey, ip: ipFrom(request) });
  },
  { name: 'run-create', limit: 30 }
);
