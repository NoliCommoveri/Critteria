import { authenticate, unauthorized } from '../../../_lib/auth.js';

const PRESENCE_WINDOW_MS = 30000;

// Recent events for a pet — doubles as short history and presence signal
// (SPEC.md §3 pet_events: "any event by a kid within the last ~30s =
// currently visiting", keyed off actor_kid_id, not device_id).
export async function onRequestGet({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const pet = await env.DB.prepare(
    `SELECT pets.id, pets.kid_id, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();

  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get('limit'), 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 20, 100);

  const { results } = await env.DB.prepare(
    'SELECT id, actor_kid_id, action, occurred_at, detail FROM pet_events WHERE pet_id = ? ORDER BY occurred_at DESC LIMIT ?'
  ).bind(pet.id, limit).all();

  const now = Date.now();
  const latest = results[0];
  const visiting = Boolean(
    latest &&
    latest.actor_kid_id !== pet.kid_id &&
    now - latest.occurred_at <= PRESENCE_WINDOW_MS
  );

  return Response.json({
    events: results.map((e) => ({
      id: e.id,
      actorKidId: e.actor_kid_id,
      action: e.action,
      occurredAt: e.occurred_at,
      detail: e.detail ? JSON.parse(e.detail) : null
    })),
    presence: visiting ? { visitorKidId: latest.actor_kid_id } : null
  });
}
