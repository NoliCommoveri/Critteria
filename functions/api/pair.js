import { sha256Hex, newDeviceToken } from '../_lib/crypto.js';

// Redeems a pairing code minted by /api/pairing-code, returning a fresh
// device token for the new device (SPEC.md §7). No auth header needed —
// the code is the secret, briefly.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { code, deviceId, label } = body || {};
  if (!code || !deviceId) {
    return Response.json({ error: 'code and deviceId are required' }, { status: 400 });
  }

  const codeHash = await sha256Hex(String(code).toUpperCase());
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT family_id, expires_at, used_at FROM pairing_codes WHERE code_hash = ?'
  ).bind(codeHash).first();

  if (!row || row.used_at !== null || row.expires_at < now) {
    return Response.json({ error: 'invalid or expired code' }, { status: 400 });
  }

  // Claim the code before creating the device: an UPDATE that only
  // succeeds while used_at is still NULL closes the race window the same
  // way helper_action_usage's composite-PK INSERT does (SPEC.md §3) —
  // whichever request claims it first wins, the other sees 0 rows changed.
  const claim = await env.DB.prepare(
    'UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL'
  ).bind(now, codeHash).run();
  if (!claim.meta.changes) {
    return Response.json({ error: 'invalid or expired code' }, { status: 400 });
  }

  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    `INSERT INTO devices (id, family_id, kid_id, token_hash, label, created_at, last_seen, revoked)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 0)`
  ).bind(deviceId, row.family_id, tokenHash, label || null, now, now).run();

  return Response.json({ token, deviceId, familyId: row.family_id }, { status: 201 });
}
