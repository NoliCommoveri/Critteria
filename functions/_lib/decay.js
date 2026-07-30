// Mirrors DECAY_PER_HOUR / SLEEP_ENERGY_REGEN_PER_HOUR / applyDecay() in
// index.html so server and client agree on the math (SPEC.md §3 "pets").
export const DECAY_PER_HOUR = { hunger: 10, happiness: 7, cleanliness: 5, energy: 4 };
export const SLEEP_ENERGY_REGEN_PER_HOUR = 120;

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

// Mutates and returns the D1 pet row in place, advancing last_updated to
// `now`. Caller is responsible for persisting the result.
export function applyDecay(pet, now) {
  now = now || Date.now();
  const hours = (now - pet.last_updated) / 3600000;
  if (hours <= 0) return pet;

  if (pet.sleeping) {
    pet.energy = clamp(pet.energy + hours * SLEEP_ENERGY_REGEN_PER_HOUR);
    pet.hunger = clamp(pet.hunger - hours * DECAY_PER_HOUR.hunger * 0.5);
    pet.cleanliness = clamp(pet.cleanliness - hours * DECAY_PER_HOUR.cleanliness * 0.3);
  } else {
    pet.hunger = clamp(pet.hunger - hours * DECAY_PER_HOUR.hunger);
    pet.happiness = clamp(pet.happiness - hours * DECAY_PER_HOUR.happiness);
    pet.cleanliness = clamp(pet.cleanliness - hours * DECAY_PER_HOUR.cleanliness);
    pet.energy = clamp(pet.energy - hours * DECAY_PER_HOUR.energy);
  }
  pet.last_updated = now;
  return pet;
}

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
    hunger: pet.hunger,
    happiness: pet.happiness,
    energy: pet.energy,
    cleanliness: pet.cleanliness,
    sleeping: !!pet.sleeping,
    lastUpdated: pet.last_updated
  };
}
