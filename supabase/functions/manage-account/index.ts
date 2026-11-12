import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const passwordError = (password: string, personalValues: unknown[]) => {
  if (!(password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password))) return 'Password must contain 12–128 characters with uppercase, lowercase, a number, and a symbol.';
  const passwordText = password.toLocaleLowerCase();
  const personalTokens = personalValues.flatMap((value) => String(value || '').split(/[^\p{L}\p{N}]+/u)).filter((value) => value.length >= 3);
  return personalTokens.some((value) => passwordText.includes(value.toLocaleLowerCase())) ? 'Password must not contain the account name or email.' : '';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anon || !service || !authorization) return json({ error: 'Account service is not configured.' }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return json({ error: 'Your session is invalid.' }, 401);

  const { data: actor, error: actorError } = await admin.from('profiles').select('role,status,group_id,first_name,middle_name,last_name,email').eq('id', userResult.user.id).single();
  if (actorError || actor?.status !== 'ACTIVE') return json({ error: 'Your account is not active.' }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'A valid JSON request body is required.' }, 400); }
  if (body.action === 'change-password') {
    const password = String(body.password || '');
    const currentPassword = String(body.current_password || '');
    if (!currentPassword || !userResult.user.email) return json({ error: 'Your current password is required.' }, 400);
    const verifier = createClient(url, anon, { auth: { persistSession: false } });
    const { error: verificationError } = await verifier.auth.signInWithPassword({ email: userResult.user.email, password: currentPassword });
    if (verificationError) return json({ error: 'Your current password is incorrect.' }, 400);
    const issue = passwordError(password, [actor.first_name, actor.middle_name, actor.last_name, String(actor.email || userResult.user.email || '').split('@')[0]]);
    if (issue) return json({ error: issue }, 400);
    const { error } = await admin.auth.admin.updateUserById(userResult.user.id, { password, app_metadata: { ...userResult.user.app_metadata, must_change_password: false } });
    return error ? json({ error: 'Password could not be changed.' }, 400) : json({ updated: true });
  }
  const role = body.role === 'ADMIN' ? 'ADMIN' : body.role === 'MEMBER' ? 'MEMBER' : body.role === 'TREASURER' ? 'TREASURER' : null;
  if (!role || (role === 'ADMIN' && actor.role !== 'SUPER_ADMIN') || (role !== 'ADMIN' && actor.role !== 'ADMIN')) return json({ error: 'You cannot create this account type.' }, 403);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const firstName = String(body.first_name || '').trim();
  const middleName = String(body.middle_name || '').trim() || null;
  const lastName = String(body.last_name || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || !firstName || !lastName) return json({ error: 'Valid name and email fields are required.' }, 400);
  const issue = passwordError(password, [firstName, middleName, lastName, email.split('@')[0]]);
  if (issue) return json({ error: issue }, 400);
  if (role === 'ADMIN' && String(body.group_name || '').trim().length < 2) return json({ error: 'Group name is required.' }, 400);
  if (role === 'MEMBER' && !body.member_id) return json({ error: 'A member profile is required.' }, 400);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name: firstName, middle_name: middleName, last_name: lastName, full_name: [firstName, middleName, lastName].filter(Boolean).join(' '), account_kind: 'MANAGED' },
    app_metadata: { must_change_password: true }
  });
  if (createError || !created.user) return json({ error: createError?.message || 'Account could not be created.' }, 400);

  try {
    const result = role === 'ADMIN'
      ? await caller.rpc('super_admin_approve_request', { p_user_id: created.user.id, p_group_name: String(body.group_name).trim() })
      : await caller.rpc('admin_set_user_access', { p_user_id: created.user.id, p_role: role, p_status: 'ACTIVE', p_member_id: role === 'MEMBER' ? body.member_id : null });
    if (result.error) throw result.error;
    return json({ id: created.user.id });
  } catch (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: error instanceof Error ? error.message : 'Account setup failed.' }, 400);
  }
});
