import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const SYSTEM_NAME = 'IPON Group Savings Tracker';

const passwordError = (password: string, personalValues: unknown[]) => {
  if (!(password.length >= 8 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password))) {
    return 'Password must contain 8–128 characters with uppercase, lowercase, a number, and a symbol.';
  }
  const passwordText = password.toLocaleLowerCase();
  const personalTokens = personalValues.flatMap((value) => String(value || '').split(/[^\p{L}\p{N}]+/u)).filter((value) => value.length >= 3);
  return personalTokens.some((value) => passwordText.includes(value.toLocaleLowerCase())) ? 'Password must not contain the account name or email.' : '';
};

const tokenAal = (token: string) => {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))).aal || 'aal1');
  } catch { return 'aal1'; }
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function fallbackNamesFromEmail(email: string) {
  const local = email.split('@')[0] || 'Member';
  const words = local.replace(/[^a-zA-Z\s._-]/g, ' ').split(/[._\s-]+/).map((w) => w.trim()).filter((w) => /^[a-zA-Z]{2,}$/.test(w));
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const first = words[0] ? cap(words[0]).slice(0, 40) : 'Group';
  const last = words[1] ? cap(words.slice(1).join(' ')).slice(0, 40) : 'Member';
  return { first, last };
}

function parseSender(raw: string | undefined, fallbackName: string, fallbackEmail: string) {
  const value = String(raw || '').trim();
  const match = value.match(/^(.*?)<([^<>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, '') || fallbackName,
      email: match[2].trim() || fallbackEmail
    };
  }
  if (value.includes('@')) return { name: fallbackName, email: value };
  return { name: fallbackName, email: fallbackEmail };
}

async function deliverEmail({
  toEmail,
  recipientName,
  subject,
  html,
  plainText,
  fallbackEmail
}: {
  toEmail: string;
  recipientName: string;
  subject: string;
  html: string;
  plainText: string;
  fallbackEmail?: string | null;
}) {
  async function postEmail(endpoint: string, headers: Record<string, string>, payload: unknown, providerName: string) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        return { email_sent: false, email_error: errData?.message || `${providerName} returned status ${res.status}.`, invite_subject: subject, invite_message: plainText };
      }
      return { email_sent: true, email_error: null, invite_subject: subject, invite_message: plainText };
    } catch (err) {
      return { email_sent: false, email_error: err instanceof Error ? err.message : `Unable to reach ${providerName}.`, invite_subject: subject, invite_message: plainText };
    }
  }

  const brevoKey = Deno.env.get('BREVO_API_KEY')?.trim();
  const resendKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const rawFrom = Deno.env.get('INVITE_FROM_EMAIL')?.trim() || Deno.env.get('BREVO_SENDER_EMAIL')?.trim();

  if (brevoKey) {
    const sender = parseSender(rawFrom, SYSTEM_NAME, String(fallbackEmail || '').trim());
    if (!sender.email) {
      return { email_sent: false, email_error: 'Set INVITE_FROM_EMAIL (or BREVO_SENDER_EMAIL) to your verified Brevo sender email.', invite_subject: subject, invite_message: plainText };
    }
    return postEmail(
      'https://api.brevo.com/v3/smtp/email',
      { Accept: 'application/json', 'Content-Type': 'application/json', 'api-key': brevoKey },
      { sender, to: [{ email: toEmail, name: recipientName }], subject, htmlContent: html, textContent: plainText },
      'Brevo'
    );
  }

  if (resendKey) {
    return postEmail(
      'https://api.resend.com/emails',
      { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      { from: rawFrom || `${SYSTEM_NAME} <onboarding@resend.dev>`, to: [toEmail], subject, html, text: plainText },
      'Resend'
    );
  }

  return {
    email_sent: false,
    email_error: 'Automatic email service (BREVO_API_KEY or RESEND_API_KEY) is not configured yet.',
    invite_subject: subject,
    invite_message: plainText
  };
}

