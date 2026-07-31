// Mirrors DECAY_PER_HOUR / SLEEP_ENERGY_REGEN_PER_HOUR / applyDecay() in
// index.html so server and client agree on the math (SPEC.md §3 "pets").
export const DECAY_PER_HOUR = { hunger: 10, happiness: 7, cleanliness: 5, energy: 4 };
export const SLEEP_ENERGY_REGEN_PER_HOUR = 120;

// A kid can own more than one pet (SPEC.md §5 "Multiple pets"), but exactly
// one of them is `active` — the one on screen. The rest are "in the burrow"
// and drift at this fraction of the normal rate, so a second pet adds a
// little care load rather than doubling it. Without this, three pets would
// mean three times the daily upkeep and all three would sit at sad.
//
// Tuned against the two cases that decide whether the burrow works at all:
// a burrowed pet is visibly hungry but still fine after a weekend away
// (~32 hunger at 48 h), and does go sad if genuinely forgotten for most of
// a week. 0.2 was tried first and starved a burrowed pet flat in 40 hours,
// which is the whole problem the burrow exists to avoid.
export const BURROW_DECAY_MULTIPLIER = 0.1;

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

// Mutates and returns the D1 pet row in place, advancing last_updated to
// `now`. Caller is responsible for persisting the result.
export function applyDecay(pet, now) {
  now = now || Date.now();
  const hours = (now - pet.last_updated) / 3600000;
  if (hours <= 0) return pet;

  // Only an explicit active=0 burrows: a row from before the multi-pet
  // migration has no `active` column at all, and the safe reading of a
  // missing flag is "this is the pet they're raising", i.e. full rate.
  const rate = pet.active === 0 ? BURROW_DECAY_MULTIPLIER : 1;

  if (pet.sleeping) {
    // Energy regen stays at full rate even in the burrow — it caps at 100
    // anyway, and a pet that naps out back should still wake up rested.
    pet.energy = clamp(pet.energy + hours * SLEEP_ENERGY_REGEN_PER_HOUR);
    pet.hunger = clamp(pet.hunger - hours * DECAY_PER_HOUR.hunger * 0.5 * rate);
    pet.cleanliness = clamp(pet.cleanliness - hours * DECAY_PER_HOUR.cleanliness * 0.3 * rate);
  } else {
    pet.hunger = clamp(pet.hunger - hours * DECAY_PER_HOUR.hunger * rate);
    pet.happiness = clamp(pet.happiness - hours * DECAY_PER_HOUR.happiness * rate);
    pet.cleanliness = clamp(pet.cleanliness - hours * DECAY_PER_HOUR.cleanliness * rate);
    pet.energy = clamp(pet.energy - hours * DECAY_PER_HOUR.energy * rate);
  }
  pet.last_updated = now;
  return pet;
}

// Note `active` is deliberately not in this UPDATE: which pet is out of the
// burrow is flipped only by PATCH /api/pets/:id, as a batch across the kid's
// whole roster. Keeping it out of the hot decay path means a stale in-memory
// flag can never clobber the real one.
export async function persistPet(db, pet) {
  await db.prepare(
    'UPDATE pets SET hunger=?, happiness=?, energy=?, cleanliness=?, sleeping=?, color_variant=?, last_updated=? WHERE id=?'
  ).bind(pet.hunger, pet.happiness, pet.energy, pet.cleanliness, pet.sleeping ? 1 : 0, pet.color_variant, pet.last_updated, pet.id).run();
}

export function serializePet(pet) {
  return {
    id: pet.id,
    kidId: pet.kid_id,
    species: pet.species,
    colorVariant: pet.color_variant,
    name: pet.name,
    stage: pet.stage,
    // Hatch order — the roster strip sorts on this so the switcher buttons
    // keep a stable position instead of shuffling between polls.
    createdAt: pet.created_at,
    active: pet.active === 0 ? false : true,
    hunger: pet.hunger,
    happiness: pet.happiness,
    energy: pet.energy,
    cleanliness: pet.cleanliness,
    sleeping: !!pet.sleeping,
    lastUpdated: pet.last_updated
  };
}
