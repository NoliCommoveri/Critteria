import { authenticate, unauthorized } from '../_lib/auth.js';
import { applyDecay, persistPet, serializePet } from '../_lib/decay.js';
import { careSummary, nextUnlockAt } from '../_lib/care.js';

// Lists every pet in the caller's family — used by both the roster strip
// (the caller's own pets) and the "visit sibling" list view, SPEC.md §5/§10
// — applying and persisting lazy decay on read just like GET /api/pets/:id
// does for a single pet. `care` is the caller's own unlock progress, so the
// roster strip can show "3 more good days" without a second round trip.
// This is the endpoint a synced client polls every ~5 s: one request covers
// the whole roster, so owning three pets costs no more traffic than one.
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

  const care = device.kidId ? await careSummary(env.DB, device.kidId, now) : null;

  return Response.json({ pets, care });
}

// Hatches a pet for the calling device's claimed kid. A kid starts with one
// slot and earns the rest with good-care days (SPEC.md §5 "Multiple pets").
// The old "one pet per kid" UNIQUE constraint on pets.kid_id was dropped in
// migrations/001-multi-pet-care-days.sql and replaced by this check, so the
// cap is now earned rather than structural.
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

  const now = Date.now();
  const care = await careSummary(env.DB, device.kidId, now);
  const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM pets WHERE kid_id = ?')
    .bind(device.kidId).first();

  if (owned.n >= care.slots) {
    const next = nextUnlockAt(care.careDays);
    return Response.json({
      error: next === null
        ? "that's the most pets one kid can look after"
        : `${next - care.careDays} more good-care days until the next egg`,
      care
    }, { status: 403 });
  }

  const id = crypto.randomUUID();
  const colorVariant = typeof body.colorVariant === 'string' ? body.colorVariant : null;
  const name = typeof body.name === 'string' ? body.name : null;

  // A just-hatched pet is the one the kid is looking at, so it comes out of
  // the burrow and any earlier pet goes in — the same "exactly one active
  // pet per kid" invariant the PATCH switcher maintains.
  await env.DB.batch([
    env.DB.prepare('UPDATE pets SET active = 0 WHERE kid_id = ?').bind(device.kidId),
    env.DB.prepare(
      `INSERT INTO pets (id, kid_id, species, color_variant, name, stage, created_at,
         hunger, happiness, energy, cleanliness, sleeping, active, last_updated)
       VALUES (?, ?, ?, ?, ?, 'young', ?, 80, 80, 80, 80, 0, 1, ?)`
    ).bind(id, device.kidId, species, colorVariant, name, now, now)
  ]);

  const pet = await env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(id).first();
  return Response.json({ pet: serializePet(pet), care }, { status: 201 });
}
