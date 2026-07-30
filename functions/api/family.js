import { sha256Hex, randomHex, newDeviceToken } from '../_lib/crypto.js';

// One-time, SIGNUP_SECRET-gated family creation (SPEC.md §7, §9 Step 9).
// Only one family exists per deployment, so this also refuses to run a
// second time even with a correct secret.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { signupSecret, deviceId, label } = body || {};
  if (!env.SIGNUP_SECRET || signupSecret !== env.SIGNUP_SECRET) {
    return Response.json({ error: 'invalid signup secret' }, { status: 401 });
  }
  if (!deviceId || typeof deviceId !== 'string') {
    return Response.json({ error: 'deviceId is required' }, { status: 400 });
  }

  const existing = await env.DB.prepare('SELECT id FROM families LIMIT 1').first();
  if (existing) {
    return Response.json({ error: 'a family already exists on this deployment' }, { status: 409 });
  }

  const now = Date.now();
  const familyId = randomHex(16);
  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO families (id, created_at) VALUES (?, ?)').bind(familyId, now),
    env.DB.prepare(
      `INSERT INTO devices (id, family_id, kid_id, token_hash, label, created_at, last_seen, revoked)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 0)`
    ).bind(deviceId, familyId, tokenHash, label || null, now, now)
  ]);

  return Response.json({ token, deviceId, familyId }, { status: 201 });
}
