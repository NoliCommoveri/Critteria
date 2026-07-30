import { authenticate, unauthorized } from '../../../_lib/auth.js';

// Binds the calling device to a kid identity at first-run, and lets the
// kid pick/confirm their avatar in the same call (SPEC.md §7 "Kid rows").
export async function onRequestPost({ request, env, params }) {
  const device = await authenticate(request, env);
  if (!device) return unauthorized();

  const kid = await env.DB.prepare('SELECT id, family_id FROM kids WHERE id = ?').bind(params.id).first();
  if (!kid || kid.family_id !== device.familyId) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    // Claim body is optional — confirming a kid's existing avatar needs none.
  }

  if (typeof body.avatar === 'string' && body.avatar) {
    await env.DB.prepare('UPDATE kids SET avatar = ? WHERE id = ?').bind(body.avatar, params.id).run();
  }
  await env.DB.prepare('UPDATE devices SET kid_id = ? WHERE id = ?').bind(params.id, device.deviceId).run();

  return Response.json({ ok: true, kidId: params.id });
}
