import { sha256Hex } from './crypto.js';

// Resolves the `Authorization: Bearer <device-token>` header to its device/
// kid/family context (SPEC.md §7 "Per-request auth"), or null if the
// header is missing or the token doesn't match a non-revoked device. Also
// bumps last_seen on success.
export async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1].trim());
  const device = await env.DB.prepare(
    'SELECT id, family_id, kid_id, revoked FROM devices WHERE token_hash = ?'
  ).bind(tokenHash).first();

  if (!device || device.revoked) return null;

  await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?')
    .bind(Date.now(), device.id)
    .run();

  return { deviceId: device.id, familyId: device.family_id, kidId: device.kid_id };
}

export function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
