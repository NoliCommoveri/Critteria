import { authenticate, unauthorized } from '../_lib/auth.js';

// Family-scoped device roster, for a parent-facing "manage devices" view.
export async function onRequestGet({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const { results } = await env.DB.prepare(
    'SELECT id, kid_id, label, created_at, last_seen, revoked FROM devices WHERE family_id = ? ORDER BY created_at'
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
