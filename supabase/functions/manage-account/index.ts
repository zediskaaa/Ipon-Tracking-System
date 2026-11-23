import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const SYSTEM_NAME = 'myIPON';
const EMAIL_LOGO_URL = 'https://my-ipon.vercel.app/assets/icon-192.png?v=2';
const APP_LOGIN_URL = 'https://my-ipon.vercel.app/login.html';
const R2_PATH_MARKER = '/r2/';
let r2Client: AwsClient | null = null;
const CLERK_ISSUER = 'https://solid-gannet-2021.clerk.accounts.dev';
const clerkJwks = createRemoteJWKSet(new URL(`${CLERK_ISSUER}/.well-known/jwks.json`));

function r2Storage() {
  const accountId = String(Deno.env.get('R2_ACCOUNT_ID') || '').trim();
  const accessKeyId = String(Deno.env.get('R2_ACCESS_KEY_ID') || '').trim();
  const secretAccessKey = String(Deno.env.get('R2_SECRET_ACCESS_KEY') || '').trim();
  const bucket = String(Deno.env.get('R2_BUCKET') || '').trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  r2Client ||= new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 2 });
  return { accountId, bucket, client: r2Client };
}

function isR2Path(path: string) {
  return String(path || '').includes(R2_PATH_MARKER);
}

function r2ObjectUrl(logicalBucket: string, path: string) {
  const storage = r2Storage();
  if (!storage) throw new Error('Cloud media storage is not configured.');
  const key = `${logicalBucket}/${path}`.split('/').map(encodeURIComponent).join('/');
  return new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${storage.bucket}/${key}`);
}

async function signR2Object(logicalBucket: string, path: string, method: 'GET' | 'PUT', contentType = '', downloadName = '') {
  const storage = r2Storage();
  if (!storage) throw new Error('Cloud media storage is not configured.');
  const target = r2ObjectUrl(logicalBucket, path);
  target.searchParams.set('X-Amz-Expires', method === 'PUT' ? '900' : '3600');
  if (downloadName) target.searchParams.set('response-content-disposition', `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"`);
  const request = new Request(target, {
    method,
    headers: contentType ? { 'Content-Type': contentType } : undefined
  });
  return (await storage.client.sign(request, { aws: { signQuery: true } })).url;
}

async function createPrivateViewUrls(admin: any, logicalBucket: string, paths: string[]) {
  const urls: Record<string, string> = {};
  const r2Paths = paths.filter(isR2Path);
  const legacyPaths = paths.filter((path) => !isR2Path(path));
  await Promise.all(r2Paths.map(async (path) => { urls[path] = await signR2Object(logicalBucket, path, 'GET'); }));
  for (let i = 0; i < legacyPaths.length; i += 100) {
    const { data, error } = await admin.storage.from(logicalBucket).createSignedUrls(legacyPaths.slice(i, i + 100), 3600);
    if (error) throw error;
    (data || []).forEach((item: { path?: string | null; signedUrl?: string | null }) => {
      if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    });
  }
  return urls;
}

