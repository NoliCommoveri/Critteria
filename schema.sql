-- Critteria backend schema (see SPEC.md §3, §9).
-- Apply with: npx wrangler d1 execute critteria --remote --file=./schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE families (
  id          TEXT PRIMARY KEY,       -- 128-bit random hex, never derived
  created_at  INTEGER NOT NULL
);

CREATE TABLE kids (
  id           TEXT PRIMARY KEY,
  family_id    TEXT NOT NULL REFERENCES families(id),
  display_name TEXT NOT NULL,
  avatar       TEXT,                  -- preset key or emoji
  -- PIN is client-side only in v1 (§7). Plain SHA-256 of a 4-digit PIN
  -- with a per-kid salt is trivially brute-forced (10 000 candidates,
  -- no work factor) — before this column ever gates a server-side
  -- action, migrate to argon2/scrypt with a real work factor. Nullable
  -- until then; do not read it as authoritative.
  pin_hash     TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_kids_family ON kids(family_id);

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,       -- client-generated UUID; stable across re-pairing
  family_id   TEXT NOT NULL REFERENCES families(id),
  kid_id      TEXT REFERENCES kids(id),  -- null until claimed
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256; raw token never stored; rotates
  label       TEXT,                   -- e.g. "Ana's tablet"
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_devices_token ON devices(token_hash);

CREATE TABLE pairing_codes (
  code_hash   TEXT PRIMARY KEY,       -- SHA-256 of 6-char code
  family_id   TEXT NOT NULL REFERENCES families(id),
  expires_at  INTEGER NOT NULL,       -- 5-min TTL
  used_at     INTEGER                 -- non-null once redeemed; single use
);

CREATE TABLE pets (
  id            TEXT PRIMARY KEY,
  kid_id        TEXT NOT NULL UNIQUE REFERENCES kids(id),  -- one pet per kid
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
  last_updated  INTEGER NOT NULL      -- server epoch ms; decay applied lazily
);
CREATE INDEX idx_pets_kid ON pets(kid_id);

CREATE TABLE pet_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id        TEXT NOT NULL REFERENCES pets(id),
  actor_kid_id  TEXT NOT NULL REFERENCES kids(id),
  action        TEXT NOT NULL,        -- 'feed'|'play'|'clean'|'sleep'|'wake'|'visit'|'gift'
  occurred_at   INTEGER NOT NULL,
  detail        TEXT                  -- optional JSON
);
CREATE INDEX idx_pet_events_pet ON pet_events(pet_id, occurred_at DESC);

-- Composite PK enforces once-a-day-per-action-per-visitor-per-host-pet:
-- an INSERT OR ABORT either succeeds or hits the daily rate limit with
-- no race window. Do NOT use INSERT OR IGNORE — it would silently
-- succeed on the duplicate and let the helper action run.
CREATE TABLE helper_action_usage (
  visitor_kid_id  TEXT NOT NULL REFERENCES kids(id),
  host_pet_id     TEXT NOT NULL REFERENCES pets(id),
  action          TEXT NOT NULL,
  utc_day         TEXT NOT NULL,      -- 'YYYY-MM-DD' (UTC)
  used_at         INTEGER NOT NULL,
  PRIMARY KEY (visitor_kid_id, host_pet_id, action, utc_day)
);

-- Deferred to Phase 5 (§8). Kept here so a future migration doesn't
-- need to reshape any of the above.
CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  slot            TEXT NOT NULL,      -- 'head'|'neck'|'back'|...
  name            TEXT NOT NULL,
  image_asset     TEXT NOT NULL,
  species_compat  TEXT NOT NULL,      -- JSON array of species keys
  unlock_type     TEXT NOT NULL       -- 'points'|'streak'|'gift'
);

CREATE TABLE pet_equipped_items (
  pet_id   TEXT NOT NULL REFERENCES pets(id),
  slot     TEXT NOT NULL,
  item_id  TEXT NOT NULL REFERENCES items(id),
  PRIMARY KEY (pet_id, slot)
);

CREATE TABLE locations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  image_asset  TEXT NOT NULL,
  unlock_type  TEXT NOT NULL
);

CREATE TABLE pet_current_location (
  pet_id       TEXT PRIMARY KEY REFERENCES pets(id),
  location_id  TEXT NOT NULL REFERENCES locations(id)
);
