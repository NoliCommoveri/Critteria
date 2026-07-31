// Good-care days and the pet slots they unlock (SPEC.md §5 "Multiple pets").
//
// A kid earns at most one care day per UTC day, and only by looking after
// their OWN pet: any care action that leaves the pet's four stats averaging
// GOOD_CARE_AVG or better. Helper actions on a sibling's pet deliberately
// don't count — otherwise a kid could farm slots off their brother's pet
// without ever feeding their own.
//
// UTC day boundary matches helper_action_usage (SPEC.md §3): one column, no
// per-family config, and if it ever needs to be local time the fix is a
// families.tz column, not a schema change here.

export const GOOD_CARE_AVG = 70;

// Cumulative, NOT a streak: a missed day fails to advance the count but
// never resets it. Chosen deliberately over a strict streak — with four
// kids, a stomach bug or a weekend at a grandparent's would otherwise wipe
// out a week of real effort, which is a worse outcome than the mechanic
// being slightly too forgiving.
export const UNLOCK_AT_DAYS = [7, 21];

// One starting pet plus one per threshold passed.
export const MAX_PETS_PER_KID = UNLOCK_AT_DAYS.length + 1;

export function utcDay(now) {
  return new Date(now || Date.now()).toISOString().slice(0, 10);
}

export function careAverage(pet) {
  return (pet.hunger + pet.happiness + pet.energy + pet.cleanliness) / 4;
}

export function slotsFor(careDays) {
  let slots = 1;
  for (const threshold of UNLOCK_AT_DAYS) {
    if (careDays >= threshold) slots += 1;
  }
  return Math.min(slots, MAX_PETS_PER_KID);
}

// The next threshold this kid hasn't reached, or null once they're maxed.
export function nextUnlockAt(careDays) {
  for (const threshold of UNLOCK_AT_DAYS) {
    if (careDays < threshold) return threshold;
  }
  return null;
}

// Records today's good-care day if the pet is in good enough shape. Returns
// true when the pet qualified, whether or not today was already counted.
//
// INSERT OR IGNORE is correct here — and is NOT the mistake warned about on
// helper_action_usage in SPEC.md §3. There, a duplicate means "daily limit
// already hit" and has to surface as a 429; here a second good action on
// the same day is simply already counted, so swallowing it is the point.
export async function recordCareDay(db, kidId, pet, now) {
  if (careAverage(pet) < GOOD_CARE_AVG) return false;
  await db.prepare(
    'INSERT OR IGNORE INTO care_days (kid_id, utc_day, pet_id, earned_at) VALUES (?, ?, ?, ?)'
  ).bind(kidId, utcDay(now), pet.id, now).run();
  return true;
}

// The unlock-progress block returned alongside pets, so the roster strip in
// index.html can show "3 more good days" without a second round trip.
export async function careSummary(db, kidId, now) {
  const [total, today] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM care_days WHERE kid_id = ?').bind(kidId),
    db.prepare('SELECT 1 AS ok FROM care_days WHERE kid_id = ? AND utc_day = ?')
      .bind(kidId, utcDay(now))
  ]);

  const careDays = (total.results[0] && total.results[0].n) || 0;
  const next = nextUnlockAt(careDays);

  return {
    careDays,
    earnedToday: !!(today.results && today.results.length),
    slots: slotsFor(careDays),
    maxSlots: MAX_PETS_PER_KID,
    nextUnlockAt: next,
    daysToNextUnlock: next === null ? null : next - careDays,
    goodCareAvg: GOOD_CARE_AVG
  };
}
