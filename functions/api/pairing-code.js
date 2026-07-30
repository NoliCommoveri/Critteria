import { authenticate, unauthorized } from '../_lib/auth.js';
import { sha256Hex, randomPairingCode } from '../_lib/crypto.js';

const TTL_MS = 5 * 60 * 1000;

// Mints a short-lived single-use pairing code for a second-onwards device
// to redeem via /api/pair (SPEC.md §7 "Additional device pairing").
export async function onRequestPost({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

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
        'INSERT INTO pairing_codes (code_hash, family_id, expires_at, used_at) VALUES (?, ?, ?, NULL)'
      ).bind(codeHash, device.familyId, expiresAt).run();
      return Response.json({ code, expiresAt });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
