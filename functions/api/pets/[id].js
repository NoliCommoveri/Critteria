import { authenticate, unauthorized } from '../../_lib/auth.js';
import { applyDecay, persistPet, serializePet } from '../../_lib/decay.js';

// Server-computed pet state with lazy decay (SPEC.md §3 "pets", §9 file
// layout). Any device in the pet's family may read it — that's what makes
// sibling visiting possible.
export async function onRequestGet({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const pet = await env.DB.prepare(
    `SELECT pets.*, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();

  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const decayed = applyDecay(pet, Date.now());
  await persistPet(env.DB, decayed);

  return Response.json({ pet: serializePet(decayed) });
}

// Lets a kid change their own pet's color variant after creation — the
// swatch row in index.html was only ever writing this to local state, so
// the next poll (every ~5s once synced) stomped it right back with the
// stale server value. Mirrors action.js's own-pet auth check.
//
// Also where the roster strip switches which pet is out of the burrow:
// `{ active: true }` makes this the kid's one active pet (SPEC.md §5
// "Multiple pets"). Both fields are optional; send either or both.
export async function onRequestPatch({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  if (!device.kidId) {
    return Response.json({ error: 'this device has not claimed a kid yet' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const colorVariant = body && body.colorVariant;
  const makeActive = !!(body && body.active);
  if (colorVariant !== undefined && typeof colorVariant !== 'string') {
    return Response.json({ error: 'colorVariant must be a string' }, { status: 400 });
  }
  if (colorVariant === undefined && !makeActive) {
    return Response.json({ error: 'nothing to update' }, { status: 400 });
  }

  const pet = await env.DB.prepare(
    `SELECT pets.*, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();

  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  if (pet.kid_id !== device.kidId) {
    return Response.json({ error: 'that action is only available on your own pet' }, { status: 403 });
  }

  // Settle the stretch that just ended before touching `active` — decay is
  // charged at the rate the pet was actually living at, so the burrowed
  // hours stay cheap and only the time after the switch bills at full rate.
  const decayed = applyDecay(pet, Date.now());
  if (colorVariant !== undefined) decayed.color_variant = colorVariant;
  await persistPet(env.DB, decayed);

  if (makeActive && !decayed.active) {
    // Batched so the kid never briefly has two active pets (or none) —
    // exactly one row per kid carries active = 1.
    await env.DB.batch([
      env.DB.prepare('UPDATE pets SET active = 0 WHERE kid_id = ?').bind(pet.kid_id),
      env.DB.prepare('UPDATE pets SET active = 1 WHERE id = ?').bind(pet.id)
    ]);
    decayed.active = 1;
  }

  return Response.json({ pet: serializePet(decayed) });
}