async function removePrivateObjects(admin: any, logicalBucket: string, paths: string[]) {
  const r2Paths = paths.filter(isR2Path);
  const legacyPaths = paths.filter((path) => !isR2Path(path));
  if (r2Paths.length) {
    const storage = r2Storage();
    if (!storage) throw new Error('Cloud media storage is not configured.');
    await Promise.all(r2Paths.map(async (path) => {
      const response = await storage.client.fetch(r2ObjectUrl(logicalBucket, path), { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error(`R2 delete failed (${response.status}).`);
    }));
  }
  if (legacyPaths.length) {
    const { error } = await admin.storage.from(logicalBucket).remove(legacyPaths);
    if (error) throw error;
  }
  return paths.length;
}

function emailBrandHeaderMarkup() {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px;">
      <tr>
        <td style="vertical-align: middle; padding-right: 10px;">
          <img src="${EMAIL_LOGO_URL}" alt="myIPON" width="34" height="34" style="display: block; width: 34px; height: 34px; border-radius: 8px; border: 0;" />
        </td>
        <td style="vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 800; letter-spacing: 0.01em; color: #163029;">
          myIPON
        </td>
      </tr>
    </table>
  `.trim();
}

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

const DEVICE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_OTP_TTL_MS = 10 * 60 * 1000;
const TRUSTED_DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureSixDigitCode() {
  const values = new Uint32Array(1);
  const ceiling = 0x100000000 - (0x100000000 % 1000000);
  do crypto.getRandomValues(values); while (values[0] >= ceiling);
  return String(values[0] % 1000000).padStart(6, '0');
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'your email address';
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(6, Math.max(2, local.length - 2)))}@${domain}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function normalizeNamePart(value: unknown) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

const NAME_LOWERCASE_PARTICLES = new Set([
  'de', 'del', 'dela', 'los', 'las', 'la', 'le', 'da', 'di', 'do', 'dos', 'das',
  'van', 'von', 'den', 'der', 'ter', 'ten', 'ben', 'bin', 'binti', 'ibn', 'al'
]);
const NAME_ROMAN_SUFFIXES = new Set(['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);

function validFormalNamePart(value: unknown, { allowSingleInitial = false, required = true } = {}) {
  const cleaned = normalizeNamePart(value);
  if (!cleaned) return !required;
  if (cleaned.length > 80) return false;
  if (!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(cleaned)) return false;
  const letterCount = cleaned.replace(/[^\p{L}]/gu, '').length;
  if (!allowSingleInitial && letterCount < 2) return false;
  const words = cleaned.split(' ');
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (i > 0) {
      if (NAME_LOWERCASE_PARTICLES.has(word)) {
        if (i >= words.length - 1) return false;
        continue;
      }
      if (i === words.length - 1 && NAME_ROMAN_SUFFIXES.has(word)) continue;
    }
    const segments = word.split(/['\u2019-]/);
    for (const seg of segments) {
      if (!seg) return false;
      if (!/^\p{Lu}/u.test(seg) || /\p{Lu}{2}/u.test(seg)) return false;
      if (seg.length === 1) {
        if (segments.length > 1) continue;
        if (!(allowSingleInitial && words.length === 1)) return false;
      } else if (!/^\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)*$/u.test(seg)) {
        return false;
      }
    }
  }
  return true;
}

function fallbackNamesFromEmail(email: string) {
  const local = email.split('@')[0] || 'Member';
  const words = local.replace(/[^a-zA-Z\s._-]/g, ' ').split(/[._\s-]+/).map((w) => w.trim()).filter((w) => /^[a-zA-Z]{2,}$/.test(w));
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const first = words[0] ? cap(words[0]).slice(0, 40) : 'Group';
  const last = words[1] ? words.slice(1, 3).map(cap).join(' ').slice(0, 40) : 'Member';
  return { first, last };
}

function parseSender(raw: string | undefined, fallbackName: string, fallbackEmail: string) {
  const value = String(raw || '').trim();
  const safeFallback = fallbackEmail?.trim() || 'breadspanish231@gmail.com';
  const match = value.match(/^(.*?)<([^<>]+)>$/);
  if (match) {
    const parsedName = match[1].trim().replace(/^["']|["']$/g, '');
    const normalizedName = !parsedName || /^IPON(?:\s+Group\s+Savings\s+Tracker)?$/i.test(parsedName)
      ? fallbackName
      : parsedName;
    return {
      name: normalizedName,
      email: match[2].trim() || safeFallback
    };
  }
  if (value.includes('@')) return { name: fallbackName, email: value };
  return { name: fallbackName, email: safeFallback };
}

async function deliverEmail({
  toEmail,
  recipientName,
  subject,
  html,
  plainText,
  fallbackEmail,
  bccEmail
}: {
  toEmail: string;
  recipientName: string;
  subject: string;
  html: string;
  plainText: string;
  fallbackEmail?: string | null;
  bccEmail?: string | null;
}) {
  async function postEmail(endpoint: string, headers: Record<string, string>, payload: unknown, providerName: string) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        let errorMsg = errData?.message || `${providerName} returned status ${res.status}.`;
        if (res.status === 401 || /key not found|unauthorized|invalid api key/i.test(errorMsg)) {
          const isSmtpKey = brevoKey && brevoKey.startsWith('xsmtpsib');
          if (isSmtpKey) {
            errorMsg = 'Brevo key in Supabase secrets is an SMTP key (starts with xsmtpsib). Brevo API requires an API key (starts with xkeysib). Go to Brevo > Settings > SMTP & API > API Keys to generate an API key.';
          } else {
            errorMsg = `${providerName} API key is invalid or unauthorized (${errData?.message || res.statusText || 'Key not found'}). Check ${providerName === 'Brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY'} in Supabase secrets.`;
          }
        }
        return { email_sent: false, email_error: errorMsg, invite_subject: subject, invite_message: plainText };
      }
      return { email_sent: true, email_error: null, invite_subject: subject, invite_message: plainText };
    } catch (err) {
      return { email_sent: false, email_error: err instanceof Error ? err.message : `Unable to reach ${providerName}.`, invite_subject: subject, invite_message: plainText };
    }
  }

  const brevoKey = Deno.env.get('BREVO_API_KEY')?.trim();
  const resendKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const rawFrom = Deno.env.get('INVITE_FROM_EMAIL')?.trim() || Deno.env.get('BREVO_SENDER_EMAIL')?.trim();
  const safeBcc = bccEmail && bccEmail.trim().toLowerCase() !== toEmail.trim().toLowerCase() ? bccEmail.trim().toLowerCase() : null;

  if (brevoKey) {
    const sender = parseSender(rawFrom, SYSTEM_NAME, String(fallbackEmail || '').trim());
    if (!sender.email) {
      if (!resendKey) {
        return { email_sent: false, email_error: 'Set INVITE_FROM_EMAIL (or BREVO_SENDER_EMAIL) to your verified Brevo sender email.', invite_subject: subject, invite_message: plainText };
      }
    } else {
      const brevoPayload: Record<string, unknown> = {
        sender,
        replyTo: sender,
        to: [{ email: toEmail, name: recipientName }],
        subject,
        htmlContent: html,
        textContent: plainText
      };
      if (safeBcc) {
        brevoPayload.bcc = [{ email: safeBcc }];
      }
      const brevoResult = await postEmail(
        'https://api.brevo.com/v3/smtp/email',
        { Accept: 'application/json', 'Content-Type': 'application/json', 'api-key': brevoKey },
        brevoPayload,
        'Brevo'
      );
      if (brevoResult.email_sent || !resendKey) {
        return brevoResult;
      }
    }
  }

  if (resendKey) {
    const resendSender = parseSender(rawFrom, SYSTEM_NAME, 'onboarding@resend.dev');
    const resendPayload: Record<string, unknown> = {
      from: `${resendSender.name} <${resendSender.email}>`,
      to: [toEmail],
      subject,
      html,
      text: plainText
    };
    if (safeBcc) {
      resendPayload.bcc = [safeBcc];
    }
    return postEmail(
      'https://api.resend.com/emails',
      { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      resendPayload,
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
  loginUrl,
  inviteToken
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
  inviteToken?: string | null;
}) {
  const subject = `${inviterName} invited you to join "${groupName}" on ${SYSTEM_NAME}`;
  const baseLogin = loginUrl.split('?')[0];
  const acceptUrl = (!existingAccount && inviteToken)
    ? `${baseLogin}?accept_invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(toEmail)}`
    : loginUrl;

  const credentialBlock = existingAccount
    ? `Email: ${toEmail}\nPassword: Use your existing ${SYSTEM_NAME} password`
    : `Email: ${toEmail}\nTemporary password: ${temporaryPassword}`;
  const noteLine = existingAccount
    ? 'Sign in with your existing account and check your notifications to accept the invitation.'
    : '';
  const plainText = [
    `Hello ${recipientName},`,
    '',
    `${inviterName} invited you to join the "${groupName}" savings group as a ${roleLabel} on ${SYSTEM_NAME}.`,
    '',
    (!existingAccount && inviteToken)
      ? `Click this link to accept your invitation and activate your account:\n${acceptUrl}`
      : `Sign in here: ${loginUrl}`,
    '',
    credentialBlock,
    ...(noteLine ? ['', noteLine] : [])
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #163029; line-height: 1.55; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin: 0 0 14px; font-size: 20px; color: #163029;">You're invited to ${escapeHtml(groupName)}</h2>
      <p style="margin: 0 0 16px;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
      <p style="margin: 0 0 16px;"><strong>${escapeHtml(inviterName)}</strong> invited you to join the savings group <strong>${escapeHtml(groupName)}</strong> (${escapeHtml(roleLabel)}) on <strong>${escapeHtml(SYSTEM_NAME)}</strong>.</p>
      ${!existingAccount ? `
      <p style="margin: 0 0 14px; font-size: 14px; color: #5c5749;">
        To activate your account and start using your credentials, please accept the invitation below:
      </p>
      <p style="margin: 0 0 18px;">
        <a href="${escapeHtml(acceptUrl)}" style="display: inline-block; background: #163029; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 22px; border-radius: 10px; font-size: 15px;">Accept Invitation &amp; Activate Account</a>
      </p>` : ''}
      <div style="background: #ffffff; border: 1px solid #d9d6c8; border-radius: 10px; padding: 14px 16px; margin: 0 0 18px;">
        <p style="margin: 0 0 6px;"><strong>Email:</strong> ${escapeHtml(toEmail)}</p>
        ${existingAccount
          ? `<p style="margin: 0;"><strong>Password:</strong> Use your existing ${escapeHtml(SYSTEM_NAME)} password</p>`
          : `<p style="margin: 0 0 6px;"><strong>Temporary password:</strong> <code style="background: #f1efe7; padding: 2px 6px; border-radius: 6px; font-size: 14px;">${escapeHtml(temporaryPassword)}</code></p>
             <p style="margin: 0; font-size: 12px; color: #8a826f;">Note: Credentials will activate once you click "Accept Invitation" above.</p>`}
      </div>
      ${existingAccount ? `
      <p style="margin: 0 0 18px;">
        <a href="${escapeHtml(loginUrl)}" style="display: inline-block; background: #163029; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 18px; border-radius: 10px;">Sign in to ${escapeHtml(SYSTEM_NAME)}</a>
      </p>` : ''}
      ${noteLine ? `<p style="margin: 0 0 14px; font-size: 13px; color: #5c5749;">${escapeHtml(noteLine)}</p>` : ''}
      <div style="padding: 10px 14px; background: #f0ede1; border-radius: 8px; font-size: 12px; color: #6d6552; border: 1px dashed #cfcaba;">
        <strong>Tip:</strong> If this email appeared in your Spam or Junk folder, please click <strong>"Report not spam"</strong> or move it to your Inbox so that future savings notifications arrive directly in your inbox.
      </div>
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
  loginUrl,
  bccSuperAdmin
}: {
  toEmail: string;
  recipientName: string;
  decision: 'APPROVED' | 'REJECTED';
  groupName?: string | null;
  reviewNote?: string | null;
  subject?: string | null;
  senderEmail?: string | null;
  loginUrl: string;
  bccSuperAdmin?: string | null;
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
        ${emailBrandHeaderMarkup()}
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
        ${emailBrandHeaderMarkup()}
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
    fallbackEmail: senderEmail,
    bccEmail: bccSuperAdmin
  });
}

async function sendAccountStatusEmail({
  toEmail,
  recipientName,
  actionType,
  reason,
  senderEmail
}: {
  toEmail: string;
  recipientName: string;
  actionType: 'DEACTIVATE' | 'DELETE' | 'REACTIVATE';
  reason?: string;
  senderEmail?: string | null;
}) {
  const isDeact = actionType === 'DEACTIVATE';
  const isDelete = actionType === 'DELETE';
  const actionTitle = isDelete
    ? 'Account Deleted'
    : isDeact
    ? 'Account Deactivated'
    : 'Account Reactivated';
  const subject = `Your ${SYSTEM_NAME} account has been ${isDelete ? 'deleted' : isDeact ? 'deactivated' : 'reactivated'}`;

  const plainText = [
    `Hello ${recipientName},`,
    '',
    `Your ${SYSTEM_NAME} account has been ${isDelete ? 'permanently deleted' : isDeact ? 'deactivated' : 'reactivated'} by the platform administrator.`,
    reason ? '' : null,
    reason ? 'Reason provided by administrator:' : null,
    reason ? `${reason}` : null,
    '',
    isDelete
      ? 'All your access has been removed. If you have questions or believe this was done in error, please reach out to the platform administrator.'
      : isDeact
      ? 'You can no longer sign in while your account is deactivated. If you believe this was done in error, please contact the platform administrator.'
      : 'You can now sign in with your email and password to access your savings workspace.',
    '',
    'Thank you,',
    `${SYSTEM_NAME} Administration`
  ].filter((line) => line !== null).join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #163029; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin: 0 0 14px; font-size: 22px; color: ${isDelete ? '#9a241c' : isDeact ? '#b85d19' : '#186145'};">${escapeHtml(actionTitle)}</h2>
      <p style="margin: 0 0 14px;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
      <p style="margin: 0 0 14px;">Your <strong>${escapeHtml(SYSTEM_NAME)}</strong> account has been ${isDelete ? '<span style="color:#9a241c;font-weight:700;">permanently deleted</span>' : isDeact ? '<span style="color:#b85d19;font-weight:700;">deactivated</span>' : '<span style="color:#186145;font-weight:700;">reactivated</span>'} by the platform administrator.</p>
      ${reason ? `
        <div style="background: #ffffff; border-left: 4px solid ${isDelete ? '#9a241c' : isDeact ? '#b85d19' : '#186145'}; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
          <p style="margin: 0 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #6d6552;">Reason provided:</p>
          <p style="margin: 0; font-size: 14px; color: #23342e; white-space: pre-wrap;">${escapeHtml(reason)}</p>
        </div>
      ` : ''}
      <p style="margin: 16px 0 0; font-size: 13px; color: #5c5749;">
        ${isDelete
          ? 'All your access has been removed. If you have any questions, please contact the platform administrator.'
          : isDeact
          ? 'Your account is currently disabled and cannot sign in. If you believe this was done in error, please contact the platform administrator.'
          : 'You can now return to the application and sign in with your credentials.'}
      </p>
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

async function sendInactivityWarningEmail({
  toEmail,
  recipientName,
  scheduledPurgeAt
}: {
  toEmail: string;
  recipientName: string;
  scheduledPurgeAt: string;
}) {
  const safeName = String(recipientName || '').trim() || 'Saver';
  const purgeDateLabel = (() => {
    try {
      return new Date(scheduledPurgeAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila'
      });
    } catch {
      return scheduledPurgeAt.slice(0, 10);
    }
  })();
  const loginUrl = 'https://my-ipon.vercel.app/login.html';
  const subject = `Action needed: Your ${SYSTEM_NAME} account will be removed in 7 days`;

  const plainText = [
    `Hello ${safeName},`,
    '',
    `You have not signed in or had activity on your ${SYSTEM_NAME} account for nearly 6 months.`,
    `To keep database and cloud storage lean, inactive accounts are scheduled for automatic deletion after a 7-day notice.`,
    '',
    `Scheduled removal date: ${purgeDateLabel}`,
    '',
    `To keep your account active and cancel deletion, simply sign in before ${purgeDateLabel}:`,
    loginUrl,
    '',
    'Thank you,',
    `${SYSTEM_NAME}`
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #163029; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin: 0 0 14px; font-size: 21px; color: #9a4d12;">Inactivity Notice: 7 Days Remaining</h2>
      <p style="margin: 0 0 12px;">Hello <strong>${escapeHtml(safeName)}</strong>,</p>
      <p style="margin: 0 0 12px;">Your <strong>${escapeHtml(SYSTEM_NAME)}</strong> account has had no sign-in or savings activity for nearly 6 months.</p>
      <div style="background: #ffffff; border-left: 4px solid #b85d19; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
        <p style="margin: 0 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #6d6552;">Scheduled Permanent Deletion</p>
        <p style="margin: 0; font-size: 15px; font-weight: 700; color: #163029;">${escapeHtml(purgeDateLabel)}</p>
      </div>
      <p style="margin: 0 0 18px;">Sign in before that date to keep your profile and group access active:</p>
      <a href="${loginUrl}" style="display: inline-block; padding: 11px 20px; background: #143e30; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px;">Sign in to myIPON</a>
      <p style="margin: 18px 0 0; font-size: 12.5px; color: #5c5749;">Per our Data Retention Policy, profiles and stored media of accounts inactive for 6 months are automatically removed 7 days after this notice.</p>
    </div>
  `.trim();

  return deliverEmail({
    toEmail,
    recipientName: safeName,
    subject,
    html,
    plainText
  });
}

async function sendDormantSavingsEmail({
  toEmail,
  recipientName,
  groupName,
  stage,
  lastActivityAt,
  scheduledBinAt
}: {
  toEmail: string;
  recipientName: string;
  groupName: string;
  stage: 'reminder' | 'warning';
  lastActivityAt?: string;
  scheduledBinAt?: string;
}) {
  const safeName = String(recipientName || '').trim() || 'Saver';
  const safeGroup = String(groupName || '').trim() || 'your savings group';
  const formatManilaDate = (iso?: string) => {
    if (!iso) return 'soon';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila'
      });
    } catch {
      return String(iso).slice(0, 10);
    }
  };
  const lastDateLabel = formatManilaDate(lastActivityAt);
  const binDateLabel = formatManilaDate(scheduledBinAt);
  const loginUrl = 'https://my-ipon.vercel.app/login.html';
  const isWarning = stage === 'warning';

  const subject = isWarning
    ? `Action needed: Forgotten savings in ${safeGroup} enter 30-day retention Bin in 7 days`
    : `Savings check-in reminder for ${safeGroup} (${SYSTEM_NAME})`;

  const plainText = isWarning
    ? [
        `Hello ${safeName},`,
        '',
        `Your savings group "${safeGroup}" has had no contributions, transactions, or goal updates since ${lastDateLabel} (nearly 6 months).`,
        `Under our abandoned savings retention policy, dormant savings and untouched goals move to the 30-day Recycle Bin on ${binDateLabel} (and auto-delete permanently 30 days later from the database and cloud storage).`,
        '',
        `To keep all active savings and goals protected automatically, log in and add a contribution or update a goal before ${binDateLabel}:`,
        loginUrl,
        '',
        'Thank you,',
        `${SYSTEM_NAME}`
      ].join('\n')
    : [
        `Hello ${safeName},`,
        '',
        `Just a friendly reminder: your savings group "${safeGroup}" has had no new deposits or goal updates for 3 months (last activity: ${lastDateLabel}).`,
        `Your ongoing savings and active goals are still completely safe. However, if savings & goals remain untouched for 6 months total, a 7-day final notice will be sent before moving dormant data to the 30-day Recycle Bin.`,
        '',
        `Open myIPON to log a contribution or update your targets:`,
        loginUrl,
        '',
        'Thank you,',
        `${SYSTEM_NAME}`
      ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #163029; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin: 0 0 14px; font-size: 21px; color: ${isWarning ? '#9a4d12' : '#143e30'};">${isWarning ? 'Forgotten Savings Notice: 7 Days Until 30-Day Bin' : 'Dormant Savings Check-In Reminder'}</h2>
      <p style="margin: 0 0 12px;">Hello <strong>${escapeHtml(safeName)}</strong>,</p>
      <p style="margin: 0 0 12px;">${isWarning
        ? `Your savings group <strong>${escapeHtml(safeGroup)}</strong> has recorded no new contributions, transactions, or goal updates for nearly <strong>6 months</strong> (last activity: ${escapeHtml(lastDateLabel)}).`
        : `We noticed your savings group <strong>${escapeHtml(safeGroup)}</strong> has had no new deposits, transactions, or goal updates for <strong>3 months</strong> (last activity: ${escapeHtml(lastDateLabel)}).`}</p>
      <div style="background: #ffffff; border-left: 4px solid ${isWarning ? '#b85d19' : '#143e30'}; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
        <p style="margin: 0 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #6d6552;">${isWarning ? 'Scheduled Move to 30-Day Recycle Bin' : 'Ongoing Savings Protection'}</p>
        <p style="margin: 0; font-size: 15px; font-weight: 700; color: #163029;">${isWarning ? escapeHtml(binDateLabel) : 'Protected while active — 6-month inactivity rule applies if abandoned'}</p>
      </div>
      <p style="margin: 0 0 18px;">${isWarning
        ? `Sign in and add a deposit or update a goal before <strong>${escapeHtml(binDateLabel)}</strong> to keep everything out of the 30-day Bin. Even if moved to the Bin, you still have 30 days to recover it before automatic database &amp; storage deletion.`
        : 'Record a deposit or review your goals anytime to keep your savings momentum going. If left completely untouched for 6 months total, we will send a 7-day email notice before moving dormant records to the 30-day Recycle Bin.'}</p>
      <a href="${loginUrl}" style="display: inline-block; padding: 11px 20px; background: #143e30; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px;">Open myIPON</a>
    </div>
  `.trim();

  return deliverEmail({
    toEmail,
    recipientName: safeName,
    subject,
    html,
    plainText
  });
}

function timingSafeSecretEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function drainPendingStorageDeletions(admin: ReturnType<typeof createClient>) {
  const { data: rows, error } = await admin
    .from('pending_storage_deletions')
    .select('id,bucket_id,object_path')
    .order('queued_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  if (!rows?.length) return { drained: 0, failed: 0, referenced: 0, failure_stages: {}, failure_codes: {} };

  const byBucket = new Map<string, Array<{ id: string; object_path: string }>>();
  for (const row of rows as Array<{ id: string; bucket_id: string; object_path: string }>) {
    const list = byBucket.get(row.bucket_id) || [];
    list.push({ id: row.id, object_path: row.object_path });
    byBucket.set(row.bucket_id, list);
  }

  let drained = 0;
  let failed = 0;
  let referenced = 0;
  const failureStages: Record<string, number> = {};
  const failureCodes: Record<string, number> = {};
  for (const [bucket, items] of byBucket.entries()) {
    for (let i = 0; i < items.length; i += 100) {
      const slice = items.slice(i, i + 100);
      let stage = 'reference_lookup';
      try {
        const safe = [];
        for (const item of slice) {
          if (bucket === 'chat-attachments') {
            referenced += 1;
            continue;
          }
          safe.push(item);
        }
        if (!safe.length) continue;
        stage = 'object_removal';
        await removePrivateObjects(admin, bucket, safe.map((x) => x.object_path));
        stage = 'queue_delete';
        const { data: removedRows, error: deleteError } = await admin.from('pending_storage_deletions')
          .delete().in('id', safe.map((x) => x.id)).select('id');
        if (deleteError) throw deleteError;
        drained += removedRows?.length || 0;
      } catch (err) {
        failed += slice.length;
        failureStages[stage] = (failureStages[stage] || 0) + slice.length;
        const code = String((err as { code?: string })?.code || 'UNKNOWN');
        if (/^[A-Z0-9_]+$/.test(code)) failureCodes[code] = (failureCodes[code] || 0) + slice.length;
        /* keep rows for the next maintenance sweep */
      }
    }
  }
  return { drained, failed, referenced, failure_stages: failureStages, failure_codes: failureCodes };
}

async function runRetentionSweep(admin: ReturnType<typeof createClient>, { runSqlCleanup = false } = {}) {
  const errors: string[] = [];
  let sqlSummary: unknown = null;
  if (runSqlCleanup) {
    const { data, error } = await admin.rpc('run_data_retention_cleanup');
    if (error) errors.push(`run_data_retention_cleanup: ${error.message}`);
    sqlSummary = data ?? null;
  }

  const storageFirst = await drainPendingStorageDeletions(admin);

  const { data: inactive, error: inactiveErr } = await admin.rpc('collect_inactive_account_candidates', {
    p_inactive_months: 6,
    p_warning_days: 7
  });
  if (inactiveErr) errors.push(`collect_inactive_account_candidates: ${inactiveErr.message}`);

  const warnList = Array.isArray((inactive as { warn_candidates?: unknown[] } | null)?.warn_candidates)
    ? (inactive as { warn_candidates: Array<{ user_id: string; email?: string | null; full_name?: string; scheduled_purge_at?: string }> }).warn_candidates
    : [];
  const purgeList = Array.isArray((inactive as { purge_candidates?: unknown[] } | null)?.purge_candidates)
    ? (inactive as { purge_candidates: Array<{ user_id: string }> }).purge_candidates
    : [];

  let warnedCount = 0;
  for (const candidate of warnList) {
    if (!candidate.email || !candidate.email.includes('@')) continue;
    const outcome = await sendInactivityWarningEmail({
      toEmail: candidate.email,
      recipientName: candidate.full_name || 'Saver',
      scheduledPurgeAt: candidate.scheduled_purge_at || new Date(Date.now() + 7 * 86400000).toISOString()
    }).catch(() => ({ email_sent: false }));

    if (outcome?.email_sent) {
      warnedCount += 1;
    } else {
      // Never purge an inactive user whose 7-day email could not be sent
      await admin.rpc('reset_inactivity_warning_flag', { p_user_id: candidate.user_id }).catch(() => null);
    }
  }

  let purgedUsers = 0;
  for (const target of purgeList) {
    const { data: ok } = await admin.rpc('purge_inactive_user_data', { p_user_id: target.user_id });
    if (ok) {
      await admin.auth.admin.deleteUser(target.user_id).catch(() => null);
      purgedUsers += 1;
    }
  }

  // Dormant / abandoned savings reminders (90 days idle) & 6-month retention workflow -> 30-day Bin
  const { data: dormant, error: dormantErr } = await admin.rpc('collect_dormant_savings_groups', {
    p_remind_days: 90,
    p_inactive_months: 6,
    p_warning_days: 7
  }).catch((err) => ({ data: null, error: err }));
  if (dormantErr) {
    errors.push(`collect_dormant_savings_groups: ${dormantErr instanceof Error ? dormantErr.message : String((dormantErr as { message?: string })?.message || dormantErr)}`);
  }

  type DormantRecipient = { user_id: string; email?: string | null; full_name?: string };
  type DormantGroup = { group_id: string; group_name?: string; last_activity_at?: string; scheduled_bin_at?: string; recipients?: DormantRecipient[] };

  const reminderGroups = Array.isArray((dormant as { reminder_groups?: unknown[] } | null)?.reminder_groups)
    ? (dormant as { reminder_groups: DormantGroup[] }).reminder_groups
    : [];
  const warnGroups = Array.isArray((dormant as { warn_groups?: unknown[] } | null)?.warn_groups)
    ? (dormant as { warn_groups: DormantGroup[] }).warn_groups
    : [];
  const binGroups = Array.isArray((dormant as { bin_groups?: unknown[] } | null)?.bin_groups)
    ? (dormant as { bin_groups: Array<{ group_id: string; group_name?: string }> }).bin_groups
    : [];

  let dormantRemindedGroups = 0;
  for (const grp of reminderGroups) {
    const recips = (grp.recipients || []).filter((r) => r.email && r.email.includes('@'));
    if (!recips.length) continue;
    let anySent = false;
    for (const r of recips) {
      const outcome = await sendDormantSavingsEmail({
        toEmail: r.email!,
        recipientName: r.full_name || 'Saver',
        groupName: grp.group_name || 'Savings Group',
        stage: 'reminder',
        lastActivityAt: grp.last_activity_at
      }).catch(() => ({ email_sent: false }));
      if (outcome?.email_sent) anySent = true;
    }
    if (anySent) {
      dormantRemindedGroups += 1;
    } else {
      await admin.rpc('reset_dormant_savings_flag', { p_group_id: grp.group_id, p_stage: 'reminder' }).catch(() => null);
    }
  }

  let dormantWarnedGroups = 0;
  for (const grp of warnGroups) {
    const recips = (grp.recipients || []).filter((r) => r.email && r.email.includes('@'));
    if (!recips.length) {
      await admin.rpc('reset_dormant_savings_flag', { p_group_id: grp.group_id, p_stage: 'warning' }).catch(() => null);
      continue;
    }
    let anySent = false;
    for (const r of recips) {
      const outcome = await sendDormantSavingsEmail({
        toEmail: r.email!,
        recipientName: r.full_name || 'Saver',
        groupName: grp.group_name || 'Savings Group',
        stage: 'warning',
        lastActivityAt: grp.last_activity_at,
        scheduledBinAt: grp.scheduled_bin_at || new Date(Date.now() + 7 * 86400000).toISOString()
      }).catch(() => ({ email_sent: false }));
      if (outcome?.email_sent) anySent = true;
    }
    if (anySent) {
      dormantWarnedGroups += 1;
    } else {
      await admin.rpc('reset_dormant_savings_flag', { p_group_id: grp.group_id, p_stage: 'warning' }).catch(() => null);
    }
  }

  let dormantBinnedGroups = 0;
  for (const grp of binGroups) {
    const { data: moveRes, error: moveErr } = await admin.rpc('move_dormant_savings_group_to_bin', { p_group_id: grp.group_id }).catch((err) => ({ data: null, error: err }));
    if (moveErr) {
      errors.push(`move_dormant_savings_group_to_bin(${grp.group_id}): ${moveErr instanceof Error ? moveErr.message : String((moveErr as { message?: string })?.message || moveErr)}`);
    } else if ((moveRes as { moved?: boolean } | null)?.moved) {
      dormantBinnedGroups += 1;
    }
  }

  const storageAfter = (purgedUsers > 0 || runSqlCleanup || dormantBinnedGroups > 0)
    ? await drainPendingStorageDeletions(admin)
    : { drained: 0 };

  return {
    errors,
    sql_summary: sqlSummary,
    storage_files_removed: storageFirst.drained + storageAfter.drained,
    inactive_warned_emails: warnedCount,
    inactive_users_purged: purgedUsers,
    dormant_savings_reminded_groups: dormantRemindedGroups,
    dormant_savings_warned_groups: dormantWarnedGroups,
    dormant_savings_binned_groups: dormantBinnedGroups
  };
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
  const safeName = String(recipientName || '').trim() || 'Saver';
  const subject = `Your myIPON Verification Code (${code})`;
  const plainText = [
    `Hello ${safeName},`,
    '',
    `Your email verification code for activating your ${SYSTEM_NAME} account is:`,
    '',
    code,
    '',
    'This verification code expires in 10 minutes.',
    'If you did not sign up for myIPON, please ignore this email. No account has been created.'
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #163029; line-height: 1.55; max-width: 540px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #163029;">Verify your email address</h2>
      <p style="margin: 0 0 14px;">Hello <strong>${escapeHtml(safeName)}</strong>,</p>
      <p style="margin: 0 0 18px;">Enter the 6-digit verification code below to verify your email address and activate your account on <strong>${escapeHtml(SYSTEM_NAME)}</strong>:</p>
      <div style="margin: 0 0 18px; padding: 16px 20px; background: #ffffff; border: 1px solid #c9c5b5; border-radius: 12px; text-align: center;">
        <span style="font-family: monospace, Consolas, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; color: #163029;">${escapeHtml(code)}</span>
      </div>
      <p style="margin: 0 0 14px; font-size: 13px; color: #5c5749;">This verification code will expire in <strong>10 minutes</strong>.</p>
      <p style="margin: 0 0 12px; font-size: 12px; color: #7a7566; border-top: 1px solid #e0ddd0; padding-top: 14px;">If you did not sign up for myIPON, you can safely ignore this email.</p>
      <p style="margin: 0; font-size: 11px; color: #8a826f;">Tip: If this verification code landed in your Spam folder, mark it as "Not Spam" to receive future group notifications in your inbox.</p>
    </div>
  `.trim();

  return deliverEmail({
    toEmail,
    recipientName: safeName,
    subject,
    html,
    plainText,
    fallbackEmail: senderEmail || 'breadspanish231@gmail.com'
  });
}

