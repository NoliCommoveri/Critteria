import { authenticate, unauthorized } from '../_lib/auth.js';
import { applyDecay, persistPet, serializePet } from '../_lib/decay.js';

// Lists every pet in the caller's family (used by the "visit sibling"
// list view, SPEC.md §5/§10), applying and persisting lazy decay on read
// just like GET /api/pets/:id does for a single pet.
export async function onRequestGet({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const { results } = await env.DB.prepare(
    'SELECT pets.* FROM pets JOIN kids ON kids.id = pets.kid_id WHERE kids.family_id = ?'
  ).bind(device.familyId).all();

  const now = Date.now();
  const pets = [];
  for (const row of results) {
    const decayed = applyDecay(row, now);
    await persistPet(env.DB, decayed);
    pets.push(serializePet(decayed));
  }

  return Response.json({ pets });
}

// Creates the pet for the calling device's claimed kid (one pet per kid —
// pets.kid_id is UNIQUE, SPEC.md §3).
export async function onRequestPost({ request, env }) {
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

  const species = body && body.species;
  if (!species || typeof species !== 'string') {
    return Response.json({ error: 'species is required' }, { status: 400 });
  }

  const existing = await env.DB.prepare('SELECT id FROM pets WHERE kid_id = ?').bind(device.kidId).first();
  if (existing) {
    return Response.json({ error: 'this kid already has a pet' }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const colorVariant = typeof body.colorVariant === 'string' ? body.colorVariant : null;
  const name = typeof body.name === 'string' ? body.name : null;

  await env.DB.prepare(
    `INSERT INTO pets (id, kid_id, species, color_variant, name, stage, created_at,
       hunger, happiness, energy, cleanliness, sleeping, last_updated)
     VALUES (?, ?, ?, ?, ?, 'young', ?, 80, 80, 80, 80, 0, ?)`
  ).bind(id, device.kidId, species, colorVariant, name, now, now).run();

  const pet = await env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(id).first();
  return Response.json({ pet: serializePet(pet) }, { status: 201 });
}
