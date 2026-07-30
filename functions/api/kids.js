import { authenticate, unauthorized } from '../_lib/auth.js';

// Family-scoped kid roster (SPEC.md §7 "Kid rows"). The bootstrap device's
// setup UI POSTs one row per sibling up front; any already-paired device
// can add more later.
export async function onRequestGet({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const { results } = await env.DB.prepare(
    'SELECT id, display_name, avatar, created_at FROM kids WHERE family_id = ? ORDER BY created_at'
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

export async function onRequestPost({ request, env }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const displayName = (body && typeof body.displayName === 'string' ? body.displayName : '').trim();
  if (!displayName) {
    return Response.json({ error: 'displayName is required' }, { status: 400 });
  }
  const avatar = typeof body.avatar === 'string' ? body.avatar : null;

  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO kids (id, family_id, display_name, avatar, pin_hash, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
  ).bind(id, device.familyId, displayName, avatar, now).run();

  return Response.json({ id, displayName, avatar, createdAt: now }, { status: 201 });
}
