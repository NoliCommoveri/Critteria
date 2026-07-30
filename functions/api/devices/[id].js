import { authenticate, unauthorized } from '../../_lib/auth.js';

// Revokes a device (soft delete via the `revoked` flag — matches
// schema.sql, keeps the row for audit/last_seen history).
export async function onRequestDelete({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const result = await env.DB.prepare(
    'UPDATE devices SET revoked = 1 WHERE id = ? AND family_id = ?'
  ).bind(params.id, device.familyId).run();

  if (!result.meta.changes) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