async function sendInviteEmail({
  toEmail,
  recipientName,
  inviterName,
  inviterEmail,
  groupName,
  roleLabel,
  temporaryPassword,
  existingAccount,
  loginUrl
}: {
  toEmail: string;
  recipientName: string;
  inviterName: string;
  inviterEmail?: string | null;
  groupName: string;
  roleLabel: string;
  temporaryPassword: string;
  existingAccount: boolean;
  loginUrl: string;
}) {
  const subject = `${inviterName} invited you to join "${groupName}" on ${SYSTEM_NAME}`;
  const credentialBlock = existingAccount
    ? `Email: ${toEmail}\nPassword: Use your existing ${SYSTEM_NAME} password`
    : `Email: ${toEmail}\nTemporary password: ${temporaryPassword}`;
  const noteLine = existingAccount
    ? 'Sign in with your existing account and select this group from the group switcher at the top of your dashboard.'
    : 'Use the email and temporary password provided above to sign in, then update your password after logging in.';
  const plainText = [
    `Hello ${recipientName},`,
    '',
    `${inviterName} invited you to join the "${groupName}" savings group as a ${roleLabel} on ${SYSTEM_NAME}.`,
    '',
    credentialBlock,
    `Sign in here: ${loginUrl}`,
    '',
    noteLine
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #163029; line-height: 1.55; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6d6552;">${escapeHtml(SYSTEM_NAME)}</p>
      <h2 style="margin: 0 0 14px; font-size: 20px; color: #163029;">You're invited to ${escapeHtml(groupName)}</h2>
      <p style="margin: 0 0 16px;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
      <p style="margin: 0 0 16px;"><strong>${escapeHtml(inviterName)}</strong> invited you to join the savings group <strong>${escapeHtml(groupName)}</strong> (${escapeHtml(roleLabel)}) on <strong>${escapeHtml(SYSTEM_NAME)}</strong>.</p>
      <div style="background: #ffffff; border: 1px solid #d9d6c8; border-radius: 10px; padding: 14px 16px; margin: 0 0 18px;">
        <p style="margin: 0 0 6px;"><strong>Email:</strong> ${escapeHtml(toEmail)}</p>
        ${existingAccount
          ? `<p style="margin: 0;"><strong>Password:</strong> Use your existing ${escapeHtml(SYSTEM_NAME)} password</p>`
          : `<p style="margin: 0;"><strong>Temporary password:</strong> <code style="background: #f1efe7; padding: 2px 6px; border-radius: 6px; font-size: 14px;">${escapeHtml(temporaryPassword)}</code></p>`}
      </div>
      <p style="margin: 0 0 18px;">
        <a href="${escapeHtml(loginUrl)}" style="display: inline-block; background: #163029; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 18px; border-radius: 10px;">Sign in to ${escapeHtml(SYSTEM_NAME)}</a>
      </p>
      <p style="margin: 0; font-size: 13px; color: #5c5749;">${escapeHtml(noteLine)}</p>
    </div>
  `.trim();

  return deliverEmail({
    toEmail,
    recipientName,
    subject,
    html,
    plainText,
    fallbackEmail: inviterEmail
  });
}

async function sendAdminRequestDecisionEmail({
  toEmail,
  recipientName,
  decision,
  groupName,
  reviewNote,
  subject: customSubject,
  senderEmail,
  loginUrl
}: {
  toEmail: string;
  recipientName: string;
  decision: 'APPROVED' | 'REJECTED';
  groupName?: string | null;
  reviewNote?: string | null;
  subject?: string | null;
  senderEmail?: string | null;
  loginUrl: string;
}) {
  const approved = decision === 'APPROVED';
  const safeGroup = String(groupName || '').trim() || 'your savings group';
  const safeReason = String(reviewNote || '').trim();
  const subject = String(customSubject || '').trim() || (approved
    ? `Congratulations! Your administrator request on ${SYSTEM_NAME} was approved`
    : `We're sorry, your administrator request on ${SYSTEM_NAME} was declined`);
  const plainText = approved
    ? [
        `Hello ${recipientName},`,
        '',
        `Congratulations! Your administrator access request on ${SYSTEM_NAME} has been approved.`,
        `Your savings group "${safeGroup}" is now ready.`,
        '',
        `Sign in here using the email and password you registered: ${loginUrl}`,
        '',
        'You can now manage your savings group, customize its picture, and invite your members.'
      ].join('\n')
    : [
        `Hello ${recipientName},`,
        '',
        `We're sorry, but your administrator access request on ${SYSTEM_NAME} was not approved at this time.`,
        safeReason ? `Reason for decline: ${safeReason}` : '',
        '',
        'Please note that this email address cannot submit another administrator request.',
        'You may reach out to the platform owner if you have questions.'
      ].filter(Boolean).join('\n');

  const html = approved
    ? `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #163029; line-height: 1.55; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #1f6a43;">${escapeHtml(SYSTEM_NAME)}</p>
        <h2 style="margin: 0 0 14px; font-size: 20px; color: #163029;">Congratulations!</h2>
        <p style="margin: 0 0 14px;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="margin: 0 0 16px;">Congratulations! Your administrator access request on <strong>${escapeHtml(SYSTEM_NAME)}</strong> has been approved. Your savings group <strong>${escapeHtml(safeGroup)}</strong> is ready to use.</p>
        <p style="margin: 0 0 18px;">
          <a href="${escapeHtml(loginUrl)}" style="display: inline-block; background: #163029; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 18px; border-radius: 10px;">Sign in to ${escapeHtml(SYSTEM_NAME)}</a>
        </p>
        <p style="margin: 0; font-size: 13px; color: #5c5749;">Sign in with the email address (<strong>${escapeHtml(toEmail)}</strong>) and password you provided when requesting access.</p>
      </div>
    `.trim()
    : `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #163029; line-height: 1.55; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #91332e;">${escapeHtml(SYSTEM_NAME)}</p>
        <h2 style="margin: 0 0 14px; font-size: 20px; color: #163029;">Administrator request declined</h2>
        <p style="margin: 0 0 14px;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="margin: 0 0 14px;">We're sorry, but your administrator access request on <strong>${escapeHtml(SYSTEM_NAME)}</strong> was not approved at this time.</p>
        ${safeReason ? `<p style="margin: 0 0 14px; padding: 12px 14px; border-radius: 8px; background: #fff; border: 1px solid #e4c6c3;"><strong>Reason for decline:</strong> ${escapeHtml(safeReason)}</p>` : ''}
        <p style="margin: 0; font-size: 13px; color: #5c5749;">Please note that this email address cannot submit another administrator request. Contact the platform owner if you need further assistance.</p>
      </div>
    `.trim();

  return deliverEmail({
    toEmail,
    recipientName,
    subject,
    html,
    plainText,
    fallbackEmail: senderEmail
  });
}

async function sendAdminRequestOtpEmail({
  toEmail,
  recipientName,
  code,
  senderEmail
}: {
  toEmail: string;
  recipientName: string;
  code: string;
  senderEmail?: string | null;
}) {
  const safeName = String(recipientName || '').trim() || 'Applicant';
  const subject = `Your ${SYSTEM_NAME} verification code is ${code}`;
  const plainText = [
    `Hello ${safeName},`,
    '',
    `Your email verification code for requesting administrator access on ${SYSTEM_NAME} is:`,
    '',
    code,
    '',
    'This verification code expires in 10 minutes.',
    'If you did not request administrator access on IPON, please ignore this email. No account or request has been created.'
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #163029; line-height: 1.55; max-width: 540px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #1f6a43;">${escapeHtml(SYSTEM_NAME)}</p>
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #163029;">Confirm your email address</h2>
      <p style="margin: 0 0 14px;">Hello <strong>${escapeHtml(safeName)}</strong>,</p>
      <p style="margin: 0 0 18px;">Enter the 6-digit verification code below to verify that you own this email address and complete your administrator request on <strong>${escapeHtml(SYSTEM_NAME)}</strong>:</p>
      <div style="margin: 0 0 18px; padding: 16px 20px; background: #ffffff; border: 1px solid #c9c5b5; border-radius: 12px; text-align: center;">
        <span style="font-family: monospace, Consolas, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; color: #163029;">${escapeHtml(code)}</span>
      </div>
      <p style="margin: 0 0 14px; font-size: 13px; color: #5c5749;">This verification code will expire in <strong>10 minutes</strong>.</p>
      <p style="margin: 0; font-size: 12px; color: #7a7566; border-top: 1px solid #e0ddd0; padding-top: 14px;">If you did not submit this request, you can safely ignore this email. No administrator request or account will be created without this verification code.</p>
    </div>
  `.trim();

  return deliverEmail({
    toEmail,
    recipientName: safeName,
    subject,
    html,
    plainText,
    fallbackEmail: senderEmail
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anon || !service || !authorization) return json({ error: 'Account service is not configured.' }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'A valid JSON request body is required.' }, 400); }

  if (body.action === 'send-verification-otp') {
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim();
    if (!email || !email.includes('@')) return json({ error: 'A valid email address is required.' }, 400);

    const { data: result, error: rpcError } = await admin.rpc('request_admin_email_verification', {
      p_email: email,
      p_full_name: fullName
    });

    if (rpcError || !result || !result.success) {
      return json({ error: result?.message || rpcError?.message || 'Could not generate verification code.' }, 400);
    }

    const emailOutcome = await sendAdminRequestOtpEmail({
      toEmail: email,
      recipientName: fullName,
      code: result.code
    });

    return json({
      success: true,
      email_sent: emailOutcome.email_sent,
      email_error: emailOutcome.email_error
    });
  }

  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return json({ error: 'Your session is invalid.' }, 401);
  const hasVerifiedMfa = userResult.user.factors?.some((factor) => factor.status === 'verified');
  if (hasVerifiedMfa && tokenAal(token) !== 'aal2') return json({ error: 'Complete multi-factor authentication before continuing.' }, 403);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ANNOUNCEMENTS_BUCKET = 'announcements';

  async function ensureAnnouncementsBucket(client: ReturnType<typeof createClient>) {
    const { error } = await client.storage.createBucket(ANNOUNCEMENTS_BUCKET, { public: false, fileSizeLimit: 52428800 });
    if (error && !/already exists/i.test(error.message || '')) throw error;
  }

  function actorAnnouncementPrefix(actor: { role: string; group_id: string | null }, userId: string) {
    if (actor.role === 'SUPER_ADMIN') return `platform/${userId}/`;
    if (actor.role === 'ADMIN' && actor.group_id) return `group/${actor.group_id}/`;
    return null;
  }

  const { data: actor, error: actorError } = await admin
    .from('profiles')
    .select('role,status,group_id,first_name,middle_name,last_name,full_name,email')
    .eq('id', userResult.user.id)
    .single();
  if (actorError || actor?.status !== 'ACTIVE') return json({ error: 'Your account is not active.' }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'A valid JSON request body is required.' }, 400); }

  if (body.action === 'announcement-upload-urls') {
    const prefix = actorAnnouncementPrefix(actor, userResult.user.id);
    const announcementId = String(body.announcement_id || '').trim();
    const files = Array.isArray(body.files) ? body.files : [];
    if (!prefix) return json({ error: 'Only Owner or Group Administrators can attach announcement media.' }, 403);
    if (!UUID_RE.test(announcementId) || !files.length || files.length > 20) return json({ error: 'Invalid announcement media upload request.' }, 400);
    try {
      await ensureAnnouncementsBucket(admin);
      const uploads = [];
      for (let i = 0; i < files.length; i += 1) {
        const entry = (files[i] || {}) as { name?: unknown; kind?: unknown; type?: unknown };
        const cleanName = String(entry.name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'media';
        const kind = entry.kind === 'video' ? 'video' : 'image';
        const path = `${prefix}${announcementId}/${i}-${crypto.randomUUID().slice(0, 8)}-${cleanName}`;
        const { data, error } = await admin.storage.from(ANNOUNCEMENTS_BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw error || new Error('Could not create upload URL.');
        uploads.push({ path, token: data.token, name: String(entry.name || cleanName).slice(0, 120), kind, type: String(entry.type || '') });
      }
      return json({ uploads });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unable to prepare media uploads.' }, 400);
    }
  }

  if (body.action === 'announcement-view-urls') {
    const announcementId = String(body.announcement_id || '').trim();
    if (!UUID_RE.test(announcementId)) return json({ error: 'Invalid announcement ID.' }, 400);
    const { data: row, error: rowError } = await caller.from('announcements').select('id,attachments').eq('id', announcementId).is('deleted_at', null).single();
    if (rowError || !row) return json({ error: 'Announcement not found.' }, 404);
    const list = Array.isArray(row.attachments) ? row.attachments : [];
    const paths = list.map((item: { path?: unknown }) => String(item?.path || '')).filter(Boolean);
    if (!paths.length) return json({ urls: {} });
    const { data: signed, error: signError } = await admin.storage.from(ANNOUNCEMENTS_BUCKET).createSignedUrls(paths, 3600);
    if (signError) return json({ error: signError.message || 'Unable to sign media URLs.' }, 400);
    const urls: Record<string, string> = {};
    (signed || []).forEach((item: { path?: string | null; signedUrl?: string | null }) => {
      if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    });
    return json({ urls });
  }

  if (body.action === 'announcement-cleanup-media') {
    const prefix = actorAnnouncementPrefix(actor, userResult.user.id);
    if (!prefix) return json({ error: 'Permission denied.' }, 403);
    const requested = Array.isArray(body.paths) ? body.paths.map((value) => String(value || '')).filter(Boolean) : [];
    const allowedPaths = requested.filter((path) => !path.includes('..') && (actor.role === 'SUPER_ADMIN' || path.startsWith(prefix)));
    if (!allowedPaths.length) return json({ removed: 0 });
    const { error: removeError } = await admin.storage.from(ANNOUNCEMENTS_BUCKET).remove(allowedPaths);
    if (removeError) return json({ error: removeError.message || 'Unable to delete media files.' }, 400);
    return json({ removed: allowedPaths.length });
  }

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

  if (body.action === 'admin-set-password') {
    const targetId = String(body.user_id || '').trim();
    const password = String(body.password || '');
    if (!targetId) return json({ error: 'A target account is required.' }, 400);
    const { data: target, error: targetError } = await admin.from('profiles').select('id,role,group_id,first_name,middle_name,last_name,email').eq('id', targetId).single();
    if (targetError || !target) return json({ error: 'Target account not found.' }, 404);
    let inActorGroup = Boolean(actor.group_id && target.group_id === actor.group_id && ['MEMBER', 'TREASURER'].includes(target.role));
    if (!inActorGroup && actor.role === 'ADMIN' && actor.group_id) {
      const { data: gm } = await admin.from('group_memberships').select('role').eq('group_id', actor.group_id).eq('user_id', target.id).maybeSingle();
      inActorGroup = Boolean(gm && ['MEMBER', 'TREASURER'].includes(gm.role));
    }
    const allowed = (actor.role === 'SUPER_ADMIN' && target.role !== 'SUPER_ADMIN') || (actor.role === 'ADMIN' && inActorGroup);
    if (!allowed) return json({ error: 'You cannot change the password for this account.' }, 403);
    const issue = passwordError(password, [target.first_name, target.middle_name, target.last_name, String(target.email || '').split('@')[0]]);
    if (issue) return json({ error: issue }, 400);
    const { data: targetAuth } = await admin.auth.admin.getUserById(target.id);
    const { error } = await admin.auth.admin.updateUserById(target.id, { password, app_metadata: { ...(targetAuth?.user?.app_metadata || {}), must_change_password: false } });
    return error ? json({ error: 'Password could not be updated.' }, 400) : json({ updated: true });
  }

  if (body.action === 'admin-request-decision-email') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can send decision emails.' }, 403);
    const targetId = String(body.user_id || '').trim();
    const decision = body.decision === 'APPROVED' ? 'APPROVED' : body.decision === 'REJECTED' ? 'REJECTED' : null;
    if (!UUID_RE.test(targetId) || !decision) return json({ error: 'A valid target account and decision are required.' }, 400);
    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id,email,full_name,first_name,middle_name,last_name,status,group_id')
      .eq('id', targetId)
      .single();
    if (targetError || !target || !target.email) return json({ error: 'Target account or email not found.' }, 404);
    const expectedStatus = decision === 'APPROVED' ? 'ACTIVE' : 'DISABLED';
    if (target.status !== expectedStatus) return json({ error: 'Target request status does not match decision.' }, 400);

    let resolvedGroupName = String(body.group_name || '').trim() || null;
    if (!resolvedGroupName && target.group_id) {
      const { data: groupRow } = await admin.from('groups').select('name').eq('id', target.group_id).maybeSingle();
      resolvedGroupName = groupRow?.name || null;
    }
    const recipientName = target.full_name || [target.first_name, target.middle_name, target.last_name].filter(Boolean).join(' ') || target.email;
    const originUrl = typeof body.login_url === 'string' && /^https?:\/\//i.test(body.login_url)
      ? body.login_url
      : 'https://my-ipon.vercel.app/login.html';

    const emailOutcome = await sendAdminRequestDecisionEmail({
      toEmail: target.email,
      recipientName,
      decision,
      groupName: resolvedGroupName,
      reviewNote: String(body.review_note || '').trim() || null,
      subject: String(body.subject || body.email_subject || '').trim() || null,
      senderEmail: actor.email || userResult.user.email || null,
      loginUrl: originUrl
    });

    return json({ email_sent: emailOutcome.email_sent, email_error: emailOutcome.email_error });
  }

  if (body.action === 'unblock-admin-request') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can unblock requests.' }, 403);
    const targetId = String(body.user_id || '').trim();
    if (!UUID_RE.test(targetId)) return json({ error: 'A valid target user ID is required.' }, 400);

    const { data: unblockResult, error: unblockError } = await admin.rpc('super_admin_unblock_admin_request', {
      p_user_id: targetId
    });

    if (unblockError) {
      return json({ error: unblockError.message || 'Could not unblock administrator request.' }, 400);
    }

    await admin.auth.admin.deleteUser(targetId);

    return json({
      unblocked: true,
      email: unblockResult?.email || null,
      full_name: unblockResult?.full_name || null
    });
  }

  const role = body.role === 'ADMIN' ? 'ADMIN' : body.role === 'MEMBER' ? 'MEMBER' : body.role === 'TREASURER' ? 'TREASURER' : null;
  if (!role || (role === 'ADMIN' && actor.role !== 'SUPER_ADMIN') || (role !== 'ADMIN' && actor.role !== 'ADMIN')) {
    return json({ error: 'You cannot create this account type.' }, 403);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fallback = fallbackNamesFromEmail(email);
  const firstName = String(body.first_name || '').trim() || fallback.first;
  const middleName = String(body.middle_name || '').trim() || null;
  const lastName = String(body.last_name || '').trim() || fallback.last;
  const contactNumber = String(body.contact_number || '').trim() || null;

  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'A valid email address is required.' }, 400);
  if (role === 'ADMIN' && (!String(body.first_name || '').trim() || !String(body.last_name || '').trim())) {
    return json({ error: 'Valid name and email fields are required.' }, 400);
  }
  if (role === 'ADMIN' && String(body.group_name || '').trim().length < 2) return json({ error: 'Group name is required.' }, 400);

  // Check if user email already exists (allowed for cross-group Member / Treasurer invites by Group Admins).
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id,role,full_name,email')
    .ilike('email', email)
    .maybeSingle();

  if (existingProfile) {
    if (role === 'ADMIN') return json({ error: 'An account with this email already exists.' }, 400);
    if (existingProfile.role === 'SUPER_ADMIN') {
      return json({ error: 'This email cannot be invited into a savings group.' }, 400);
    }
  } else {
    const issue = passwordError(password, [firstName, middleName, lastName, email.split('@')[0]]);
    if (issue) return json({ error: issue }, 400);
  }

  let targetMemberId: string | null = role === 'MEMBER' && body.member_id ? String(body.member_id).trim() : null;
  let createdMemberHere = false;

  if (role === 'MEMBER' && !targetMemberId) {
    if (!body.create_member) return json({ error: 'A member profile is required.' }, 400);
    const todayManila = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const monthlyAmount = Number(body.monthly_contribution_amount) > 0 ? Number(body.monthly_contribution_amount) : 100;
    const { data: newMemberId, error: memberError } = await caller.rpc('create_member', {
      p_first_name: firstName,
      p_middle_name: middleName,
      p_last_name: lastName,
      p_contact_number: contactNumber || '09000000000',
      p_date_registered: todayManila,
      p_monthly_contribution_amount: monthlyAmount,
      p_notes: 'Invited by group administrator'
    });
    if (memberError || !newMemberId) return json({ error: memberError?.message || 'Unable to create member profile.' }, 400);
    targetMemberId = String(newMemberId);
    createdMemberHere = true;
  }

  let targetUserId: string;
  let createdAuthHere = false;
  if (existingProfile) {
    targetUserId = existingProfile.id;
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        full_name: [firstName, middleName, lastName].filter(Boolean).join(' '),
        contact_number: contactNumber,
        account_kind: 'MANAGED'
      },
      app_metadata: { must_change_password: true }
    });
    if (createError || !created.user) {
      if (createdMemberHere && targetMemberId) {
        await admin.from('members').delete().eq('id', targetMemberId);
      }
      return json({ error: createError?.message || 'Account could not be created.' }, 400);
    }
    targetUserId = created.user.id;
    createdAuthHere = true;
  }

  try {
    const result = role === 'ADMIN'
      ? await caller.rpc('super_admin_approve_request', { p_user_id: targetUserId, p_group_name: String(body.group_name).trim() })
      : await caller.rpc('admin_set_user_access', { p_user_id: targetUserId, p_role: role, p_status: 'ACTIVE', p_member_id: role === 'MEMBER' ? targetMemberId : null });
    if (result.error) throw result.error;

    if (role === 'ADMIN') return json({ id: targetUserId });

    const [{ data: groupRow }, inviterName] = await Promise.all([
      actor.group_id ? admin.from('groups').select('name').eq('id', actor.group_id).maybeSingle() : Promise.resolve({ data: null }),
      Promise.resolve(actor.full_name || [actor.first_name, actor.middle_name, actor.last_name].filter(Boolean).join(' ') || 'Group Administrator')
    ]);
    const groupName = groupRow?.name || 'Savings Group';
    const recipientName = existingProfile?.full_name || [firstName, middleName, lastName].filter(Boolean).join(' ');
    const originUrl = typeof body.login_url === 'string' && /^https?:\/\//i.test(body.login_url)
      ? body.login_url
      : 'https://my-ipon.vercel.app/login.html';

    if (existingProfile && actor.group_id) {
      await admin.from('notifications').insert({
        recipient_id: targetUserId,
        group_id: actor.group_id,
        type: 'GROUP_INVITE',
        title: `Added to ${groupName}`,
        body: `${inviterName} added you to ${groupName} as a ${role.toLowerCase()}.`,
        link: 'dashboard.html'
      }).then(() => null, () => null);
    }

    const emailOutcome = body.send_invite === false
      ? { email_sent: false, email_error: null, invite_subject: '', invite_message: '' }
      : await sendInviteEmail({
          toEmail: email,
          recipientName,
          inviterName,
          inviterEmail: actor.email,
          groupName,
          roleLabel: role === 'TREASURER' ? 'Treasurer' : 'Member',
          temporaryPassword: password,
          existingAccount: Boolean(existingProfile),
          loginUrl: originUrl
        });

    return json({
      id: targetUserId,
      member_id: targetMemberId,
      existing_account: Boolean(existingProfile),
      ...emailOutcome
    });
  } catch (error) {
    if (createdAuthHere) await admin.auth.admin.deleteUser(targetUserId);
    if (createdMemberHere && targetMemberId) await admin.from('members').delete().eq('id', targetMemberId);
    return json({ error: error instanceof Error ? error.message : 'Account setup failed.' }, 400);
  }
});
