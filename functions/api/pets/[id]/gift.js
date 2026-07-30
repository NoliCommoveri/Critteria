import { authenticate, unauthorized } from '../../../_lib/auth.js';

// Records a gift as a pet_events row (SPEC.md §6 "gifting"). Gift item
// catalog/effects are Phase 5 work (the deferred `items` table, §3/§8) —
// v1 gifting is purely social, an event with an optional message.
export async function onRequestPost({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  if (!device.kidId) {
    return Response.json({ error: 'this device has not claimed a kid yet' }, { status: 403 });
  }

  const pet = await env.DB.prepare(
    `SELECT pets.id, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();

  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    // Gift body is optional.
  }
  const message = typeof body.message === 'string' ? body.message.slice(0, 200) : null;

  await env.DB.prepare(
    'INSERT INTO pet_events (pet_id, actor_kid_id, action, occurred_at, detail) VALUES (?, ?, ?, ?, ?)'
  ).bind(pet.id, device.kidId, 'gift', Date.now(), message ? JSON.stringify({ message }) : null).run();

  return Response.json({ ok: true });
}
