import { authenticate, unauthorized } from '../../../_lib/auth.js';
import { applyDecay, persistPet, serializePet } from '../../../_lib/decay.js';
import { careSummary, recordCareDay } from '../../../_lib/care.js';

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

// Effects match doAction()'s handlers in index.html exactly. sleep/wake are
// one toggle client-side but distinct verbs here so pet_events records
// which direction actually happened (SPEC.md §3 pet_events action enum).
const OWN_ACTIONS = ['feed', 'play', 'clean', 'sleep', 'wake'];
// Per SPEC.md §6, only feed/play are available as once-a-day helper
// actions on a sibling's pet.
const HELPER_ACTIONS = ['feed', 'play'];

function applyEffect(pet, action) {
  if (action === 'feed') {
    pet.hunger = clamp(pet.hunger + 25);
  } else if (action === 'play') {
    pet.happiness = clamp(pet.happiness + 20);
    pet.energy = clamp(pet.energy - 3);
    pet.hunger = clamp(pet.hunger - 2);
  } else if (action === 'clean') {
    pet.cleanliness = 100;
  } else if (action === 'sleep') {
    pet.sleeping = 1;
  } else if (action === 'wake') {
    pet.sleeping = 0;
  }
}

export async function onRequestPost({ request, env, params }) {
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

  const action = body && body.action;
  if (!OWN_ACTIONS.includes(action)) {
    return Response.json({ error: 'unknown action' }, { status: 400 });
  }

  const pet = await env.DB.prepare(
    `SELECT pets.*, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();

  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const isOwnPet = pet.kid_id === device.kidId;
  if (!isOwnPet) {
    if (!HELPER_ACTIONS.includes(action)) {
      return Response.json({ error: 'that action is only available on your own pet' }, { status: 403 });
    }
    // INSERT against the (visitor, host_pet, action, utc_day) composite PK
    // either succeeds or hits the daily rate limit with no race window —
    // do not swap this for INSERT OR IGNORE (SPEC.md §3).
    const utcDay = new Date().toISOString().slice(0, 10);
    try {
      await env.DB.prepare(
        'INSERT INTO helper_action_usage (visitor_kid_id, host_pet_id, action, utc_day, used_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(device.kidId, pet.id, action, utcDay, Date.now()).run();
    } catch (e) {
      return Response.json({ error: 'already helped with this pet today' }, { status: 429 });
    }
  } else if ((action === 'sleep' && pet.sleeping) || (action === 'wake' && !pet.sleeping)) {
    return Response.json({ error: 'pet is already in that state' }, { status: 409 });
  }

  const now = Date.now();
  const decayed = applyDecay(pet, now);
  applyEffect(decayed, action);
  await persistPet(env.DB, decayed);

  await env.DB.prepare(
    'INSERT INTO pet_events (pet_id, actor_kid_id, action, occurred_at) VALUES (?, ?, ?, ?)'
  ).bind(pet.id, device.kidId, action, now).run();

  // Looking after your own pet well enough to leave it above the good-care
  // average banks today toward the next pet slot (SPEC.md §5 "Multiple
  // pets"). Helping a sibling's pet never counts — that path is the
  // !isOwnPet branch above, and letting it count would make slots farmable
  // off someone else's pet.
  let care = null;
  if (isOwnPet) {
    await recordCareDay(env.DB, device.kidId, decayed, now);
    // Returned so the roster strip's progress updates the moment a kid
    // earns a day, instead of waiting for the next poll.
    care = await careSummary(env.DB, device.kidId, now);
  }

  return Response.json({ pet: serializePet(decayed), care });
}
