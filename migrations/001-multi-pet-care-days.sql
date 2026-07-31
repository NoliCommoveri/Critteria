-- Migration 001 — multiple pets per kid, unlocked by good-care days.
-- See SPEC.md §5 "Multiple pets". Brings a database created from the
-- pre-multi-pet schema.sql up to the current shape. Run once.
--
-- Apply with:
--   npx wrangler d1 execute critteria --remote --file=./migrations/001-multi-pet-care-days.sql
--
-- ORDERING MATTERS: apply this BEFORE pushing the Worker that goes with
-- it. The new code writes pets.active on hatch, which does not exist on
-- the old table — deploy first and every hatch 500s until this lands.
-- The reverse order is harmless: the old Worker ignores the new column.
--
-- WHY IT LOOKS LIKE THIS. pets has to be rebuilt rather than altered,
-- because kid_id's old UNIQUE constraint is an implicit sqlite_autoindex:
-- there is no named index to drop and no ALTER that removes it. The
-- textbook rebuild (disable foreign keys, drop, recreate, re-enable) does
-- NOT work on D1, and all three of the usual escapes were tried against a
-- real local D1 before settling on this:
--
--   * `PRAGMA foreign_keys = OFF` is ignored — the DROP still fails.
--   * `PRAGMA defer_foreign_keys = ON` defers the check to commit, where
--     it fails anyway and rolls the whole batch back.
--   * `PRAGMA legacy_alter_table = ON` is ignored, so ALTER TABLE RENAME
--     rewrites every child table's REFERENCES clause to follow the old
--     table instead of leaving it pointing at the name.
--
-- So the child rows are parked in constraint-free holding tables, the
-- children emptied, pets swapped, and the rows put back. Nothing is
-- deleted until its copy exists, and D1 runs a --file batch atomically
-- (that's how the failed attempts above rolled back cleanly), so a
-- failure part-way leaves the database untouched rather than half-built.
--
-- Deliberately no BEGIN/COMMIT: D1 drives the transaction itself and
-- rejects an explicit one.

-- 1. Stage the new pets table. Nothing destructive yet.
CREATE TABLE pets_new (
  id            TEXT PRIMARY KEY,
  kid_id        TEXT NOT NULL REFERENCES kids(id),
  species       TEXT NOT NULL,
  color_variant TEXT,
  name          TEXT,
  stage         TEXT NOT NULL DEFAULT 'young',
  created_at    INTEGER NOT NULL,
  hunger        REAL NOT NULL DEFAULT 80,
  happiness     REAL NOT NULL DEFAULT 80,
  energy        REAL NOT NULL DEFAULT 80,
  cleanliness   REAL NOT NULL DEFAULT 80,
  sleeping      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  last_updated  INTEGER NOT NULL
);

-- Every pre-migration pet was its kid's only pet, so all of them start
-- active (out of the burrow) — which is also what BURROW_DECAY_MULTIPLIER
-- expects for a kid who never hatches a second pet.
INSERT INTO pets_new (id, kid_id, species, color_variant, name, stage, created_at,
                      hunger, happiness, energy, cleanliness, sleeping, active, last_updated)
  SELECT id, kid_id, species, color_variant, name, stage, created_at,
         hunger, happiness, energy, cleanliness, sleeping, 1, last_updated
  FROM pets;

-- 2. Park every row that points at pets. CREATE TABLE ... AS SELECT copies
--    the data with no constraints attached, so these holding tables don't
--    care that pets is about to disappear.
CREATE TABLE pet_events_backup AS SELECT * FROM pet_events;
CREATE TABLE helper_action_usage_backup AS SELECT * FROM helper_action_usage;
CREATE TABLE pet_equipped_items_backup AS SELECT * FROM pet_equipped_items;
CREATE TABLE pet_current_location_backup AS SELECT * FROM pet_current_location;

-- 3. Empty the children so the old pets table has no dependants left.
DELETE FROM pet_events;
DELETE FROM helper_action_usage;
DELETE FROM pet_equipped_items;
DELETE FROM pet_current_location;

-- 4. Swap. The children's REFERENCES clauses name `pets`, so they pick the
--    rebuilt table up on rename with no further work.
DROP TABLE pets;
ALTER TABLE pets_new RENAME TO pets;
CREATE INDEX idx_pets_kid ON pets(kid_id);

-- 5. Put the child rows back, now pointing at the rebuilt table, and clear
--    the holding tables away.
INSERT INTO pet_events SELECT * FROM pet_events_backup;
INSERT INTO helper_action_usage SELECT * FROM helper_action_usage_backup;
INSERT INTO pet_equipped_items SELECT * FROM pet_equipped_items_backup;
INSERT INTO pet_current_location SELECT * FROM pet_current_location_backup;

DROP TABLE pet_events_backup;
DROP TABLE helper_action_usage_backup;
DROP TABLE pet_equipped_items_backup;
DROP TABLE pet_current_location_backup;

-- 6. The new table behind earned pet slots.
CREATE TABLE care_days (
  kid_id     TEXT NOT NULL REFERENCES kids(id),
  utc_day    TEXT NOT NULL,
  pet_id     TEXT NOT NULL REFERENCES pets(id),
  earned_at  INTEGER NOT NULL,
  PRIMARY KEY (kid_id, utc_day)
);