async function sendNewDeviceOtpEmail({
  toEmail,
  recipientName,
  code
}: {
  toEmail: string;
  recipientName: string;
  code: string;
}) {
  const safeName = String(recipientName || '').trim() || 'Saver';
  const subject = `${code} is your myIPON new-device code`;
  const plainText = [
    `Hello ${safeName},`,
    '',
    'A sign-in attempt was detected from a new browser or device.',
    `Your verification code is: ${code}`,
    '',
    'This code expires in 10 minutes. If this was not you, do not share the code and change your password.'
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#163029;line-height:1.55;max-width:540px;margin:0 auto;padding:24px;background:#fbf9f2;border:1px solid #d9d6c8;border-radius:14px">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin:0 0 12px;font-size:20px;color:#163029">New device sign-in</h2>
      <p style="margin:0 0 14px">Hello <strong>${escapeHtml(safeName)}</strong>,</p>
      <p style="margin:0 0 18px">A sign-in attempt was detected from a new browser or device. Enter this code to continue:</p>
      <div style="margin:0 0 18px;padding:16px 20px;background:#fff;border:1px solid #c9c5b5;border-radius:12px;text-align:center">
        <span style="font-family:Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:.35em;color:#163029">${escapeHtml(code)}</span>
      </div>
      <p style="margin:0 0 12px;font-size:13px;color:#5c5749">This code expires in <strong>10 minutes</strong>.</p>
      <p style="margin:0;padding-top:14px;border-top:1px solid #e0ddd0;font-size:12px;color:#7a7566">If this was not you, do not share this code and change your password.</p>
    </div>
  `.trim();
  return deliverEmail({ toEmail, recipientName: safeName, subject, html, plainText });
}

function buildSafeReminderAppUrl(link?: string | null) {
  const base = 'https://my-ipon.vercel.app';
  const raw = String(link || '').trim().replace(/^\/+/, '');
  if (!raw || /^https?:/i.test(raw) || raw.includes('..')) return `${base}/login.html`;
  return `${base}/${raw}`;
}

function manilaTodayIso(now = new Date()) {
  const manilaMs = now.getTime() + (8 * 60 * 60 * 1000);
  return new Date(manilaMs).toISOString().slice(0, 10);
}

function diffIsoDateDays(targetIso: string, baseIso: string) {
  const t = Date.parse(`${targetIso}T00:00:00Z`);
  const b = Date.parse(`${baseIso}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(b)) return null;
  return Math.round((t - b) / 86400000);
}

function isContributionEmailMilestone(daysUntilDue: number | null) {
  if (daysUntilDue === null || !Number.isFinite(daysUntilDue)) return false;
  if (daysUntilDue === 3 || daysUntilDue === 0 || daysUntilDue === -1) return true;
  return daysUntilDue <= -7 && ((-daysUntilDue) % 7 === 0);
}

function reminderWarningBadge(item: { type: string; title: string; days_until_due?: number | null }) {
  if (item.type === 'GOAL_REMINDER') {
    const isCarry = /carry-over/i.test(item.title || '');
    return {
      label: isCarry ? 'Goal Carry-Over' : 'Savings Goal',
      bg: isCarry ? '#fdecea' : '#eaf4ef',
      color: isCarry ? '#9b2c2c' : '#16533e'
    };
  }
  const d = item.days_until_due;
  if (d === 3) return { label: '3 Days Left', bg: '#fef5e4', color: '#8a5a00' };
  if (d === 0) return { label: 'Due Today', bg: '#fdebd0', color: '#9a4d00' };
  if (typeof d === 'number' && d < 0) {
    const overdueDays = -d;
    return {
      label: overdueDays === 1 ? '1 Day Overdue' : `${overdueDays} Days Overdue`,
      bg: '#fdecea',
      color: '#9b2c2c'
    };
  }
  const isOverdue = /overdue/i.test(item.title || '');
  const isApproaching = !isOverdue && /approaching|due/i.test(item.title || '');
  return {
    label: isOverdue ? 'Overdue' : isApproaching ? 'Due Soon' : 'Unpaid',
    bg: isOverdue ? '#fdecea' : isApproaching ? '#fef5e4' : '#eaf4ef',
    color: isOverdue ? '#9b2c2c' : isApproaching ? '#8a5a00' : '#16533e'
  };
}

