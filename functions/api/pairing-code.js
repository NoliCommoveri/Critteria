import { authenticate, unauthorized } from '../_lib/auth.js';
import { sha256Hex, randomPairingCode } from '../_lib/crypto.js';

const TTL_MS = 5 * 60 * 1000;

// Mints a short-lived single-use pairing code for a second-onwards device
// to redeem via /api/pair (SPEC.md §7 "Additional device pairing").
//
// `{ bindKid: true }` also stamps the caller's own kid onto the code, so
// the redeeming device joins as that same kid rather than being handed the
// kid picker — that's the "this is my other tablet" case, where a kid has
// a tablet and a phone and expects the same pets on both.
export async function onRequestPost({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    // No body at all is fine — that's a plain family-scoped code.
  }

  const bindKid = !!(body && body.bindKid);
  if (bindKid && !device.kidId) {
    return Response.json(
      { error: 'this device has not claimed a kid yet, so it cannot share one' },
      { status: 403 }
    );
  }
  const kidId = bindKid ? device.kidId : null;

  const now = Date.now();
  const expiresAt = now + TTL_MS;

  // Collisions on code_hash (the table's PK) are astronomically unlikely
  // at 6 chars from a 33-char alphabet with a 5-min TTL, but retry rather
  // than trust that.
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomPairingCode();
    const codeHash = await sha256Hex(code);
    try {
      await env.DB.prepare(
        'INSERT INTO pairing_codes (code_hash, family_id, kid_id, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)'
      ).bind(codeHash, device.familyId, kidId, expiresAt).run();
      return Response.json({ code, expiresAt, kidId });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
