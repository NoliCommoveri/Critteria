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