async function sendUnpaidReminderEmail({
  toEmail,
  recipientName,
  items
}: {
  toEmail: string;
  recipientName: string;
  items: Array<{ id: number; type: string; title: string; message: string; link?: string | null; days_until_due?: number | null }>;
}) {
  const safeName = String(recipientName || '').trim() || 'Member';
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { email_sent: false, email_error: 'No unpaid reminders to send.' };

  const primary = list[0];
  const primaryBadge = reminderWarningBadge(primary);
  const primaryUrl = buildSafeReminderAppUrl(primary.link);
  const subject = list.length === 1
    ? `[${primaryBadge.label}] ${primary.title} — ${SYSTEM_NAME}`
    : `You have ${list.length} unpaid savings warnings — ${SYSTEM_NAME}`;
  const heading = list.length === 1 ? primary.title : `${list.length} unpaid savings warnings`;

  const plainLines = [
    `Hello ${safeName},`,
    '',
    list.length === 1
      ? 'This is an automatic warning reminder from myIPON about your unpaid savings balance:'
      : 'This is an automatic warning reminder from myIPON about your unpaid savings balances:',
    '',
    ...list.flatMap((item, idx) => {
      const badge = reminderWarningBadge(item);
      return [
        `${list.length > 1 ? `${idx + 1}. ` : ''}[${badge.label}] ${item.title}`,
        item.message,
        `Open: ${buildSafeReminderAppUrl(item.link)}`,
        ''
      ];
    }),
    'You can review your contribution status and submit your payment inside myIPON.',
    'To manage reminder alerts, visit Account settings in the app.'
  ];
  const plainText = plainLines.join('\n');

  const cardsHtml = list.map((item) => {
    const badge = reminderWarningBadge(item);
    const itemUrl = buildSafeReminderAppUrl(item.link);
    return `
      <div style="margin: 0 0 12px; padding: 14px 16px; background: #ffffff; border: 1px solid #d9d6c8; border-radius: 12px;">
        <div style="margin: 0 0 6px;">
          <span style="display: inline-block; padding: 3px 9px; border-radius: 999px; background: ${badge.bg}; color: ${badge.color}; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;">${escapeHtml(badge.label)}</span>
        </div>
        <p style="margin: 0 0 4px; font-size: 15px; font-weight: 700; color: #163029;">${escapeHtml(item.title)}</p>
        <p style="margin: 0${list.length > 1 ? ' 0 8px' : ''}; font-size: 14px; color: #3c4b45;">${escapeHtml(item.message)}</p>
        ${list.length > 1 ? `<a href="${escapeHtml(itemUrl)}" style="font-size: 13px; font-weight: 600; color: #16533e; text-decoration: none;">View details &rarr;</a>` : ''}
      </div>`;
  }).join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #163029; line-height: 1.55; max-width: 560px; margin: 0 auto; padding: 24px; background: #fbf9f2; border: 1px solid #d9d6c8; border-radius: 14px;">
      ${emailBrandHeaderMarkup()}
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #163029;">${escapeHtml(heading)}</h2>
      <p style="margin: 0 0 14px;">Hello <strong>${escapeHtml(safeName)}</strong>,</p>
      <p style="margin: 0 0 16px; font-size: 14px; color: #4a564f;">Here is your automatic savings reminder from <strong>${escapeHtml(SYSTEM_NAME)}</strong>:</p>
      ${cardsHtml}
      <p style="margin: 18px 0;">
        <a href="${escapeHtml(primaryUrl)}" style="display: inline-block; background: #163029; color: #ffffff; text-decoration: none; font-weight: 600; padding: 11px 20px; border-radius: 10px; font-size: 14px;">Open ${escapeHtml(SYSTEM_NAME)}</a>
      </p>
      <p style="margin: 0; padding-top: 14px; border-top: 1px solid #e0ddd0; font-size: 12px; color: #7a7566;">
        You received this email because notifications are enabled on your ${escapeHtml(SYSTEM_NAME)} account. You can manage notification settings anytime inside the app.
      </p>
    </div>
  `.trim();

  return deliverEmail({ toEmail, recipientName: safeName, subject, html, plainText });
}

async function dispatchUnpaidReminderEmails(
  admin: ReturnType<typeof createClient>,
  { recipientId = null, batch = false }: { recipientId?: string | null; batch?: boolean } = {}
) {
  const todayIso = manilaTodayIso();
  const manilaDayStartIso = `${todayIso}T00:00:00+08:00`;
  let query = admin
    .from('notifications')
    .select('id, recipient_id, group_id, type, title, message, link, dedupe_key, created_at')
    .in('type', ['CONTRIBUTION_REMINDER', 'GOAL_REMINDER'])
    .is('emailed_at', null)
    .is('read_at', null)
    .gte('created_at', manilaDayStartIso)
    .order('created_at', { ascending: true })
    .limit(200);

  if (recipientId && !batch) {
    query = query.eq('recipient_id', recipientId);
  }

  const { data: rows, error: listErr } = await query;
  if (listErr) {
    return { sent: 0, notifications_emailed: 0, errors: [listErr.message || 'Unable to query pending reminders.'] };
  }
  if (!rows?.length) {
    return { sent: 0, notifications_emailed: 0, errors: [] as string[] };
  }

  // Filter strictly to Ultra-tipid milestone days (3d before, due date 0d, 1d overdue, then every 7d overdue; goals once per 7d)
  const periodIds = [...new Set(
    rows
      .filter((r: any) => r.type === 'CONTRIBUTION_REMINDER')
      .map((r: any) => String(r.dedupe_key || '').split(':')[1] || '')
      .filter((id: string) => /^[0-9a-f-]{36}$/i.test(id))
  )];
  const periodDueMap = new Map<string, string>();
  if (periodIds.length) {
    const { data: periodRows } = await admin
      .from('contribution_periods')
      .select('id, due_date, is_exempt')
      .in('id', periodIds);
    for (const p of periodRows || []) {
      if (p?.id && p?.due_date && !p.is_exempt) {
        periodDueMap.set(String(p.id), String(p.due_date).slice(0, 10));
      }
    }
  }

  const goalRecipientIds = [...new Set(
    rows.filter((r: any) => r.type === 'GOAL_REMINDER').map((r: any) => String(r.recipient_id || '')).filter(Boolean)
  )];
  const recentGoalEmailedKeys = new Set<string>();
  if (goalRecipientIds.length) {
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentGoalRows } = await admin
      .from('notifications')
      .select('recipient_id, dedupe_key')
      .in('recipient_id', goalRecipientIds)
      .eq('type', 'GOAL_REMINDER')
      .not('emailed_at', 'is', null)
      .gte('emailed_at', sevenDaysAgoIso);
    for (const r of recentGoalRows || []) {
      const goalId = String(r?.dedupe_key || '').split(':')[1] || '';
      if (r?.recipient_id && goalId) recentGoalEmailedKeys.add(`${r.recipient_id}:${goalId}`);
    }
  }

  const eligibleRows: any[] = [];
  for (const row of rows) {
    if (row.type === 'CONTRIBUTION_REMINDER') {
      const periodId = String(row.dedupe_key || '').split(':')[1] || '';
      const dueDateIso = periodDueMap.get(periodId);
      const daysUntilDue = dueDateIso ? diffIsoDateDays(dueDateIso, todayIso) : null;
      if (!isContributionEmailMilestone(daysUntilDue)) continue;
      eligibleRows.push({ ...row, days_until_due: daysUntilDue });
    } else if (row.type === 'GOAL_REMINDER') {
      const goalId = String(row.dedupe_key || '').split(':')[1] || '';
      if (!goalId || recentGoalEmailedKeys.has(`${row.recipient_id}:${goalId}`)) continue;
      eligibleRows.push({ ...row, days_until_due: null });
    }
  }

  if (!eligibleRows.length) {
    return { sent: 0, notifications_emailed: 0, errors: [] as string[] };
  }

  const byRecipient = new Map<string, any[]>();
  for (const row of eligibleRows) {
    const uid = String(row.recipient_id || '').trim();
    if (!uid) continue;
    const bucket = byRecipient.get(uid) || [];
    bucket.push(row);
    byRecipient.set(uid, bucket);
  }

  const recipientIds = [...byRecipient.keys()];
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email, status, notifications_enabled')
    .in('id', recipientIds);
  const profileMap = new Map<string, any>((profiles || []).map((p: any) => [String(p.id), p]));

  let sent = 0;
  let notificationsEmailed = 0;
  const errors: string[] = [];

  for (const [uid, candidateRows] of byRecipient.entries()) {
    const profile = profileMap.get(uid);
    if (!profile || profile.status !== 'ACTIVE' || profile.notifications_enabled === false) continue;

    let toEmail = String(profile.email || '').trim().toLowerCase();
    if (!toEmail || !toEmail.includes('@')) {
      const { data: authData } = await admin.auth.admin.getUserById(uid).catch(() => ({ data: null }));
      toEmail = String(authData?.user?.email || '').trim().toLowerCase();
    }
    if (!toEmail || !toEmail.includes('@')) continue;

    // Atomically claim milestone-eligible notifications for this recipient so concurrent triggers send only one consolidated email
    const candidateIds = candidateRows.map((r: any) => r.id);
    const daysById = new Map<number, number | null>(candidateRows.map((r: any) => [Number(r.id), r.days_until_due ?? null]));
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from('notifications')
      .update({ emailed_at: claimedAt })
      .in('id', candidateIds)
      .is('emailed_at', null)
      .select('id, group_id, type, title, message, link, created_at');

    if (claimErr || !claimed?.length) continue;

    const enrichedClaimed = claimed.map((item: any) => ({
      ...item,
      days_until_due: daysById.get(Number(item.id)) ?? null
    }));

    const outcome = await sendUnpaidReminderEmail({
      toEmail,
      recipientName: String(profile.full_name || '').trim() || 'Member',
      items: enrichedClaimed
    });

    if (outcome.email_sent) {
      sent += 1;
      notificationsEmailed += claimed.length;
    } else {
      await admin
        .from('notifications')
        .update({ emailed_at: null })
        .in('id', claimed.map((r: any) => r.id))
        .eq('emailed_at', claimedAt);
      errors.push(`${uid}: ${outcome.email_error || 'Unable to deliver reminder email.'}`);
    }
  }

  return { sent, notifications_emailed: notificationsEmailed, errors };
}

async function deviceTokenHash(userId: string, deviceToken: string, serviceSecret: string) {
  return sha256(`${userId}:${deviceToken}:${serviceSecret}`);
}

async function deviceCodeHash(challengeId: string, code: string, serviceSecret: string) {
  return sha256(`${challengeId}:${code}:${serviceSecret}`);
}

async function startDeviceOtpIfNeeded(
  admin: ReturnType<typeof createClient>,
  profile: { id: string; email?: string | null; full_name?: string | null; new_device_email_otp_enabled?: boolean | null },
  deviceToken: string,
  serviceSecret: string
) {
  if (!profile.new_device_email_otp_enabled) return null;
  if (!DEVICE_TOKEN_RE.test(deviceToken)) {
    return { error: 'This browser could not be identified securely. Reload the page and try again.', status: 400 };
  }
  const tokenHash = await deviceTokenHash(profile.id, deviceToken, serviceSecret);
  const now = new Date();
  const { data: trusted } = await admin
    .from('account_trusted_devices')
    .select('id')
    .eq('user_id', profile.id)
    .eq('token_hash', tokenHash)
    .gt('expires_at', now.toISOString())
    .maybeSingle();
  if (trusted?.id) {
    await admin.from('account_trusted_devices').update({ last_used_at: now.toISOString() }).eq('id', trusted.id);
    return null;
  }

  const { data: recent } = await admin
    .from('account_device_otp_challenges')
    .select('id,created_at,expires_at')
    .eq('user_id', profile.id)
    .is('consumed_at', null)
    .gt('expires_at', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent && Date.parse(recent.created_at) > Date.now() - 60_000) {
    return { requires_device_otp: true, challenge_id: recent.id, email_hint: maskEmail(String(profile.email || '')) };
  }

  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) return { error: 'No verified email address is available for this account.', status: 400 };
  const challengeId = crypto.randomUUID();
  const code = secureSixDigitCode();
  const codeHash = await deviceCodeHash(challengeId, code, serviceSecret);
  const expiresAt = new Date(Date.now() + DEVICE_OTP_TTL_MS).toISOString();
  await admin.from('account_device_otp_challenges').delete().eq('user_id', profile.id).is('consumed_at', null);
  const { error: insertError } = await admin.from('account_device_otp_challenges').insert({
    id: challengeId,
    user_id: profile.id,
    code_hash: codeHash,
    expires_at: expiresAt
  });
  if (insertError) return { error: 'Could not prepare new-device verification.', status: 500 };
  const delivery = await sendNewDeviceOtpEmail({ toEmail: email, recipientName: String(profile.full_name || ''), code });
  if (!delivery.email_sent) {
    await admin.from('account_device_otp_challenges').delete().eq('id', challengeId);
    return { error: delivery.email_error || 'Could not send the verification email.', status: 503 };
  }
  return { requires_device_otp: true, challenge_id: challengeId, email_hint: maskEmail(email) };
}

type AdminClient = ReturnType<typeof createClient>;

async function findAuthUserByEmail(admin: AdminClient, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 }).catch(() => ({ data: null, error: true }));
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

function normalizeUsername(raw: unknown): string {
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}

async function resolveLoginIdentifier(admin: AdminClient, rawIdentifier: unknown): Promise<{
  raw: string;
  isUsername: boolean;
  email: string;
  throttleKey: string;
  valid: boolean;
}> {
  const trimmed = String(rawIdentifier || '').trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) {
    return { raw: trimmed, isUsername: false, email: '', throttleKey: '', valid: false };
  }
  if (trimmed.includes('@') && !trimmed.startsWith('@')) {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    return { raw: trimmed, isUsername: false, email: valid ? trimmed : '', throttleKey: valid ? trimmed : '', valid };
  }
  const cleanUsername = normalizeUsername(trimmed);
  if (!USERNAME_RE.test(cleanUsername)) {
    return { raw: trimmed, isUsername: true, email: '', throttleKey: '', valid: false };
  }
  const { data: matched } = await admin
    .from('profiles')
    .select('id, email')
    .ilike('username', cleanUsername)
    .limit(1)
    .maybeSingle();
  const resolvedEmail = String(matched?.email || '').trim().toLowerCase();
  if (resolvedEmail && resolvedEmail.includes('@')) {
    return { raw: cleanUsername, isUsername: true, email: resolvedEmail, throttleKey: resolvedEmail, valid: true };
  }
  return { raw: cleanUsername, isUsername: true, email: '', throttleKey: `username:${cleanUsername}`, valid: true };
}

async function activateUserAndMembership(
  admin: AdminClient,
  userId: string,
  fill: { first_name?: string | null; middle_name?: string | null; last_name?: string | null; full_name?: string | null; contact_number?: string | null; email?: string | null; username?: string | null } = {},
  options: { fromLogin?: boolean } = {}
) {
  if (!userId) return { profile: null, disabled: false, usernameConflict: false };

  let { data: prof } = await admin
    .from('profiles')
    .select('id, status, group_id, role, member_id, first_name, middle_name, last_name, full_name, contact_number, email, username')
    .eq('id', userId)
    .maybeSingle();

  if (!prof) {
    const { data: authRes } = await admin.auth.admin.getUserById(userId).catch(() => ({ data: null }));
    const authUser = authRes?.user;
    if (authUser) {
      const meta = (authUser.user_metadata || {}) as Record<string, unknown>;
      const derived = fallbackNamesFromEmail(String(authUser.email || fill.email || 'member@example.com'));
      const first = String(fill.first_name || meta.first_name || derived.first || '').trim() || null;
      const middle = String(fill.middle_name || meta.middle_name || '').trim() || null;
      const last = String(fill.last_name || meta.last_name || derived.last || '').trim() || null;
      const full = String(fill.full_name || meta.full_name || '').trim() || [first, middle, last].filter(Boolean).join(' ') || derived.full;
      const contact = String(fill.contact_number || meta.contact_number || '').trim() || null;
      const cleanUsername = normalizeUsername(fill.username || meta.username);
      const validUsername = USERNAME_RE.test(cleanUsername) ? cleanUsername : null;
      const { error: insErr } = await admin.from('profiles').insert({
        id: userId,
        email: String(authUser.email || fill.email || '').trim().toLowerCase(),
        first_name: first,
        middle_name: middle,
        last_name: last,
        full_name: full,
        contact_number: contact,
        username: validUsername,
        role: 'MEMBER',
        status: 'ACTIVE'
      }).select('id').maybeSingle();
      if (insErr && insErr.code === '23505' && /username/i.test(String(insErr.message || insErr.details || ''))) {
        return { profile: null, disabled: false, usernameConflict: true };
      }
      const reloaded = await admin
        .from('profiles')
        .select('id, status, group_id, role, member_id, first_name, middle_name, last_name, full_name, contact_number, email, username')
        .eq('id', userId)
        .maybeSingle();
      prof = reloaded.data;
    }
  }

  if (!prof) return { profile: null, disabled: false, usernameConflict: false };
  if (prof.status === 'DISABLED') return { profile: prof, disabled: true, usernameConflict: false };

  // Keep group memberships aligned so dashboard/RPC membership checks pass after activation
  await admin
    .from('group_memberships')
    .update({ status: 'ACTIVE' })
    .eq('user_id', userId)
    .eq('status', 'PENDING');

  const { data: membership } = await admin
    .from('group_memberships')
    .select('group_id, role, member_id')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const patch: Record<string, unknown> = { status: 'ACTIVE' };
  if (!prof.group_id && membership?.group_id) {
    patch.group_id = membership.group_id;
    patch.role = membership.role || prof.role || 'MEMBER';
    patch.member_id = membership.member_id || prof.member_id;
  }
  if (!prof.first_name && fill.first_name) patch.first_name = fill.first_name;
  if (!prof.middle_name && fill.middle_name) patch.middle_name = fill.middle_name;
  if (!prof.last_name && fill.last_name) patch.last_name = fill.last_name;
  if (!prof.full_name && fill.full_name) patch.full_name = fill.full_name;
  if (!prof.contact_number && fill.contact_number) patch.contact_number = fill.contact_number;
  const fillUsername = normalizeUsername(fill.username);
  if (!prof.username && USERNAME_RE.test(fillUsername)) patch.username = fillUsername;

  const { data: updated, error: updateErr } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .neq('status', 'DISABLED')
    .select('id, status, group_id, role, member_id, first_name, last_name, contact_number, username')
    .maybeSingle();
  if (updateErr && updateErr.code === '23505' && /username/i.test(String(updateErr.message || updateErr.details || ''))) {
    return { profile: prof, disabled: false, usernameConflict: true };
  }

  let hasSignedIn = Boolean(options.fromLogin);
  if (!hasSignedIn) {
    const { data: authCheck } = await admin.auth.admin.getUserById(userId).catch(() => ({ data: null }));
    hasSignedIn = Boolean(authCheck?.user?.last_sign_in_at);
  }

  if (hasSignedIn) {
    const { data: linkedMemberships } = await admin
      .from('group_memberships')
      .select('member_id')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .not('member_id', 'is', null);
    const memberIds = [...new Set([
      updated?.member_id || prof.member_id,
      ...((linkedMemberships || []).map((row: { member_id: string | null }) => row.member_id))
    ].filter((value): value is string => Boolean(value)))];

    if (memberIds.length) {
      await admin
        .from('members')
        .update({ activation_status: 'ACTIVE', activated_at: new Date().toISOString() })
        .in('id', memberIds)
        .is('deleted_at', null)
        .eq('activation_status', 'PENDING');
    }
  }

  return { profile: updated || prof, disabled: false, usernameConflict: false };
}

function extractClientIp(request: Request): string {
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    request.headers.get('x-forwarded-for')?.split(',')[0]
  ];
  for (const raw of candidates) {
    const clean = String(raw || '').trim();
    if (/^[0-9a-fA-F:.]{3,64}$/.test(clean)) return clean;
  }
  return '';
}

async function provisionClerkUser(admin: ReturnType<typeof createClient>, user: { id: string; email?: string | null }, password: string) {
  const secretKey = String(Deno.env.get('CLERK_SECRET_KEY') || '').trim();
  const email = String(user.email || '').trim().toLowerCase();
  if (!secretKey || !email || !password) return false;

  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  const lookup = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}&limit=1`, {
    headers,
    signal: AbortSignal.timeout(5000)
  });
  if (!lookup.ok) return false;
  const existing = await lookup.json().catch(() => []);
  const existingId = Array.isArray(existing) ? String(existing[0]?.id || '') : '';
  if (existingId) {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(existingId)}`, {
      method: 'PATCH',
      headers,
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ password, skip_password_checks: true })
    });
    return response.ok;
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('first_name,last_name')
    .eq('id', user.id)
    .maybeSingle();
  const response = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      email_address: [email],
      password,
      external_id: user.id,
      first_name: profile?.first_name || undefined,
      last_name: profile?.last_name || undefined,
      skip_password_checks: true,
      skip_legal_checks: true
    })
  });
  if (response.ok) return true;
  const failure = await response.json().catch(() => null);
  return response.status === 422 && /already exists|taken/i.test(JSON.stringify(failure || ''));
}

async function exchangeClerkSession(admin: ReturnType<typeof createClient>, request: Request, token: string, deviceToken: string, serviceSecret: string) {
  const secretKey = String(Deno.env.get('CLERK_SECRET_KEY') || '').trim();
  const origin = String(request.headers.get('origin') || '').trim();
  if (!secretKey || !token || !origin) return json({ error: 'Social sign-in is unavailable.' }, 401);

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, clerkJwks, { issuer: CLERK_ISSUER }));
  } catch {
    return json({ error: 'Your Clerk sign-in session is invalid or expired.' }, 401);
  }
  if (payload.azp && payload.azp !== origin) return json({ error: 'This sign-in session belongs to another site.' }, 401);

  const clerkUserId = String(payload.sub || '').trim();
  if (!/^user_[A-Za-z0-9]+$/.test(clerkUserId)) return json({ error: 'Your Clerk account could not be verified.' }, 401);
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  const userResponse = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
    headers,
    signal: AbortSignal.timeout(5000)
  });
  if (!userResponse.ok) return json({ error: 'Your Clerk account could not be loaded.' }, 401);
  const clerkUser = await userResponse.json();
  const primaryEmail = Array.isArray(clerkUser?.email_addresses)
    ? clerkUser.email_addresses.find((entry: { id?: string }) => entry?.id === clerkUser.primary_email_address_id)
    : null;
  const email = String(primaryEmail?.email_address || '').trim().toLowerCase();
  if (!email || primaryEmail?.verification?.status !== 'verified') {
    return json({ error: 'Your Google or Facebook account must provide a verified email address.' }, 400);
  }

  let { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id,email,full_name,status,new_device_email_otp_enabled')
    .ilike('email', email)
    .maybeSingle();
  if (profileError) return json({ error: 'Your myIPON account could not be checked.' }, 500);

  let createdNewAccount = false;
  if (!profile && clerkUser.external_id) {
    const { data: linkedProfile, error: linkedError } = await admin
      .from('profiles')
      .select('id,email,full_name,status,new_device_email_otp_enabled')
      .eq('id', String(clerkUser.external_id))
      .maybeSingle();
    if (linkedError) return json({ error: 'Your myIPON account could not be checked.' }, 500);
    if (linkedProfile) {
      if (linkedProfile.status === 'DISABLED') return json({ error: 'Your account is deactivated or disabled.' }, 403);
      if (String(linkedProfile.email || '').trim().toLowerCase() !== email) {
        return json({ error: 'This Clerk account is linked to a different myIPON account.' }, 409);
      }
      profile = linkedProfile;
    }
  }

  if (!profile) {
    const existingAuthUser = await findAuthUserByEmail(admin, email);
    let targetUserId = existingAuthUser?.id || '';
    const rawFirst = normalizeNamePart(clerkUser.first_name);
    const rawLast = normalizeNamePart(clerkUser.last_name);
    let useFormalNames = Boolean(rawFirst && rawLast)
      && `${rawFirst} ${rawLast}`.length <= 150
      && validFormalNamePart(rawFirst, { required: true })
      && validFormalNamePart(rawLast, { required: true });
    const derived = fallbackNamesFromEmail(email);
    const derivedFull = `${derived.first} ${derived.last}`.trim() || 'New User';
    const fallbackFull = [rawFirst, rawLast].filter(Boolean).join(' ').slice(0, 150) || derivedFull;

    if (!targetUserId) {
      const randomBytes = crypto.getRandomValues(new Uint8Array(24));
      const generatedPassword = `Aa1!${Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      const initialMeta = useFormalNames
        ? {
            first_name: rawFirst,
            last_name: rawLast,
            full_name: `${rawFirst} ${rawLast}`,
            account_kind: 'DIRECT_SIGNUP',
            name_setup_required: false
          }
        : {
            full_name: fallbackFull,
            account_kind: 'DIRECT_SIGNUP',
            name_setup_required: true
          };
      let { data: newUserData, error: createError } = await admin.auth.admin.createUser({
        email,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: initialMeta
      });
      if (createError && !/already registered|already exists/i.test(createError.message || '')) {
        useFormalNames = false;
        ({ data: newUserData, error: createError } = await admin.auth.admin.createUser({
          email,
          password: generatedPassword,
          email_confirm: true,
          user_metadata: {
            full_name: derivedFull,
            account_kind: 'DIRECT_SIGNUP',
            name_setup_required: true
          }
        }));
      }
      if (createError) {
        if (/already registered|already exists/i.test(createError.message || '')) {
          const matched = await findAuthUserByEmail(admin, email);
          targetUserId = matched?.id || '';
        }
        if (!targetUserId) {
          return json({ error: 'Your myIPON account could not be created right now. Please try again.' }, 500);
        }
      } else {
        targetUserId = newUserData?.user?.id || '';
        createdNewAccount = Boolean(targetUserId);
      }
    }

    if (!targetUserId) return json({ error: 'Your myIPON account could not be initialized.' }, 500);
    const fillProfile = useFormalNames
      ? { first_name: rawFirst, last_name: rawLast, full_name: `${rawFirst} ${rawLast}`, email }
      : { full_name: fallbackFull, email };
    const { disabled } = await activateUserAndMembership(admin, targetUserId, fillProfile, { fromLogin: true });
    if (disabled) return json({ error: 'Your account is deactivated or disabled.' }, 403);

    const { data: reloadedProfile, error: reloadError } = await admin
      .from('profiles')
      .select('id,email,full_name,status,new_device_email_otp_enabled')
      .eq('id', targetUserId)
      .maybeSingle();
    if (reloadError || !reloadedProfile) {
      return json({ error: 'Your myIPON account could not be initialized.' }, 500);
    }
    profile = reloadedProfile;
  }

  if (profile.status === 'DISABLED') return json({ error: 'Your account is deactivated or disabled.' }, 403);
  if (!createdNewAccount && clerkUser.external_id && clerkUser.external_id !== profile.id) {
    return json({ error: 'This Clerk account is linked to a different myIPON account.' }, 409);
  }

  if (!clerkUser.external_id || (createdNewAccount && clerkUser.external_id !== profile.id)) {
    await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      method: 'PATCH',
      headers,
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ external_id: profile.id })
    }).catch(() => null);
  }

  const deviceOtp = await startDeviceOtpIfNeeded(admin, profile, deviceToken, serviceSecret);
  if (deviceOtp) return json(deviceOtp, Number(('status' in deviceOtp ? deviceOtp.status : 200) || 200));

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = String(linkData?.properties?.hashed_token || '').trim();
  if (linkError || !tokenHash) return json({ error: 'The myIPON session could not be created.' }, 500);
  return json({ ok: true, token_hash: tokenHash, email, created: createdNewAccount });
}

