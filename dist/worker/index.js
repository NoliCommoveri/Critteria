var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/crypto.js
async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomHex, "randomHex");
function newDeviceToken() {
  return randomHex(32);
}
__name(newDeviceToken, "newDeviceToken");
var PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomPairingCode(length) {
  length = length || 6;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}
__name(randomPairingCode, "randomPairingCode");

// _lib/auth.js
async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match2 = /^Bearer\s+(.+)$/i.exec(header);
  if (!match2) return null;
  const tokenHash = await sha256Hex(match2[1].trim());
  const device = await env.DB.prepare(
    "SELECT id, family_id, kid_id, revoked FROM devices WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!device || device.revoked) return null;
  await env.DB.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").bind(Date.now(), device.id).run();
  return { deviceId: device.id, familyId: device.family_id, kidId: device.kid_id };
}
__name(authenticate, "authenticate");
function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
__name(unauthorized, "unauthorized");

// api/kids/[id]/claim.js
async function onRequestPost({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const kid = await env.DB.prepare("SELECT id, family_id FROM kids WHERE id = ?").bind(params.id).first();
  if (!kid || kid.family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  if (typeof body.avatar === "string" && body.avatar) {
    await env.DB.prepare("UPDATE kids SET avatar = ? WHERE id = ?").bind(body.avatar, params.id).run();
  }
  await env.DB.prepare("UPDATE devices SET kid_id = ? WHERE id = ?").bind(params.id, device.deviceId).run();
  return Response.json({ ok: true, kidId: params.id });
}
__name(onRequestPost, "onRequestPost");

// _lib/decay.js
var DECAY_PER_HOUR = { hunger: 10, happiness: 7, cleanliness: 5, energy: 4 };
var SLEEP_ENERGY_REGEN_PER_HOUR = 120;
function clamp(v) {
  return Math.max(0, Math.min(100, v));
}
__name(clamp, "clamp");
function applyDecay(pet, now) {
  now = now || Date.now();
  const hours = (now - pet.last_updated) / 36e5;
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
__name(applyDecay, "applyDecay");
async function persistPet(db, pet) {
  await db.prepare(
    "UPDATE pets SET hunger=?, happiness=?, energy=?, cleanliness=?, sleeping=?, color_variant=?, last_updated=? WHERE id=?"
  ).bind(pet.hunger, pet.happiness, pet.energy, pet.cleanliness, pet.sleeping ? 1 : 0, pet.color_variant, pet.last_updated, pet.id).run();
}
__name(persistPet, "persistPet");
function serializePet(pet) {
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
__name(serializePet, "serializePet");

// api/pets/[id]/action.js
function clamp2(v) {
  return Math.max(0, Math.min(100, v));
}
__name(clamp2, "clamp");
var OWN_ACTIONS = ["feed", "play", "clean", "sleep", "wake"];
var HELPER_ACTIONS = ["feed", "play"];
function applyEffect(pet, action) {
  if (action === "feed") {
    pet.hunger = clamp2(pet.hunger + 25);
  } else if (action === "play") {
    pet.happiness = clamp2(pet.happiness + 20);
    pet.energy = clamp2(pet.energy - 3);
    pet.hunger = clamp2(pet.hunger - 2);
    pet.cleanliness = clamp2(pet.cleanliness - 10);
  } else if (action === "clean") {
    pet.cleanliness = 100;
  } else if (action === "sleep") {
    pet.sleeping = 1;
  } else if (action === "wake") {
    pet.sleeping = 0;
  }
}
__name(applyEffect, "applyEffect");
async function onRequestPost2({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  if (!device.kidId) {
    return Response.json({ error: "this device has not claimed a kid yet" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const action = body && body.action;
  if (!OWN_ACTIONS.includes(action)) {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }
  const pet = await env.DB.prepare(
    `SELECT pets.*, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();
  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const isOwnPet = pet.kid_id === device.kidId;
  if (!isOwnPet) {
    if (!HELPER_ACTIONS.includes(action)) {
      return Response.json({ error: "that action is only available on your own pet" }, { status: 403 });
    }
    const utcDay = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      await env.DB.prepare(
        "INSERT INTO helper_action_usage (visitor_kid_id, host_pet_id, action, utc_day, used_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(device.kidId, pet.id, action, utcDay, Date.now()).run();
    } catch (e) {
      return Response.json({ error: "already helped with this pet today" }, { status: 429 });
    }
  } else if (action === "sleep" && pet.sleeping || action === "wake" && !pet.sleeping) {
    return Response.json({ error: "pet is already in that state" }, { status: 409 });
  }
  const decayed = applyDecay(pet, Date.now());
  applyEffect(decayed, action);
  await persistPet(env.DB, decayed);
  await env.DB.prepare(
    "INSERT INTO pet_events (pet_id, actor_kid_id, action, occurred_at) VALUES (?, ?, ?, ?)"
  ).bind(pet.id, device.kidId, action, Date.now()).run();
  return Response.json({ pet: serializePet(decayed) });
}
__name(onRequestPost2, "onRequestPost");

// api/pets/[id]/events.js
var PRESENCE_WINDOW_MS = 3e4;
async function onRequestGet({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const pet = await env.DB.prepare(
    `SELECT pets.id, pets.kid_id, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();
  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get("limit"), 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 20, 100);
  const { results } = await env.DB.prepare(
    "SELECT id, actor_kid_id, action, occurred_at, detail FROM pet_events WHERE pet_id = ? ORDER BY occurred_at DESC LIMIT ?"
  ).bind(pet.id, limit).all();
  const now = Date.now();
  const latest = results[0];
  const visiting = Boolean(
    latest && latest.actor_kid_id !== pet.kid_id && now - latest.occurred_at <= PRESENCE_WINDOW_MS
  );
  return Response.json({
    events: results.map((e) => ({
      id: e.id,
      actorKidId: e.actor_kid_id,
      action: e.action,
      occurredAt: e.occurred_at,
      detail: e.detail ? JSON.parse(e.detail) : null
    })),
    presence: visiting ? { visitorKidId: latest.actor_kid_id } : null
  });
}
__name(onRequestGet, "onRequestGet");

// api/pets/[id]/gift.js
async function onRequestPost3({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  if (!device.kidId) {
    return Response.json({ error: "this device has not claimed a kid yet" }, { status: 403 });
  }
  const pet = await env.DB.prepare(
    `SELECT pets.id, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();
  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const message = typeof body.message === "string" ? body.message.slice(0, 200) : null;
  await env.DB.prepare(
    "INSERT INTO pet_events (pet_id, actor_kid_id, action, occurred_at, detail) VALUES (?, ?, ?, ?, ?)"
  ).bind(pet.id, device.kidId, "gift", Date.now(), message ? JSON.stringify({ message }) : null).run();
  return Response.json({ ok: true });
}
__name(onRequestPost3, "onRequestPost");

// api/devices/[id].js
async function onRequestDelete({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const result = await env.DB.prepare(
    "UPDATE devices SET revoked = 1 WHERE id = ? AND family_id = ?"
  ).bind(params.id, device.familyId).run();
  if (!result.meta.changes) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
__name(onRequestDelete, "onRequestDelete");

// api/kids/[id].js
async function onRequestPatch({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const kid = await env.DB.prepare("SELECT id, family_id FROM kids WHERE id = ?").bind(params.id).first();
  if (!kid || kid.family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const updates = [];
  const values = [];
  if (typeof body.displayName === "string" && body.displayName.trim()) {
    updates.push("display_name = ?");
    values.push(body.displayName.trim());
  }
  if (typeof body.avatar === "string") {
    updates.push("avatar = ?");
    values.push(body.avatar);
  }
  if (!updates.length) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }
  values.push(params.id);
  await env.DB.prepare(`UPDATE kids SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return Response.json({ ok: true });
}
__name(onRequestPatch, "onRequestPatch");

// api/pets/[id].js
async function onRequestGet2({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const pet = await env.DB.prepare(
    `SELECT pets.*, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();
  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const decayed = applyDecay(pet, Date.now());
  await persistPet(env.DB, decayed);
  return Response.json({ pet: serializePet(decayed) });
}
__name(onRequestGet2, "onRequestGet");
async function onRequestPatch2({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  if (!device.kidId) {
    return Response.json({ error: "this device has not claimed a kid yet" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const colorVariant = body && body.colorVariant;
  if (typeof colorVariant !== "string") {
    return Response.json({ error: "colorVariant is required" }, { status: 400 });
  }
  const pet = await env.DB.prepare(
    `SELECT pets.*, kids.family_id AS owner_family_id
     FROM pets JOIN kids ON kids.id = pets.kid_id
     WHERE pets.id = ?`
  ).bind(params.id).first();
  if (!pet || pet.owner_family_id !== device.familyId) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (pet.kid_id !== device.kidId) {
    return Response.json({ error: "that action is only available on your own pet" }, { status: 403 });
  }
  const decayed = applyDecay(pet, Date.now());
  decayed.color_variant = colorVariant;
  await persistPet(env.DB, decayed);
  return Response.json({ pet: serializePet(decayed) });
}
__name(onRequestPatch2, "onRequestPatch");

// api/devices.js
async function onRequestGet3({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const { results } = await env.DB.prepare(
    "SELECT id, kid_id, label, created_at, last_seen, revoked FROM devices WHERE family_id = ? ORDER BY created_at"
  ).bind(device.familyId).all();
  return Response.json({
    devices: results.map((d) => ({
      id: d.id,
      kidId: d.kid_id,
      label: d.label,
      createdAt: d.created_at,
      lastSeen: d.last_seen,
      revoked: !!d.revoked
    }))
  });
}
__name(onRequestGet3, "onRequestGet");

// api/family.js
async function onRequestPost4({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { signupSecret, deviceId, label } = body || {};
  if (!env.SIGNUP_SECRET || signupSecret !== env.SIGNUP_SECRET) {
    return Response.json({ error: "invalid signup secret" }, { status: 401 });
  }
  if (!deviceId || typeof deviceId !== "string") {
    return Response.json({ error: "deviceId is required" }, { status: 400 });
  }
  const existing = await env.DB.prepare("SELECT id FROM families LIMIT 1").first();
  if (existing) {
    return Response.json({ error: "a family already exists on this deployment" }, { status: 409 });
  }
  const now = Date.now();
  const familyId = randomHex(16);
  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO families (id, created_at) VALUES (?, ?)").bind(familyId, now),
    env.DB.prepare(
      `INSERT INTO devices (id, family_id, kid_id, token_hash, label, created_at, last_seen, revoked)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 0)`
    ).bind(deviceId, familyId, tokenHash, label || null, now, now)
  ]);
  return Response.json({ token, deviceId, familyId }, { status: 201 });
}
__name(onRequestPost4, "onRequestPost");

// api/kids.js
async function onRequestGet4({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const { results } = await env.DB.prepare(
    "SELECT id, display_name, avatar, created_at FROM kids WHERE family_id = ? ORDER BY created_at"
  ).bind(device.familyId).all();
  return Response.json({
    kids: results.map((k) => ({
      id: k.id,
      displayName: k.display_name,
      avatar: k.avatar,
      createdAt: k.created_at
    }))
  });
}
__name(onRequestGet4, "onRequestGet");
async function onRequestPost5({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const displayName = (body && typeof body.displayName === "string" ? body.displayName : "").trim();
  if (!displayName) {
    return Response.json({ error: "displayName is required" }, { status: 400 });
  }
  const avatar = typeof body.avatar === "string" ? body.avatar : null;
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO kids (id, family_id, display_name, avatar, pin_hash, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
  ).bind(id, device.familyId, displayName, avatar, now).run();
  return Response.json({ id, displayName, avatar, createdAt: now }, { status: 201 });
}
__name(onRequestPost5, "onRequestPost");

// api/pair.js
async function onRequestPost6({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { code, deviceId, label } = body || {};
  if (!code || !deviceId) {
    return Response.json({ error: "code and deviceId are required" }, { status: 400 });
  }
  const codeHash = await sha256Hex(String(code).toUpperCase());
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT family_id, expires_at, used_at FROM pairing_codes WHERE code_hash = ?"
  ).bind(codeHash).first();
  if (!row || row.used_at !== null || row.expires_at < now) {
    return Response.json({ error: "invalid or expired code" }, { status: 400 });
  }
  const claim = await env.DB.prepare(
    "UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL"
  ).bind(now, codeHash).run();
  if (!claim.meta.changes) {
    return Response.json({ error: "invalid or expired code" }, { status: 400 });
  }
  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO devices (id, family_id, kid_id, token_hash, label, created_at, last_seen, revoked)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 0)`
  ).bind(deviceId, row.family_id, tokenHash, label || null, now, now).run();
  return Response.json({ token, deviceId, familyId: row.family_id }, { status: 201 });
}
__name(onRequestPost6, "onRequestPost");

// api/pairing-code.js
var TTL_MS = 5 * 60 * 1e3;
async function onRequestPost7({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomPairingCode();
    const codeHash = await sha256Hex(code);
    try {
      await env.DB.prepare(
        "INSERT INTO pairing_codes (code_hash, family_id, expires_at, used_at) VALUES (?, ?, ?, NULL)"
      ).bind(codeHash, device.familyId, expiresAt).run();
      return Response.json({ code, expiresAt });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
__name(onRequestPost7, "onRequestPost");

// api/pets.js
async function onRequestGet5({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  const { results } = await env.DB.prepare(
    "SELECT pets.* FROM pets JOIN kids ON kids.id = pets.kid_id WHERE kids.family_id = ?"
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
__name(onRequestGet5, "onRequestGet");
async function onRequestPost8({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();
  if (!device.kidId) {
    return Response.json({ error: "this device has not claimed a kid yet" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const species = body && body.species;
  if (!species || typeof species !== "string") {
    return Response.json({ error: "species is required" }, { status: 400 });
  }
  const existing = await env.DB.prepare("SELECT id FROM pets WHERE kid_id = ?").bind(device.kidId).first();
  if (existing) {
    return Response.json({ error: "this kid already has a pet" }, { status: 409 });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const colorVariant = typeof body.colorVariant === "string" ? body.colorVariant : null;
  const name = typeof body.name === "string" ? body.name : null;
  await env.DB.prepare(
    `INSERT INTO pets (id, kid_id, species, color_variant, name, stage, created_at,
       hunger, happiness, energy, cleanliness, sleeping, last_updated)
     VALUES (?, ?, ?, ?, ?, 'young', ?, 80, 80, 80, 80, 0, ?)`
  ).bind(id, device.kidId, species, colorVariant, name, now, now).run();
  const pet = await env.DB.prepare("SELECT * FROM pets WHERE id = ?").bind(id).first();
  return Response.json({ pet: serializePet(pet) }, { status: 201 });
}
__name(onRequestPost8, "onRequestPost");

// ../.wrangler/tmp/pages-5yZHT1/functionsRoutes-0.8806679442421617.mjs
var routes = [
  {
    routePath: "/api/kids/:id/claim",
    mountPath: "/api/kids/:id",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/pets/:id/action",
    mountPath: "/api/pets/:id",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/pets/:id/events",
    mountPath: "/api/pets/:id",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/pets/:id/gift",
    mountPath: "/api/pets/:id",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/devices/:id",
    mountPath: "/api/devices",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/kids/:id",
    mountPath: "/api/kids",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch]
  },
  {
    routePath: "/api/pets/:id",
    mountPath: "/api/pets",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/pets/:id",
    mountPath: "/api/pets",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch2]
  },
  {
    routePath: "/api/devices",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/family",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/kids",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/kids",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/pair",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/pairing-code",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/api/pets",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/pets",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  }
];

// ../../../../root/.npm/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
