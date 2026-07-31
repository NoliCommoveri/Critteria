-- Drops every Critteria table so schema.sql can be re-applied from
-- scratch (SPEC.md §9 Step 5a). Reverse-dependency order — children
-- before parents — because D1 enforces foreign keys.
--
-- THIS DELETES EVERYTHING. It exists because the app has no real users
-- yet, which makes a full reset simpler and safer than a migration.
-- Once the family is actually playing, a schema change needs a real
-- migration instead; see the pragma notes under §9 Step 5 for why
-- rebuilding a table under D1 is awkward.
--
-- Apply with: npx wrangler d1 execute critteriamulti --remote --file=./reset.sql
--             npx wrangler d1 execute critteriamulti --remote --file=./schema.sql

DROP TABLE IF EXISTS pet_current_location;
DROP TABLE IF EXISTS pet_equipped_items;
DROP TABLE IF EXISTS helper_action_usage;
DROP TABLE IF EXISTS care_days;
DROP TABLE IF EXISTS pet_events;
DROP TABLE IF EXISTS pets;
DROP TABLE IF EXISTS pairing_codes;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS kids;
DROP TABLE IF EXISTS families;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS locations;