const PUBLIC_MEDIA_R2_PATH_RE = /^(avatars|covers|group-avatars|group-qr|receipts|bug-reports)\/[0-9a-f-]{36}\/r2\/[a-zA-Z0-9._-]+$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (request.method === 'GET' || request.method === 'HEAD') {
    const reqUrl = new URL(request.url);
    const mediaPath = String(reqUrl.searchParams.get('media') || '').trim();
    if (!mediaPath || mediaPath.includes('..') || !PUBLIC_MEDIA_R2_PATH_RE.test(mediaPath)) {
      return json({ error: 'Media asset not found.' }, 404);
    }
    try {
      const signed = await signR2Object('ipon-media', mediaPath, 'GET');
      return new Response(null, {
        status: 302,
        headers: {
          ...cors,
          Location: signed,
          'Cache-Control': 'private, max-age=3000',
          'Referrer-Policy': 'no-referrer'
        }
      });
    } catch {
      return json({ error: 'Media asset is unavailable.' }, 503);
    }
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!url || !anon || !service) return json({ error: 'Account service is not configured.' }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'A valid JSON request body is required.' }, 400); }

  if (body.action === 'clerk-session-exchange') {
    return await exchangeClerkSession(
      admin,
      request,
      String(body.clerk_token || '').trim(),
      String(body.device_token || '').trim(),
      service
    );
  }

  if (body.action === 'check-signup-username') {
    const cleanUsername = normalizeUsername(body.username);
    if (!USERNAME_RE.test(cleanUsername)) {
      return json({ ok: true, valid: false, available: false });
    }
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .ilike('username', cleanUsername)
      .limit(1)
      .maybeSingle();
    return json({ ok: true, valid: true, available: !existing });
  }

  if (body.action === 'login-throttle-status') {
    const resolved = await resolveLoginIdentifier(admin, body.identifier ?? body.email);
    const clientIp = extractClientIp(request) || null;
    if (!resolved.throttleKey && !clientIp) {
      return json({ ok: true, locked: false, retry_after_seconds: 0, threshold: 5 });
    }
    const { data: throttle, error: throttleError } = await admin.rpc('check_login_throttle', {
      p_email: resolved.throttleKey || '',
      p_ip: clientIp
    });
    if (throttleError || !throttle) {
      return json({ ok: true, locked: false, retry_after_seconds: 0, threshold: 5 });
    }
    const locked = Boolean(throttle.locked);
    return json({
      ok: true,
      locked,
      scope: locked ? throttle.scope || null : null,
      retry_after_seconds: locked ? Number(throttle.retry_after_seconds || 0) : 0,
      lock_duration_seconds: locked ? Number(throttle.lock_duration_seconds || 0) : 0,
      next_lock_duration_seconds: Number(throttle.next_lock_duration_seconds || 180),
      locked_until: locked ? throttle.locked_until || null : null,
      threshold: Number(throttle.threshold || 5)
    });
  }

  if (body.action === 'login-attempt') {
    const resolved = await resolveLoginIdentifier(admin, body.identifier ?? body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!resolved.valid || !password || password.length > 1000) {
      return json({
        ok: false,
        locked: false,
        error: { code: 'invalid_credentials', message: 'Incorrect email, username, or password.' }
      });
    }

    const clientIp = extractClientIp(request) || null;
    const { data: preThrottle } = await admin.rpc('check_login_throttle', {
      p_email: resolved.throttleKey,
      p_ip: clientIp
    });
    if (preThrottle?.locked && Number(preThrottle.retry_after_seconds || 0) > 0) {
      return json({
        ok: false,
        locked: true,
        error: { code: 'login_locked', message: 'Too many incorrect sign-in attempts. Please wait before trying again.' },
        throttle: preThrottle
      });
    }

    if (!resolved.email) {
      const { data: postThrottle } = await admin.rpc('record_failed_login_attempt', {
        p_email: resolved.throttleKey,
        p_ip: clientIp
      });
      return json({
        ok: false,
        locked: Boolean(postThrottle?.locked),
        error: { code: 'invalid_credentials', message: 'Incorrect email, username, or password.' },
        throttle: postThrottle || null
      });
    }

    const email = resolved.email;
    const anonClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({ email, password });
    if (authError) {
      if (authError.code === 'email_not_confirmed' || /email not confirmed/i.test(authError.message || '')) {
        return json({
          ok: false,
          locked: false,
          error: { code: 'email_not_confirmed', message: authError.message || 'Email not confirmed.' }
        });
      }
      const { data: postThrottle } = await admin.rpc('record_failed_login_attempt', {
        p_email: resolved.throttleKey,
        p_ip: clientIp
      });
      return json({
        ok: false,
        locked: Boolean(postThrottle?.locked),
        error: { code: 'invalid_credentials', message: 'Incorrect email, username, or password.' },
        throttle: postThrottle || null
      });
    }

    if (!authData?.session?.access_token || !authData?.session?.refresh_token) {
      return json({
        ok: false,
        locked: false,
        error: { code: 'invalid_credentials', message: 'Incorrect email, username, or password.' }
      });
    }

    const { data: loginProfile, error: loginProfileError } = await admin
      .from('profiles')
      .select('id,email,full_name,new_device_email_otp_enabled')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (loginProfileError || !loginProfile) {
      return json({ error: 'Your account profile could not be checked.' }, 500);
    }
    const deviceOtp = await startDeviceOtpIfNeeded(admin, loginProfile, String(body.device_token || '').trim(), service);
    if (deviceOtp) return json(deviceOtp, Number(('status' in deviceOtp ? deviceOtp.status : 200) || 200));

    await Promise.resolve(admin.rpc('clear_login_throttle', { p_email: resolved.throttleKey, p_ip: clientIp })).catch(() => null);
    EdgeRuntime.waitUntil(provisionClerkUser(admin, authData.user, password).catch(() => false));
    return json({
      ok: true,
      locked: false,
      resolved_email: email,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token
      },
      user: authData.user
    });
  }

  if (body.action === 'verify-device-otp') {
    const challengeId = String(body.challenge_id || '').trim();
    const code = String(body.code || '').trim();
    const deviceToken = String(body.device_token || '').trim();
    const authMethod = String(body.auth_method || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code) || !DEVICE_TOKEN_RE.test(deviceToken)) {
      return json({ error: 'Enter the valid 6-digit code sent to your email.' }, 400);
    }
    const { data: challenge } = await admin
      .from('account_device_otp_challenges')
      .select('id,user_id,code_hash,attempts,expires_at,consumed_at')
      .eq('id', challengeId)
      .maybeSingle();
    if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now() || Number(challenge.attempts || 0) >= 5) {
      return json({ error: 'This verification code is expired. Sign in again to request a new code.' }, 400);
    }
    const expectedHash = await deviceCodeHash(challengeId, code, service);
    if (!timingSafeSecretEqual(expectedHash, String(challenge.code_hash || ''))) {
      const attempts = Math.min(5, Number(challenge.attempts || 0) + 1);
      await admin.from('account_device_otp_challenges').update({ attempts }).eq('id', challengeId);
      return json({ error: attempts >= 5 ? 'Too many incorrect codes. Sign in again to request a new code.' : 'That verification code is incorrect.' }, 400);
    }

    const tokenHash = await deviceTokenHash(challenge.user_id, deviceToken, service);
    const trustedUntil = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS).toISOString();
    const { error: trustError } = await admin.from('account_trusted_devices').upsert({
      user_id: challenge.user_id,
      token_hash: tokenHash,
      last_used_at: new Date().toISOString(),
      expires_at: trustedUntil
    }, { onConflict: 'user_id,token_hash' });
    if (trustError) return json({ error: 'Could not remember this device securely.' }, 500);

    const revokeTrust = () => admin.from('account_trusted_devices').delete().eq('user_id', challenge.user_id).eq('token_hash', tokenHash);
    if (authMethod === 'clerk') {
      const response = await exchangeClerkSession(admin, request, String(body.clerk_token || '').trim(), deviceToken, service);
      if (!response.ok) {
        await revokeTrust();
        return response;
      }
      await admin.from('account_device_otp_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', challengeId);
      return response;
    }

    const resolved = await resolveLoginIdentifier(admin, body.identifier ?? body.email);
    const email = resolved.email;
    const password = typeof body.password === 'string' ? body.password : '';
    const verifier = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: authData, error: authError } = email
      ? await verifier.auth.signInWithPassword({ email, password })
      : { data: { user: null, session: null }, error: new Error('Invalid credentials') };
    if (authError || authData.user?.id !== challenge.user_id || !authData.session) {
      await revokeTrust();
      return json({ error: 'Your sign-in session expired. Enter your email or username and password again.' }, 401);
    }
    await admin.from('account_device_otp_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', challengeId);
    await Promise.resolve(admin.rpc('clear_login_throttle', { p_email: resolved.throttleKey || email, p_ip: extractClientIp(request) || null })).catch(() => null);
    EdgeRuntime.waitUntil(provisionClerkUser(admin, authData.user, password).catch(() => false));
    return json({
      ok: true,
      resolved_email: email,
      session: { access_token: authData.session.access_token, refresh_token: authData.session.refresh_token },
      user: authData.user
    });
  }

  if (body.action === 'accept-email-invite') {
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '').trim();
    if (!email || !email.includes('@')) return json({ error: 'A valid email address is required.' }, 400);
    if (!token) return json({ error: 'An invitation token is required.' }, 400);

    const { data: profile } = await admin
      .from('profiles')
      .select('id, status, role, group_id, member_id')
      .ilike('email', email)
      .maybeSingle();

    let targetUserId = profile?.id;
    let authUser = null;

    if (targetUserId) {
      const { data: userRes } = await admin.auth.admin.getUserById(targetUserId).catch(() => ({ data: null }));
      authUser = userRes?.user;
    }

    if (!authUser) {
      authUser = await findAuthUserByEmail(admin, email);
      if (authUser) targetUserId = authUser.id;
    }

    if (!authUser || !targetUserId) {
      return json({ error: 'Invitation not found. Please contact your administrator.' }, 404);
    }

    // Lookup group membership details for this invited user
    const { data: membership } = await admin
      .from('group_memberships')
      .select('group_id, role, member_id')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const targetGroupId = profile?.group_id || membership?.group_id || null;
    const targetMemberId = profile?.member_id || membership?.member_id || null;
    const targetRole = membership?.role || profile?.role || 'MEMBER';

    let groupName = '';
    if (targetGroupId) {
      const { data: grp } = await admin.from('groups').select('name').eq('id', targetGroupId).maybeSingle();
      groupName = grp?.name || '';
    }

    if (profile && profile.status === 'ACTIVE') {
      return json({
        success: true,
        already_active: true,
        group_name: groupName,
        message: 'Your email invitation is verified. Please sign in with your credentials.'
      });
    }

    const currentMeta = (authUser.user_metadata || {}) as Record<string, unknown>;
    const expectedToken = currentMeta.invite_token;
    if (!expectedToken) {
      if (currentMeta.invite_verified_at || currentMeta.invite_accepted_at) {
        return json({
          success: true,
          already_verified: true,
          pending_login: true,
          group_name: groupName,
          message: 'Your email invitation is already verified. Sign in with your credentials to activate your official membership.'
        });
      }
      return json({ error: 'Invalid or expired invitation link. Please ask your administrator to send a new invite.' }, 400);
    }
    if (expectedToken !== token) {
      return json({ error: 'Invalid or expired invitation link. Please ask your administrator to send a new invite.' }, 400);
    }

    const { invite_token: _, ...cleanMeta } = currentMeta;
    const { error: confirmError } = await admin.auth.admin.updateUserById(targetUserId, {
      email_confirm: true,
      user_metadata: {
        ...cleanMeta,
        invite_verified_at: new Date().toISOString()
      }
    });
    if (confirmError) {
      return json({ error: 'Could not verify invitation. Please try again.' }, 500);
    }

    // Keep official membership gated behind the member's first login.
    return json({
      success: true,
      pending_login: true,
      group_name: groupName,
      message: 'Invitation verified! Sign in with your credentials to activate your official membership.'
    });
  }

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

    const { data: superAdminProfile } = await admin
      .from('profiles')
      .select('id, email')
      .eq('role', 'SUPER_ADMIN')
      .limit(1)
      .maybeSingle();

    let resolvedSender = Deno.env.get('INVITE_FROM_EMAIL')?.trim() || Deno.env.get('BREVO_SENDER_EMAIL')?.trim();
    if (!resolvedSender) {
      if (superAdminProfile?.email) {
        resolvedSender = superAdminProfile.email;
      } else if (superAdminProfile?.id) {
        const { data: authUser } = await admin.auth.admin.getUserById(superAdminProfile.id).catch(() => ({ data: null }));
        resolvedSender = authUser?.user?.email;
      }
    }
    const senderEmail = resolvedSender?.trim() || 'breadspanish231@gmail.com';

    const emailOutcome = await sendAdminRequestOtpEmail({
      toEmail: email,
      recipientName: fullName,
      code: result.code,
      senderEmail
    });

    if (!emailOutcome.email_sent) {
      return json({
        success: false,
        email_sent: false,
        error: emailOutcome.email_error || 'Could not deliver verification email. Please check your email address or try again.',
        code: result.code
      }, 400);
    }

    return json({
      success: true,
      email_sent: true,
      email_error: null,
      code: result.code
    });
  }

  if (body.action === 'ensure-account-active') {
    const email = String(body.email || '').trim().toLowerCase();
    let userId = String(body.user_id || '').trim();

    if (!userId && email) {
      const { data: byEmail } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
      userId = byEmail?.id || (await findAuthUserByEmail(admin, email))?.id || '';
    }
    if (!userId) return json({ error: 'Account could not be resolved.' }, 404);

    const fromLogin = Boolean(caller && caller.id === userId);
    const { profile, disabled } = await activateUserAndMembership(admin, userId, { email }, { fromLogin });
    if (disabled) return json({ error: 'This account is disabled. Please contact your administrator.' }, 403);
    if (!profile) return json({ error: 'Account profile could not be activated.' }, 404);
    return json({ success: true, activated: true, profile });
  }

  if (body.action === 'submit-admin-request') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const first = String(body.first || '').trim();
    const middle = body.middle ? String(body.middle).trim() : null;
    const last = String(body.last || '').trim();
    const full = String(body.full || '').trim() || [first, middle, last].filter(Boolean).join(' ');
    const contact = String(body.contact || '').trim();
    const reason = String(body.reason || '').trim();
    const username = normalizeUsername(body.username);
    const requireUsername = body.direct_signup !== false || body.username !== undefined;

    if (!email || !email.includes('@')) return json({ error: 'A valid email address is required.' }, 400);
    if (!password || password.length < 8) return json({ error: 'A strong password of at least 8 characters is required.' }, 400);
    if (!first || !last) return json({ error: 'First name and last name are required.' }, 400);
    if (!contact) return json({ error: 'A contact number is required.' }, 400);
    if (requireUsername && !USERNAME_RE.test(username)) {
      return json({ error: 'Username must be 3–24 lowercase letters, numbers, or underscores.' }, 400);
    }
    if (!reason || reason.length < 10) return json({ error: 'A reason of at least 10 characters is required.' }, 400);

    if (username) {
      const { data: usernameOwner } = await admin
        .from('profiles')
        .select('id, email')
        .ilike('username', username)
        .limit(1)
        .maybeSingle();
      if (usernameOwner && String(usernameOwner.email || '').trim().toLowerCase() !== email) {
        return json({ error: 'That username is already taken. Please choose another username.' }, 400);
      }
    }

    const { data: verRecord } = await admin
      .from('email_verifications')
      .select('id, verified_at')
      .eq('email', email)
      .eq('purpose', 'ADMIN_REQUEST')
      .not('verified_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verRecord) {
      return json({ error: 'Email ownership has not been verified. Please verify your email first.' }, 400);
    }

    const fillProfile = {
      first_name: first,
      middle_name: middle,
      last_name: last,
      full_name: full,
      contact_number: contact,
      email,
      username: username || null
    };
    const syncExistingAccount = async (targetId: string) => {
      const { profile: existingProf, disabled, usernameConflict } = await activateUserAndMembership(admin, targetId, fillProfile);
      if (usernameConflict) return json({ error: 'That username is already taken. Please choose another username.' }, 400);
      if (disabled) return json({ error: 'This account is disabled. Please contact support.' }, 400);
      if (!existingProf) return json({ error: 'Existing account could not be initialized.' }, 500);
      const { error: updError } = await admin.auth.admin.updateUserById(targetId, {
        password,
        email_confirm: true,
        user_metadata: {
          first_name: first,
          middle_name: middle,
          last_name: last,
          full_name: full,
          contact_number: contact,
          username: username || undefined
        }
      });
      if (updError) return json({ error: updError.message || 'Could not update account credentials.' }, 400);
      return json({ success: true, user_id: targetId });
    };

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, status')
      .ilike('email', email)
      .maybeSingle();

    if (existingProfile) {
      return await syncExistingAccount(existingProfile.id);
    }

    const existingAuthUser = await findAuthUserByEmail(admin, email);
    if (existingAuthUser) {
      return await syncExistingAccount(existingAuthUser.id);
    }

    const { data: newUserData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: first,
        middle_name: middle,
        last_name: last,
        full_name: full,
        contact_number: contact,
        username: username || undefined,
        request_reason: reason,
        account_kind: body.direct_signup !== false ? 'DIRECT_SIGNUP' : 'ADMIN_REQUEST'
      }
    });

    if (createError) {
      if (/already registered|already exists/i.test(createError.message || '')) {
        const matched = await findAuthUserByEmail(admin, email);
        if (matched) return await syncExistingAccount(matched.id);
        return json({ error: 'An account with this email already exists.' }, 400);
      }
      return json({ error: createError.message }, 400);
    }

    const userId = newUserData.user?.id;
    if (userId && body.direct_signup !== false) {
      const activated = await activateUserAndMembership(admin, userId, fillProfile);
      if (activated.usernameConflict) {
        return json({ error: 'That username is already taken. Please choose another username.' }, 400);
      }
    }

    return json({
      success: true,
      user_id: userId
    });
  }

  if (body.action === 'retention-cron') {
    const providedSecret = String(request.headers.get('x-push-webhook-secret') || '').trim();
    const { data: cfg } = await admin
      .from('internal_webhook_config')
      .select('value')
      .eq('key', 'push_webhook_secret')
      .maybeSingle();
    const expectedSecret = String(cfg?.value || '').trim();
    if (!expectedSecret || !timingSafeSecretEqual(providedSecret, expectedSecret)) {
      return json({ error: 'Unauthorized maintenance invocation.' }, 401);
    }
    if (body.queue_only === true) {
      const result = await drainPendingStorageDeletions(admin);
      return json({ success: result.failed === 0, ...result }, result.failed ? 500 : 200);
    }
    const result = await runRetentionSweep(admin, { runSqlCleanup: Boolean(body.run_sql) });
    return json({ success: result.errors.length === 0, ...result }, result.errors.length ? 500 : 200);
  }

  if (body.action === 'send-unpaid-reminder-emails') {
    const providedSecret = String(request.headers.get('x-push-webhook-secret') || '').trim();
    const { data: cfg } = await admin
      .from('internal_webhook_config')
      .select('value')
      .eq('key', 'push_webhook_secret')
      .maybeSingle();
    const expectedSecret = String(cfg?.value || '').trim();
    if (!expectedSecret || !timingSafeSecretEqual(providedSecret, expectedSecret)) {
      return json({ error: 'Unauthorized reminder email invocation.' }, 401);
    }
    const recipientId = typeof body.recipient_id === 'string' && body.recipient_id.trim() ? body.recipient_id.trim() : null;
    const result = await dispatchUnpaidReminderEmails(admin, {
      recipientId,
      batch: Boolean(body.batch)
    });
    return json({ success: result.errors.length === 0, ...result });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Your session is invalid.' }, 401);

  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return json({ error: 'Your session is invalid.' }, 401);
  const hasVerifiedMfa = userResult.user.factors?.some((factor) => factor.status === 'verified');
  if (hasVerifiedMfa && tokenAal(token) !== 'aal2') return json({ error: 'Complete multi-factor authentication before continuing.' }, 403);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ANNOUNCEMENTS_BUCKET = 'announcements';
  const RECORD_COMMENTS_BUCKET = 'record-comments';
  const BLOCKED_DISCUSSION_EXT_RE = /\.(exe|msi|bat|cmd|com|pif|scr|vbs|vbe|js|mjs|cjs|jse|wsf|wsh|ps1|psm1|sh|bash|html|htm|xhtml|svg|php|asp|aspx|jsp|jar|dll|sys|drv|reg|hta|cpl)$/i;
  const BLOCKED_DISCUSSION_MIMES = new Set(['text/html', 'application/javascript', 'text/javascript', 'image/svg+xml', 'application/x-msdownload', 'application/x-msdos-program']);

  async function ensureAnnouncementsBucket(client: any) {
    const { error } = await client.storage.createBucket(ANNOUNCEMENTS_BUCKET, { public: false, fileSizeLimit: 52428800 });
    if (error && !/already exists/i.test(error.message || '')) throw error;
  }

  async function ensureRecordCommentsBucket(client: any) {
    const { error } = await client.storage.createBucket(RECORD_COMMENTS_BUCKET, { public: false, fileSizeLimit: 52428800 });
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
  if (actorError || actor?.status === 'DISABLED') return json({ error: 'Your account is disabled.' }, 403);
  if (actor?.status !== 'ACTIVE') {
    await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', userResult.user.id);
    actor.status = 'ACTIVE';
  }

  const MEDIA_BUCKET = 'ipon-media';
  const MEDIA_CATEGORIES = new Set(['avatars', 'covers', 'group-avatars', 'group-qr', 'receipts', 'bug-reports']);

  if (body.action === 'device-otp-settings') {
    const enabled = body.enabled === true;
    const deviceToken = String(body.device_token || '').trim();
    if (enabled && !DEVICE_TOKEN_RE.test(deviceToken)) {
      return json({ error: 'This browser could not be identified securely. Reload the page and try again.' }, 400);
    }
    const { error: updateError } = await admin
      .from('profiles')
      .update({ new_device_email_otp_enabled: enabled })
      .eq('id', userResult.user.id);
    if (updateError) return json({ error: 'Could not update new-device verification.' }, 500);
    if (enabled) {
      const tokenHash = await deviceTokenHash(userResult.user.id, deviceToken, service);
      const { error: trustError } = await admin.from('account_trusted_devices').upsert({
        user_id: userResult.user.id,
        token_hash: tokenHash,
        last_used_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS).toISOString()
      }, { onConflict: 'user_id,token_hash' });
      if (trustError) {
        await admin.from('profiles').update({ new_device_email_otp_enabled: false }).eq('id', userResult.user.id);
        return json({ error: 'Could not remember this device securely.' }, 500);
      }
    } else {
      await Promise.all([
        admin.from('account_trusted_devices').delete().eq('user_id', userResult.user.id),
        admin.from('account_device_otp_challenges').delete().eq('user_id', userResult.user.id)
      ]);
    }
    return json({ success: true, enabled });
  }

  if (body.action === 'media-upload-url') {
    const category = String(body.category || 'misc').trim();
    if (!MEDIA_CATEGORIES.has(category)) {
      return json({ error: 'Unsupported media upload category.' }, 400);
    }
    const rawType = String(body.content_type || 'image/jpeg').trim().toLowerCase();
    const ext = rawType === 'image/png' ? 'png'
      : rawType === 'image/webp' ? 'webp'
      : rawType === 'image/gif' ? 'gif'
      : 'jpg';
    if (r2Storage()) {
      try {
        const objectPath = `${category}/${userResult.user.id}/r2/${crypto.randomUUID()}.${ext}`;
        const signedUrl = await signR2Object(MEDIA_BUCKET, objectPath, 'PUT', rawType);
        return json({
          bucket: MEDIA_BUCKET,
          path: objectPath,
          token: 'r2',
          signedUrl,
          publicUrl: `${url}/functions/v1/manage-account?media=${objectPath}`
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Could not prepare media upload URL.' }, 400);
      }
    }
    const { error: bucketErr } = await admin.storage.createBucket(MEDIA_BUCKET, { public: true, fileSizeLimit: 10485760 });
    if (bucketErr && !/already exists/i.test(bucketErr.message || '')) {
      return json({ error: bucketErr.message || 'Could not prepare media storage bucket.' }, 400);
    }
    const objectPath = `${category}/${userResult.user.id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(objectPath);
    if (error || !data) {
      return json({ error: error?.message || 'Could not prepare media upload URL.' }, 400);
    }
    const { data: pubData } = admin.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
    return json({
      bucket: MEDIA_BUCKET,
      path: objectPath,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl: pubData?.publicUrl || `${url}/storage/v1/object/public/${MEDIA_BUCKET}/${objectPath}`
    });
  }

  if (body.action === 'super-admin-run-maintenance') {
    if (actor.role !== 'SUPER_ADMIN') {
      return json({ error: 'Only the Super Admin can run platform retention cleanup.' }, 403);
    }
    const result = await runRetentionSweep(admin, { runSqlCleanup: true });
    return json({ success: true, ...result });
  }

  if (body.action === 'announcement-upload-urls') {
    const prefix = actorAnnouncementPrefix(actor, userResult.user.id);
    const announcementId = String(body.announcement_id || '').trim();
    const files = Array.isArray(body.files) ? body.files : [];
    if (!prefix) return json({ error: 'Only Owner or Group Administrators can attach announcement media.' }, 403);
    if (!UUID_RE.test(announcementId) || !files.length || files.length > 20) return json({ error: 'Invalid announcement media upload request.' }, 400);
    try {
      if (!r2Storage()) await ensureAnnouncementsBucket(admin);
      const uploads = [];
      for (let i = 0; i < files.length; i += 1) {
        const entry = (files[i] || {}) as { name?: unknown; kind?: unknown; type?: unknown };
        const cleanName = String(entry.name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'media';
        const rawType = String(entry.type || '').trim().toLowerCase().slice(0, 120);
        const kind = entry.kind === 'video' ? 'video' : 'image';
        const path = `${prefix}${announcementId}/${r2Storage() ? 'r2/' : ''}${i}-${crypto.randomUUID().slice(0, 8)}-${cleanName}`;
        if (isR2Path(path)) {
          uploads.push({ path, token: 'r2', signedUrl: await signR2Object(ANNOUNCEMENTS_BUCKET, path, 'PUT', rawType), name: String(entry.name || cleanName).slice(0, 120), kind, type: rawType });
        } else {
          const { data, error } = await admin.storage.from(ANNOUNCEMENTS_BUCKET).createSignedUploadUrl(path);
          if (error || !data) throw error || new Error('Could not create upload URL.');
          uploads.push({ path, token: data.token, name: String(entry.name || cleanName).slice(0, 120), kind, type: rawType });
        }
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
    try {
      return json({ urls: await createPrivateViewUrls(admin, ANNOUNCEMENTS_BUCKET, paths) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unable to sign media URLs.' }, 400);
    }
  }

  if (body.action === 'announcement-cleanup-media') {
    const prefix = actorAnnouncementPrefix(actor, userResult.user.id);
    if (!prefix) return json({ error: 'Permission denied.' }, 403);
    const requested = Array.isArray(body.paths) ? body.paths.map((value) => String(value || '')).filter(Boolean) : [];
    const allowedPaths = requested.filter((path) => !path.includes('..') && (actor.role === 'SUPER_ADMIN' || path.startsWith(prefix)));
    if (!allowedPaths.length) return json({ removed: 0 });
    try {
      return json({ removed: await removePrivateObjects(admin, ANNOUNCEMENTS_BUCKET, allowedPaths) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unable to delete media files.' }, 400);
    }
  }

  if (body.action === 'record-comment-upload-urls') {
    const recordType = String(body.record_type || '').trim().toLowerCase();
    const recordId = String(body.record_id || '').trim();
    const files = Array.isArray(body.files) ? body.files : [];
    if (!['contribution', 'withdrawal', 'expense'].includes(recordType) || !UUID_RE.test(recordId) || !files.length || files.length > 5) {
      return json({ error: 'Invalid discussion attachment request.' }, 400);
    }
    if (!actor.group_id) return json({ error: 'Join or select a savings group first.' }, 403);
    const { data: thread, error: threadError } = await caller.rpc('get_record_comments', { p_record_type: recordType, p_record_id: recordId });
    if (threadError || !thread?.can_reply) {
      return json({ error: threadError?.message || 'You do not have permission to attach files to this record.' }, 403);
    }
    try {
      if (!r2Storage()) await ensureRecordCommentsBucket(admin);
      const uploads = [];
      for (let i = 0; i < files.length; i += 1) {
        const entry = (files[i] || {}) as { name?: unknown; kind?: unknown; type?: unknown; size?: unknown };
        const rawName = String(entry.name || 'attachment').slice(0, 120);
        const rawType = String(entry.type || '').trim().toLowerCase().slice(0, 120);
        const rawSize = Number(entry.size || 0);
        if (rawSize > 52428800) {
          return json({ error: `"${rawName}" exceeds the 50 MB file size limit.` }, 400);
        }
        if (BLOCKED_DISCUSSION_EXT_RE.test(rawName) || BLOCKED_DISCUSSION_MIMES.has(rawType)) {
          return json({ error: `"${rawName}" cannot be uploaded for security reasons.` }, 400);
        }
        const cleanName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'attachment';
        const kind = entry.kind === 'image' ? 'image' : (entry.kind === 'video' ? 'video' : 'file');
        const path = `${actor.group_id}/${recordType}/${recordId}/${userResult.user.id}/${r2Storage() ? 'r2/' : ''}${i}-${crypto.randomUUID().slice(0, 8)}-${cleanName}`;
        if (isR2Path(path)) {
          uploads.push({ path, token: 'r2', signedUrl: await signR2Object(RECORD_COMMENTS_BUCKET, path, 'PUT', rawType), name: rawName, kind, type: rawType, size: Math.max(0, Math.round(rawSize)) });
        } else {
          const { data, error } = await admin.storage.from(RECORD_COMMENTS_BUCKET).createSignedUploadUrl(path);
          if (error || !data) throw error || new Error('Could not prepare file upload.');
          uploads.push({ path, token: data.token, name: rawName, kind, type: rawType, size: Math.max(0, Math.round(rawSize)) });
        }
      }
      return json({ uploads });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unable to prepare attachment uploads.' }, 400);
    }
  }

  if (body.action === 'record-comment-view-urls') {
    const recordType = String(body.record_type || '').trim().toLowerCase();
    const recordId = String(body.record_id || '').trim();
    if (!['contribution', 'withdrawal', 'expense'].includes(recordType) || !UUID_RE.test(recordId)) {
      return json({ error: 'Invalid record reference.' }, 400);
    }
    const { data: thread, error: threadError } = await caller.rpc('get_record_comments', { p_record_type: recordType, p_record_id: recordId });
    if (threadError || !thread) return json({ error: threadError?.message || 'Discussion not found.' }, 404);
    const comments = Array.isArray(thread.comments) ? thread.comments : [];
    const paths = [...new Set<string>(
      comments.flatMap((comment: { attachments?: unknown }) =>
        (Array.isArray(comment?.attachments) ? comment.attachments : [])
          .map((att: { path?: unknown }) => String(att?.path || ''))
          .filter((p: string) => p && !p.includes('..'))
      ) as string[]
    )];
    if (!paths.length) return json({ urls: {} });
    try {
      return json({ urls: await createPrivateViewUrls(admin, RECORD_COMMENTS_BUCKET, paths) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unable to load attachment links.' }, 400);
    }
  }

  if (body.action === 'record-comment-cleanup-media') {
    const requested = Array.isArray(body.paths) ? body.paths.map((value) => String(value || '')).filter(Boolean) : [];
    const ownSegment = `/${userResult.user.id}/`;
    const allowedPaths = requested.filter((path) => !path.includes('..') && path.includes(ownSegment));
    if (!allowedPaths.length) return json({ removed: 0 });
    try {
      return json({ removed: await removePrivateObjects(admin, RECORD_COMMENTS_BUCKET, allowedPaths) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unable to clean up uploaded files.' }, 400);
    }
  }

  if (body.action === 'chat-upload-urls' || body.action === 'chat-view-urls' || body.action === 'chat-cleanup-media') {
    return json({ error: 'Chat messaging has been removed from myIPON.' }, 410);
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
    const { error } = await admin.auth.admin.updateUserById(target.id, {
      password,
      email_confirm: true,
      app_metadata: { ...(targetAuth?.user?.app_metadata || {}), must_change_password: false }
    });
    if (error) return json({ error: 'Password could not be updated.' }, 400);
    // Ensure a previously invited/pending member whose password was reset by an admin can immediately sign in
    await activateUserAndMembership(admin, target.id);
    return json({ updated: true });
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
    if (targetError || !target) return json({ error: 'Target account not found.' }, 404);

    let recipientEmail = String(body.email || '').trim().toLowerCase() || (target.email ? String(target.email).trim().toLowerCase() : null);
    if (!recipientEmail) {
      const { data: reqRow } = await admin
        .from('admin_requests')
        .select('email')
        .eq('requester_id', targetId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (reqRow?.email) recipientEmail = String(reqRow.email).trim().toLowerCase();
    }
    if (!recipientEmail) {
      const { data: authUser } = await admin.auth.admin.getUserById(targetId);
      if (authUser?.user?.email) recipientEmail = String(authUser.user.email).trim().toLowerCase();
    }
    if (!recipientEmail) return json({ error: 'Target email address not found.' }, 404);

    // Sync profiles.email if it was missing
    if (!target.email && recipientEmail) {
      await admin.from('profiles').update({ email: recipientEmail }).eq('id', targetId);
    }

    const expectedStatus = decision === 'APPROVED' ? 'ACTIVE' : 'DISABLED';
    if (target.status !== expectedStatus) return json({ error: 'Target request status does not match decision.' }, 400);

    let resolvedGroupName = String(body.group_name || '').trim() || null;
    if (!resolvedGroupName && target.group_id) {
      const { data: groupRow } = await admin.from('groups').select('name').eq('id', target.group_id).maybeSingle();
      resolvedGroupName = groupRow?.name || null;
    }
    const recipientName = target.full_name || [target.first_name, target.middle_name, target.last_name].filter(Boolean).join(' ') || recipientEmail;
    const originUrl = APP_LOGIN_URL;

    const superAdminEmail = actor.email || userResult.user.email || null;

    const emailOutcome = await sendAdminRequestDecisionEmail({
      toEmail: recipientEmail,
      recipientName,
      decision,
      groupName: resolvedGroupName,
      reviewNote: String(body.review_note || '').trim() || null,
      subject: String(body.subject || body.email_subject || '').trim() || null,
      senderEmail: superAdminEmail,
      bccSuperAdmin: superAdminEmail,
      loginUrl: originUrl
    });

    return json({ email_sent: emailOutcome.email_sent, email_error: emailOutcome.email_error });
  }

  if (body.action === 'super-admin-account-action') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can perform account actions.' }, 403);
    const targetUserId = String(body.user_id || '').trim();
    const actionType = String(body.action_type || '').toUpperCase();
    const reason = String(body.reason || '').trim();

    if (!UUID_RE.test(targetUserId)) return json({ error: 'A valid target user ID is required.' }, 400);
    if (!['DEACTIVATE', 'DELETE', 'REACTIVATE'].includes(actionType)) {
      return json({ error: 'Invalid action type.' }, 400);
    }
    if ((actionType === 'DEACTIVATE' || actionType === 'DELETE') && reason.length < 3) {
      return json({ error: 'A reason of at least 3 characters is required.' }, 400);
    }

    if (targetUserId === actor.id) {
      return json({ error: 'You cannot deactivate or delete your own super administrator account.' }, 400);
    }

    const { data: targetProfile, error: targetError } = await admin
      .from('profiles')
      .select('id,role,full_name,email,first_name,last_name,status')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetError || !targetProfile) return json({ error: 'Target user not found.' }, 404);
    if (targetProfile.role === 'SUPER_ADMIN') {
      return json({ error: 'Super administrator accounts cannot be modified here.' }, 400);
    }

    let targetEmail = targetProfile.email;
    if (!targetEmail) {
      const { data: authUser } = await admin.auth.admin.getUserById(targetUserId).catch(() => ({ data: null }));
      targetEmail = authUser?.user?.email || null;
    }
    const targetName = targetProfile.full_name || [targetProfile.first_name, targetProfile.last_name].filter(Boolean).join(' ') || 'User';

    let emailOutcome = { email_sent: false, email_error: null as string | null };
    if (targetEmail) {
      try {
        emailOutcome = await sendAccountStatusEmail({
          toEmail: targetEmail,
          recipientName: targetName,
          actionType: actionType as 'DEACTIVATE' | 'DELETE' | 'REACTIVATE',
          reason,
          senderEmail: actor.email
        });
      } catch (err) {
        emailOutcome = {
          email_sent: false,
          email_error: err instanceof Error ? err.message : 'Failed to deliver status email.'
        };
      }
    }

    if (actionType === 'DEACTIVATE') {
      const { error: rpcErr } = await caller.rpc('super_admin_set_administrator_status', {
        p_user_id: targetUserId,
        p_status: 'DISABLED'
      });
      if (rpcErr) {
        await admin.from('profiles').update({ status: 'DISABLED' }).eq('id', targetUserId);
      }
    } else if (actionType === 'REACTIVATE') {
      const { error: rpcErr } = await caller.rpc('super_admin_set_administrator_status', {
        p_user_id: targetUserId,
        p_status: 'ACTIVE'
      });
      if (rpcErr) {
        await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', targetUserId);
      }
    } else if (actionType === 'DELETE') {
      const { error: rpcError } = await caller.rpc('super_admin_delete_user', {
        p_user_id: targetUserId
      });
      if (rpcError) {
        await admin.from('groups').update({ owner_id: null, status: 'SUSPENDED' }).eq('owner_id', targetUserId);
        await admin.from('group_memberships').delete().eq('user_id', targetUserId);
        await admin.from('profiles').delete().eq('id', targetUserId);
      }
      await admin.auth.admin.deleteUser(targetUserId).catch(() => null);
    }

    return json({
      success: true,
      action: actionType,
      user_id: targetUserId,
      email_sent: emailOutcome.email_sent,
      email_error: emailOutcome.email_error
    });
  }

  if (body.action === 'unblock-admin-request') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can unblock requests.' }, 403);
    const targetId = String(body.user_id || '').trim();
    if (!UUID_RE.test(targetId)) return json({ error: 'A valid target user ID is required.' }, 400);

    const { data: unblockResult, error: unblockError } = await caller.rpc('super_admin_unblock_admin_request', {
      p_user_id: targetId
    });

    if (unblockError) {
      return json({ error: unblockError.message || 'Could not unblock administrator request.' }, 400);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteError && !/not found/i.test(deleteError.message || '')) {
      console.warn('Could not delete user from auth:', deleteError);
    }

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
  const rawFirst = normalizeNamePart(body.first_name);
  const rawMiddle = normalizeNamePart(body.middle_name);
  const rawLast = normalizeNamePart(body.last_name);
  const nameOptional = role !== 'ADMIN' && (Boolean(body.name_optional) || !rawFirst || !rawLast);
  const fallback = fallbackNamesFromEmail(email);
  const firstName = rawFirst || fallback.first;
  const middleName = rawMiddle || null;
  const lastName = rawLast || fallback.last;
  const contactNumber = String(body.contact_number || '').trim() || null;

  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'A valid email address is required.' }, 400);
  if (role === 'ADMIN' && (!rawFirst || !rawLast)) {
    return json({ error: 'Valid name and email fields are required.' }, 400);
  }
  const badFirst = (!nameOptional && !validFormalNamePart(firstName)) || (rawFirst && !validFormalNamePart(rawFirst));
  const badMiddle = Boolean(middleName && !validFormalNamePart(middleName, { allowSingleInitial: true, required: false }));
  const badLast = (!nameOptional && !validFormalNamePart(lastName)) || (rawLast && !validFormalNamePart(rawLast));
  if (badFirst) return json({ error: 'Use formal capitalization for first name (e.g., Juan). Do not use ALL CAPS or all lowercase.' }, 400);
  if (badMiddle) return json({ error: 'Use formal capitalization for middle name (e.g., Santos or A). Do not use ALL CAPS or all lowercase.' }, 400);
  if (badLast) return json({ error: 'Use formal capitalization for last name (e.g., Dela Cruz). Do not use ALL CAPS or all lowercase.' }, 400);
  if (role === 'ADMIN' && String(body.group_name || '').trim().length < 2) return json({ error: 'Group name is required.' }, 400);

  // Check if user email already exists (allowed for cross-group Member / Treasurer invites by Group Admins).
  if (role !== 'ADMIN' && actor.group_id) {
    const { data: targetGroup } = await admin
      .from('groups')
      .select('workspace_mode')
      .eq('id', actor.group_id)
      .maybeSingle();
    if (targetGroup?.workspace_mode === 'SOLO') {
      return json({
        error: 'Solo savings workspaces do not support member or treasurer invitations. Switch this workspace to Group savings in Group settings first.'
      }, 400);
    }
  }

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
  let inviteToken: string | null = null;
  if (existingProfile) {
    targetUserId = existingProfile.id;
  } else {
    inviteToken = crypto.randomUUID();
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
        account_kind: 'INVITED',
        invite_token: inviteToken,
        name_setup_required: nameOptional
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
    const initialStatus = 'PENDING';
    const result = role === 'ADMIN'
      ? await caller.rpc('super_admin_approve_request', { p_user_id: targetUserId, p_group_name: String(body.group_name).trim() })
      : await caller.rpc('admin_set_user_access', { p_user_id: targetUserId, p_role: role, p_status: initialStatus, p_member_id: role === 'MEMBER' ? targetMemberId : null });
    if (result.error) throw result.error;

    if (!existingProfile) {
      await admin.from('profiles').update({
        status: 'PENDING',
        name_setup_required: nameOptional
      }).eq('id', targetUserId);
      await admin.from('group_memberships').update({ status: 'PENDING' }).eq('user_id', targetUserId);
    }

    if (role === 'ADMIN') return json({ id: targetUserId });

    const [{ data: groupRow }, inviterName] = await Promise.all([
      actor.group_id ? admin.from('groups').select('name').eq('id', actor.group_id).maybeSingle() : Promise.resolve({ data: null }),
      Promise.resolve(actor.full_name || [actor.first_name, actor.middle_name, actor.last_name].filter(Boolean).join(' ') || 'Group Administrator')
    ]);
    const groupName = groupRow?.name || 'Savings Group';
    const recipientName = existingProfile?.full_name || [firstName, middleName, lastName].filter(Boolean).join(' ');
    const originUrl = APP_LOGIN_URL;

    if (existingProfile && actor.group_id) {
      await admin.from('notifications').insert({
        recipient_id: targetUserId,
        group_id: actor.group_id,
        type: 'GROUP_INVITE',
        title: `Invitation: ${groupName}`,
        message: `${inviterName} invited you to join "${groupName}" as a ${role.toLowerCase()}.`,
        link: `dashboard.html?invite=${encodeURIComponent(actor.group_id)}`
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
          loginUrl: originUrl,
          inviteToken: existingProfile ? null : inviteToken
        });

    return json({
      id: targetUserId,
      member_id: targetMemberId,
      existing_account: Boolean(existingProfile),
      invite_token: inviteToken,
      ...emailOutcome
    });
  } catch (error) {
    if (createdAuthHere) await admin.auth.admin.deleteUser(targetUserId);
    if (createdMemberHere && targetMemberId) await admin.from('members').delete().eq('id', targetMemberId);
    return json({ error: error instanceof Error ? error.message : 'Account setup failed.' }, 400);
  }
});
