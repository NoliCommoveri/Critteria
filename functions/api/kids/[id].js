import { authenticate, unauthorized } from '../../_lib/auth.js';

// Update a kid's profile (SPEC.md §9 file layout). PIN edits deliberately
// are NOT handled here yet: pin_hash is plain SHA-256 in v1 (§7, schema.sql)
// and must not gate anything server-side until it's upgraded to
// argon2/scrypt, so this endpoint only ever touches display_name/avatar.
export async function onRequestPatch({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const kid = await env.DB.prepare('SELECT id, family_id FROM kids WHERE id = ?').bind(params.id).first();
  if (!kid || kid.family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const updates = [];
  const values = [];
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    updates.push('display_name = ?');
    values.push(body.displayName.trim());
  }
  if (typeof body.avatar === 'string') {
    updates.push('avatar = ?');
    values.push(body.avatar);
  }
  if (!updates.length) {
    return Response.json({ error: 'nothing to update' }, { status: 400 });
  }

  values.push(params.id);
  await env.DB.prepare(`UPDATE kids SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return Response.json({ ok: true });
}
