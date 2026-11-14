import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const SYSTEM_NAME = 'IPON Group Savings Tracker';
const EMAIL_LOGO_URL = 'https://my-ipon.vercel.app/assets/icon-192.png';

function emailBrandHeaderMarkup() {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px;">
      <tr>
        <td style="vertical-align: middle; padding-right: 10px;">
          <img src="${EMAIL_LOGO_URL}" alt="IPON" width="34" height="34" style="display: block; width: 34px; height: 34px; border-radius: 8px; border: 0;" />
        </td>
        <td style="vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #163029;">
          IPON
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
    return {
      name: match[1].trim().replace(/^["']|["']$/g, '') || fallbackName,
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
    const resendPayload: Record<string, unknown> = {
      from: rawFrom || `${SYSTEM_NAME} <onboarding@resend.dev>`,
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

const GEMINI_RELEASE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-1.5-flash'
];

function formatGeminiApiError(status: number, model: string, rawText: string) {
  let msg = '';
  let reason = '';
  try {
    const parsed = JSON.parse(rawText);
    msg = String(parsed?.error?.message || '').trim();
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
    const info = details.find((d: any) => d?.reason);
    reason = String(info?.reason || parsed?.error?.status || '').trim();
  } catch {
    msg = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  }
  if (reason === 'BILLING_DISABLED' || /requires billing to be enabled/i.test(msg)) {
    return `Google Cloud billing is disabled for this AQ. Vertex AI key (${status} on ${model}). Either enable billing on that Google Cloud project or click Configure API key to save a free-tier Google AI Studio key (created via aistudio.google.com, which also starts with AQ. or AIzaSy).`;
  }
  if (
    reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED' ||
    reason === 'API_KEY_INVALID' ||
    /API key not valid|API key expired|PERMISSION_DENIED/i.test(msg)
  ) {
    return `Gemini server API key rejected (${status} on ${model}): ${msg || 'Invalid or revoked key'}. Open Configure API key to test and save a working key from Google AI Studio on the server.`;
  }
  return `Gemini API error (${status} on ${model}): ${msg || 'Request failed'}${reason ? ` [${reason}]` : ''}`;
}

const GEMINI_CONFIG_KEY = 'gemini_api_key';

async function resolveServerGeminiKey(admin: any): Promise<{ key: string; source: 'saved' | 'env' | 'none' }> {
  try {
    const { data } = await admin
      .from('internal_webhook_config')
      .select('value')
      .eq('key', GEMINI_CONFIG_KEY)
      .maybeSingle();
    const saved = String(data?.value || '').trim();
    if (saved) return { key: saved, source: 'saved' };
  } catch {
    // Fall back to Edge Function secret if config table lookup fails.
  }
  const envKey = String(Deno.env.get('GEMINI_API_KEY') || '').trim();
  if (envKey) return { key: envKey, source: 'env' };
  return { key: '', source: 'none' };
}

function maskApiKey(key: string): string {
  const clean = String(key || '').trim();
  if (!clean) return '';
  if (clean.length <= 10) return `${clean.slice(0, 3)}••••`;
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}

async function generateWithGemini({
  apiKey,
  prompt,
  systemInstruction
}: {
  apiKey: string;
  prompt: string;
  systemInstruction?: string;
}) {
  const cleanKey = String(apiKey || '').trim();
  const isAiStudioKey = cleanKey.startsWith('AIza');
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.92,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // Newer Google AI Studio free-tier keys also start with AQ. alongside Vertex Express AQ. keys, so try Generative Language first and Vertex second for AQ. keys.
  const buildEndpoints = (model: string) => {
    const glUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const vertexUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    if (isAiStudioKey) return [glUrl];
    return [glUrl, vertexUrl];
  };

  let lastErr: Error | null = null;
  for (const model of GEMINI_RELEASE_MODELS) {
    const endpoints = buildEndpoints(model);
    let fatalCredentialOrBilling = true;
    for (let epIdx = 0; epIdx < endpoints.length; epIdx += 1) {
      const url = endpoints[epIdx];
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 22000);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!response.ok) {
          const errorText = await response.text();
          lastErr = new Error(formatGeminiApiError(response.status, model, errorText));
          const isCredentialOrBilling =
            response.status === 401 ||
            response.status === 403 ||
            /BILLING_DISABLED|PERMISSION_DENIED|API_KEY_INVALID|API key not valid|API key expired|ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(errorText);
          if (isCredentialOrBilling) {
            if (epIdx + 1 < endpoints.length) continue;
            break;
          }
          fatalCredentialOrBilling = false;
          if (epIdx + 1 < endpoints.length && /not[\s_]*found/i.test(errorText)) continue;
          break;
        }
        fatalCredentialOrBilling = false;
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          lastErr = new Error(`No text generated by Gemini (${model}).`);
          break;
        }
        const cleanJson = String(rawText).trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        return { parsed: JSON.parse(cleanJson), model };
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        fatalCredentialOrBilling = false;
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (err instanceof SyntaxError || err?.name === 'AbortError' || /JSON|Unterminated|Unexpected token|abort/i.test(String(err?.message || ''))) {
          break;
        }
        throw lastErr;
      }
    }
    if (fatalCredentialOrBilling && lastErr) {
      throw lastErr;
    }
  }
  throw lastErr || new Error('Unable to generate release notes with Gemini.');
}

const TECH_COMMIT_RE = /\b(?:supabase|migrations?|edge\s+functions?|rpc\s+functions?|database\s+functions?|deno|postgres(?:ql)?|postgrest?|rls|sql|triggers?|foreign\s+keys?|jsonb|cli|ide|vscode|antigravity|github|git\s+commits?|repo\s+commits?|live\s+commits?|repo(?:sitory)?|contracts?\.test|unit\s+tests?|test\s+suite|lint(?:ing)?|eslint|prettier|package\.json|lockfile|node_modules|html\s+csp|csp\s+headers?|deployment|deploy(?:ed|ing)?|auto-?sync|automate|release\s+ai|ai\s+release\s+notes|ai\s+and\s+composer|composer\s+formatting|smart\s+composer|procedural\s+composer|prior\s+releases|invite\s+rows?|database\s+rows?|name\s+pills?|ui\/ux\s+skills?|workspace\s+skills?|audit_logs|enforce_group_scope|admin_create_group|old\.amount|group_id|member_id|requester_id|codebase|refactor(?:ing)?|tdz|iife|vm\.run|playwright|puppeteer|cdp|edge\s+function\s+cache|asset\s+cache|cache\s+version|api\s+endpoints?|webhooks?|descendant\s+selector|selector\s+leak|vertex\s+ai|ai\s+studio|ai\s+coach|savings\s+coach|write\s+with\s+ai|invokeaccountfunction|window\.ipon|populategroupselect)\b/i;
const CODE_TOKEN_RE = /(?:\b[a-z_][a-z0-9_]{1,}\.[a-z_][a-z0-9_]{1,}\b|_[a-z]|(?:\b(?:js|css|supabase|database|scripts|tests|android|\.agents)\/[a-z0-9_./-]+|[a-z0-9_-]+\/[a-z0-9_.-]+\.[a-z]{2,4}\b)|`|\(\)|[A-Z][a-z]+Error\b)/;
const NOISE_CLAUSE_RE = /^(?:ui\s+(?:polish|refinements?|tweaks?)|minor\s+ui\s+(?:polish|tweaks?)|visual\s+polish|code\s+cleanup|polish|refinements?|fixes|all updates are covered.*)$/i;
const COMMIT_VERB_RE = /^(Add|Fix|Keep|Allow|Show|Support|Enable|Improve|Make|Update|Upgrade|Block|Prevent|Deduplicate|Streamline|Polish|Implement|Restore|Resolve|Guard|Remove|Restrict|Align|Clarify|Start|Notify|Enforce|Hide|Extend)\b/i;
const COMMIT_STOP_WORDS = new Set(['with', 'from', 'into', 'that', 'this', 'when', 'while', 'across', 'inside', 'under', 'after', 'before', 'their', 'users', 'user', 'added', 'fixed', 'updated', 'keep', 'make', 'allow', 'show', 'support', 'enable', 'improve', 'upgrade', 'remove', 'restrict', 'align', 'enforce', 'ensure', 'resolved', 'issues', 'involving', 'smoother', 'experience', 'workflow', 'workflows', 'feature', 'features', 'system', 'myipon', 'group', 'groups', 'member', 'members', 'admin', 'admins', 'savers', 'treasurer', 'treasurers', 'also', 'plus', 'more', 'less', 'only', 'every', 'each', 'both', 'clear', 'clean', 'cleaner', 'direct', 'directly', 'immediately', 'strictly']);

function canonicalizeClauseForParsing(rawLine: string) {
  return String(rawLine || '')
    .replace(/\([^)]*(?:migrations?|js\/|css\/|\.html|tests\/|manage-account|AGENTS\.md|parseMoneyAmount|validateMoneyInput|guardMoneyInput)[^)]*\)/gi, ' ')
    .replace(/\bvia\s+shared\s+helpers(?:\s+in\s+[a-z0-9._/-]+)?/gi, '')
    .replace(/\bthrough\s+VAPID\s+Web\s+Push\s+delivery[^.;]*/gi, 'for closed-app web and mobile background alerts')
    .replace(/\b(?:in|under)\s+(?:[a-z0-9._-]+\/[a-z0-9._/-]+|AGENTS\.md|account\.html|super-admin\.html)\b(?:\s+and\s+[a-z0-9._/-]+)?/gi, '')
    .replace(/\bAdditional\s+UI\s+refinements\s+/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCommitUpdates(rawMessage: string) {
  const rawLines = String(rawMessage || '').split(/\r?\n/);
  if (!rawLines.length) return [];
  const results: string[] = [];
  rawLines.forEach((origLine, lineIdx) => {
    const isBulletOrSubject = lineIdx === 0 || /^[•\-*]\s+/.test(origLine.trim());
    const line = canonicalizeClauseForParsing(origLine.trim().replace(/^[•\-*]\s*/, '').trim());
    if (!line) return;
    if (/^(?:merge\b|wip\b|bump\b|prepare\s+mobile\b|revert\b|export\b|(?:chore|ci|build|test|docs|style|refactor)(?:\([^)]*\))?:)/i.test(line)) {
      return;
    }

    if (!isBulletOrSubject) {
      const sentences = line
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim().replace(/[.;]+$/, ''))
        .filter(Boolean);
      for (const sentence of sentences) {
        if (sentence.length < 18 || NOISE_CLAUSE_RE.test(sentence)) continue;
        if (TECH_COMMIT_RE.test(sentence) || CODE_TOKEN_RE.test(sentence)) continue;
        results.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
      }
      return;
    }

    const leadMatch = line.match(/^(Add|Fix|Keep|Allow|Show|Support|Enable|Improve|Make|Update|Upgrade|Block|Prevent|Deduplicate|Streamline|Polish|Implement|Restore|Resolve|Guard|Remove|Restrict|Align|Clarify|Start|Notify|Enforce|Hide|Extend)\s+(.+)$/i);
    const defaultVerb = leadMatch ? (leadMatch[1].charAt(0).toUpperCase() + leadMatch[1].slice(1).toLowerCase()) : '';
    const remainder = leadMatch ? leadMatch[2] : line;
    const masked = remainder
      .replace(/(\d),(?=\d)/g, '$1\u0001')
      .replace(/\b(with|across|including|such\s+as|among|between)\s+[^.;]+/gi, (seg) => seg.replace(/,/g, '\u0001'));
    const candidateClauses = masked
      .split(/(?:\s*,\s*(?:and\s+)?|\s*;\s*|\s+(?:and\s+(?=add|fix|keep|allow|show|support|enable|improve|make|update|upgrade|block|prevent|deduplicate|streamline|polish|implement|restore|resolve|guard|remove|restrict|align|clarify|start|notify|enforce|hide|extend)|plus)\s+)/i)
      .map((part) => part.replace(/\u0001/g, ',').trim().replace(/[.;]+$/, ''))
      .filter(Boolean);
    const hasSingleWordFragment = candidateClauses.length > 1 && candidateClauses.some((part) => !/\s/.test(part));
    const rawClauses = hasSingleWordFragment
      ? [remainder.trim().replace(/[.;]+$/, '')]
      : candidateClauses;
    for (let idx = 0; idx < rawClauses.length; idx++) {
      const rawClause = rawClauses[idx];
      if (rawClause.length < 10) continue;
      if (NOISE_CLAUSE_RE.test(rawClause)) continue;
      if (TECH_COMMIT_RE.test(rawClause) || CODE_TOKEN_RE.test(rawClause)) continue;
      if (/\b(?:without|with|for|and|or|to|on|in|from|into)$/i.test(rawClause)) continue;
      const hasOwnVerb = idx > 0 && COMMIT_VERB_RE.test(rawClause);
      const item = hasOwnVerb ? rawClause : (defaultVerb ? `${defaultVerb} ${rawClause}` : rawClause);
      if (item.length < 12) continue;
      results.push(item.charAt(0).toUpperCase() + item.slice(1));
    }
  });
  return results;
}

function cleanCommitSummary(rawMessage: string) {
  return extractCommitUpdates(rawMessage).join(', ');
}

function extractCommitStems(text: string) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, ' ')
    .split(/[\s/-]+/)
    .filter((w) => w.length >= 4 && !COMMIT_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const stems: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const stem = w
      .replace(/(?:ation|ition|ments?|ings?|ers?|ions?|ies|ed|es|s)$/, '')
      .slice(0, 7);
    if (stem.length < 3 || seen.has(stem)) continue;
    seen.add(stem);
    stems.push(stem);
  }
  return stems;
}

function clausesOverlapTopic(a: string, b: string) {
  const stemsA = extractCommitStems(a);
  const stemsB = extractCommitStems(b);
  if (!stemsA.length || !stemsB.length) return a.toLowerCase() === b.toLowerCase();
  const setB = new Set(stemsB);
  const shared = stemsA.filter((s) => setB.has(s));
  const minLen = Math.min(stemsA.length, stemsB.length);
  if (minLen <= 2) return shared.length >= minLen;
  return shared.length >= 2 && (shared.length / minLen) >= 0.55;
}

function canonicalizeCommitUpdates(rawItems: string[] = [], excludedText = '') {
  const out: string[] = [];
  const excludedStems = new Set(extractCommitStems(excludedText));
  for (const raw of (Array.isArray(rawItems) ? rawItems : [])) {
    for (const item of extractCommitUpdates(raw)) {
      const stems = extractCommitStems(item);
      if (excludedStems.size > 0 && stems.length >= 2) {
        const hitCount = stems.filter((s) => excludedStems.has(s)).length;
        if (hitCount / stems.length >= 0.75) continue;
      }
      const matchIdx = out.findIndex((existing) => clausesOverlapTopic(existing, item));
      if (matchIdx !== -1) {
        if (item.length > out[matchIdx].length + 12) {
          out[matchIdx] = item;
        }
        continue;
      }
      out.push(item);
      if (out.length >= 60) return out;
    }
  }
  return out;
}

function findMissingReleaseItems(
  buckets: {
    newFeatures?: string[];
    fixes?: string[];
    improvements?: string[];
    requestedFeatures?: string[];
    securityUpdates?: string[];
    otherChanges?: string[];
  },
  expectedRawItems: string[] = []
): string[] {
  const allBullets = [
    ...(Array.isArray(buckets?.newFeatures) ? buckets.newFeatures : []),
    ...(Array.isArray(buckets?.fixes) ? buckets.fixes : []),
    ...(Array.isArray(buckets?.improvements) ? buckets.improvements : []),
    ...(Array.isArray(buckets?.requestedFeatures) ? buckets.requestedFeatures : []),
    ...(Array.isArray(buckets?.securityUpdates) ? buckets.securityUpdates : []),
    ...(Array.isArray(buckets?.otherChanges) ? buckets.otherChanges : [])
  ];
  const bulletStemSets = allBullets.map((b) => new Set(extractCommitStems(b)));
  const canonicalExpected = canonicalizeCommitUpdates(expectedRawItems);
  const missing: string[] = [];
  for (const raw of canonicalExpected) {
    const stems = extractCommitStems(raw);
    const requiredHits = stems.length <= 2 ? stems.length : Math.min(3, Math.max(2, Math.ceil(stems.length * 0.35)));
    const alreadyCovered = stems.length > 0 && bulletStemSets.some((bSet) => {
      let hits = 0;
      for (const s of stems) {
        if (bSet.has(s) || [...bSet].some((bs) => bs.slice(0, 4) === s.slice(0, 4))) hits += 1;
      }
      return hits >= requiredHits;
    });
    if (!alreadyCovered) missing.push(raw);
  }
  return missing;
}

async function fetchRecentSystemUpdates(sinceIso?: string | null) {
  const fetchPage = async (sinceParam?: string | null) => {
    const qs = new URLSearchParams({ per_page: '100' });
    if (sinceParam) qs.set('since', sinceParam);
    try {
      const response = await fetch(`https://api.github.com/repos/zediskaaa/Ipon-Tracking-System/commits?${qs.toString()}`, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!response.ok) return [];
      const rows = await response.json();
      if (!Array.isArray(rows)) return [];
      return canonicalizeCommitUpdates(rows.map((entry: any) => String(entry?.commit?.message || '')));
    } catch {
      return [];
    }
  };
  let updates = await fetchPage(sinceIso);
  if (!sinceIso && updates.length < 6) updates = await fetchPage(null);
  return updates;
}

const OBJECT_STR_RE = /\[object\s+[^\]]+\]/i;

function coerceReleaseBulletText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const clean = raw.replace(/^[•\s*-]+/, '').trim();
    return OBJECT_STR_RE.test(clean) ? '' : clean;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) {
    return raw.map(coerceReleaseBulletText).filter(Boolean).join(' ').trim();
  }
  if (typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    const titleKeys = ['title', 'name', 'feature', 'feature_name', 'change_name', 'label', 'heading', 'topic', 'area'];
    const detailKeys = [
      'summary', 'description', 'details', 'explanation', 'what_changed', 'change',
      'how_it_works', 'expect', 'what_to_expect', 'impact', 'benefit', 'user_impact', 'practical_impact',
      'text', 'message'
    ];
    const skipKeys = new Set([...titleKeys, 'requester', 'requested_by', 'requester_name', 'credit', 'category', 'type', 'section', 'version']);
    let head = '';
    for (const k of titleKeys) {
      const val = coerceReleaseBulletText(rec[k]);
      if (val) { head = val.replace(/[:.\s]+$/, ''); break; }
    }
    const bodyParts: string[] = [];
    const seen = new Set<string>(head ? [head.toLowerCase()] : []);
    const pushPart = (val: string) => {
      if (!val) return;
      const key = val.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      bodyParts.push(val);
    };
    for (const k of detailKeys) pushPart(coerceReleaseBulletText(rec[k]));
    for (const [k, v] of Object.entries(rec)) {
      if (skipKeys.has(k) || detailKeys.includes(k)) continue;
      pushPart(coerceReleaseBulletText(v));
    }
    const requester = coerceReleaseBulletText(rec.requester_name || rec.requested_by || rec.requester || rec.credit);
    let combined = bodyParts.join(' ').replace(/\s{2,}/g, ' ').trim();
    if (requester && !/requested by:/i.test(combined)) {
      combined = combined ? `${combined} (Requested by: ${requester})` : `(Requested by: ${requester})`;
    }
    if (head && combined) return OBJECT_STR_RE.test(`${head}: ${combined}`) ? '' : `${head}: ${combined}`;
    const single = head || combined;
    return OBJECT_STR_RE.test(single) ? '' : single;
  }
  return '';
}

function coerceReleaseBulletList(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .map(coerceReleaseBulletText)
    .filter((item) => item.length > 2 && !OBJECT_STR_RE.test(item));
}

function formatSectionedReleaseBody(opts: {
  intro: string;
  newFeatures?: unknown[];
  fixes?: unknown[];
  improvements?: unknown[];
  requestedFeatures?: unknown[];
  securityUpdates?: unknown[];
  otherChanges?: unknown[];
  highlights?: unknown[];
  outro: string;
}) {
  const parts: string[] = [];
  const keepUserLine = (v: unknown) => {
    const clean = coerceReleaseBulletText(v);
    if (clean.length <= 2 || OBJECT_STR_RE.test(clean) || TECH_COMMIT_RE.test(clean) || CODE_TOKEN_RE.test(clean)) return '';
    return `• ${clean}`;
  };
  const introText = coerceReleaseBulletText(opts.intro);
  if (introText && !OBJECT_STR_RE.test(introText)) parts.push(introText);
  const pushSection = (heading: string, items: unknown[]) => {
    const list = items.map(keepUserLine).filter(Boolean);
    if (list.length) parts.push(`${heading}\n${list.join('\n')}`);
  };
  const nf = (opts.newFeatures || []).map(coerceReleaseBulletText).filter((v) => Boolean(keepUserLine(v)));
  const fx = (opts.fixes || []).map(coerceReleaseBulletText).filter((v) => Boolean(keepUserLine(v)));
  const im = (opts.improvements || []).map(coerceReleaseBulletText).filter((v) => Boolean(keepUserLine(v)));
  const su = (opts.securityUpdates || []).map(coerceReleaseBulletText).filter((v) => Boolean(keepUserLine(v)));
  const oc = (opts.otherChanges || []).map(coerceReleaseBulletText).filter((v) => Boolean(keepUserLine(v)));
  if (nf.length || fx.length || im.length || su.length || oc.length) {
    pushSection('New Features', nf);
    pushSection('Fixes', fx);
    pushSection('Improvements', im);
    pushSection('Security Updates', su);
    pushSection('Other Changes', oc);
  } else if (opts.highlights?.length) {
    const autoNf: string[] = [];
    const autoFx: string[] = [];
    const autoIm: string[] = [];
    const autoSu: string[] = [];
    for (const raw of opts.highlights) {
      const clean = coerceReleaseBulletText(raw);
      if (!clean || OBJECT_STR_RE.test(clean) || TECH_COMMIT_RE.test(clean) || CODE_TOKEN_RE.test(clean)) continue;
      if (/\b(?:security|vulnerabilit|rls|permission|auth(?:entication|orization)?|encrypt|csp|xss|csrf|hardening)\b/i.test(clean)) {
        autoSu.push(clean);
      } else if (/^(?:fix(?:ed|es)?|resolve[ds]?|prevent|restore|deduplicate|guard|block)\b|\b(?:error|constraint|foreign\s+key|bug)\b/i.test(clean)) {
        autoFx.push(clean);
      } else if (/^(?:improv|polish|clean|compact|sync|update|refactor|streamline|keep|align|refine|enhance|make\b.*\b(?:compact|clean|responsive|faster|clearer|visible))\b|\b(?:faster|cleaner|compact|reliable|visibility|clarity)\b/i.test(clean)) {
        autoIm.push(clean);
      } else {
        autoNf.push(clean);
      }
    }
    pushSection('New Features', autoNf);
    pushSection('Fixes', autoFx);
    pushSection('Improvements', autoIm);
    pushSection('Security Updates', autoSu);
  }
  if (opts.requestedFeatures?.length) {
    pushSection('Features Requested by Users:', opts.requestedFeatures);
  }
  const outroText = coerceReleaseBulletText(opts.outro);
  if (outroText && !OBJECT_STR_RE.test(outroText)) parts.push(outroText);
  return parts.filter(Boolean).join('\n\n');
}

function sanitizeReleaseDetails(rawDetails: string) {
  const text = String(rawDetails || '').trim();
  if (!text) return { text: '', bulletCount: 0, strippedCount: 0 };
  let bulletCount = 0;
  let strippedCount = 0;
  const cleanedBlocks = text.split(/\n{2,}/).map((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return '';
    const hasBullets = lines.some((line) => /^[•\-*]\s+/.test(line));
    if (!hasBullets) {
      return OBJECT_STR_RE.test(block) || TECH_COMMIT_RE.test(block) || CODE_TOKEN_RE.test(block) ? '' : block.trim();
    }
    const header = !/^[•\-*]\s+/.test(lines[0]) ? lines[0] : '';
    const bullets = (header ? lines.slice(1) : lines).filter((line) => {
      const clean = line.replace(/^[•\-*]\s+/, '').trim();
      if (!clean || OBJECT_STR_RE.test(clean) || TECH_COMMIT_RE.test(clean) || CODE_TOKEN_RE.test(clean)) {
        strippedCount += 1;
        return false;
      }
      bulletCount += 1;
      return true;
    });
    if (!bullets.length) return '';
    return header ? `${header}\n${bullets.join('\n')}` : bullets.join('\n');
  }).filter(Boolean);
  return { text: cleanedBlocks.join('\n\n'), bulletCount, strippedCount };
}

const GENERIC_RELEASE_TITLE_RE = /^(?:released|is\s+now\s+live|feature\s+update|milestone\s+update|official\s+rollout|introducing|what'?s\s+new|rollout|update|system\s+update|smarter\s+tracking\s*&\s*community\s+features|new\s+tools\s*&\s*community\s+requests|enhanced\s+experience\s+for\s+every\s+saver|elevating\s+your\s+daily\s+savings\s+journey|built\s+with\s+community\s+feedback|community\s*&\s*performance\s+rollout)!?$/i;

function formatReleaseVersionPrefix(version: string) {
  const clean = String(version || 'Update 1.0').replace(/^(?:myipon|system)\s+/i, '').trim() || 'Update 1.0';
  if (/^update\b/i.test(clean)) return `myIPON Update${clean.slice(6)}`;
  if (/^\d/.test(clean)) return `myIPON Update ${clean}`;
  return `myIPON ${clean}`;
}

function extractReleaseTopicLabels(items: string[] | string = []) {
  const seen = new Set<string>();
  const labels: string[] = [];
  const list = Array.isArray(items) ? items : String(items || '').split(/\r?\n/);
  for (const raw of list) {
    const line = String(raw || '').replace(/^[•\-*]\s*/, '').trim();
    if (!line || line.length < 4) continue;
    if (/^(?:New Features|Fixes|Improvements|Security Updates|Other Changes|Features Requested by Users:?|We are delighted\b|Say hello\b|A fresh update\b|Welcome to\b|Big news\b|Thank you\b|Your ideas\b|We could not\b|Special thanks\b)/i.test(line)) {
      continue;
    }
    if (TECH_COMMIT_RE.test(line) || CODE_TOKEN_RE.test(line)) continue;
    const head = line.includes(':') ? line.split(':')[0].trim() : line.replace(/\s*\(Requested by:[^)]*\)\s*/gi, '').trim();
    const shortHead = head.split(/\s+/).slice(0, 5).join(' ').replace(/[.,;:—–-]+$/, '').trim();
    if (!shortHead || shortHead.length < 3 || GENERIC_RELEASE_TITLE_RE.test(shortHead)) continue;
    const key = shortHead.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(shortHead);
    if (labels.length >= 4) break;
  }
  return labels;
}

function formatReleaseTitle(version: string, candidateTitle = '', contentItems: string[] | string = [], variant = 0) {
  const prefix = formatReleaseVersionPrefix(version);
  const v = Math.abs(Number(variant) || 0) % 3;
  const raw = String(candidateTitle || '').trim();
  let topic = raw
    .replace(/\b(?:myipon|system)\b/gi, ' ')
    .replace(/\bupdate\s*\d+(?:\.\d+)*(?:[a-z0-9.-]*)?/gi, ' ')
    .replace(/\bv?\d+\.\d+(?:\.\d+)*\b/gi, ' ')
    .replace(/\b(?:in|for|with|on|from)\s*$/i, '')
    .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!topic || topic.length < 4 || GENERIC_RELEASE_TITLE_RE.test(topic) || TECH_COMMIT_RE.test(topic) || CODE_TOKEN_RE.test(topic)) {
    const labels = extractReleaseTopicLabels(contentItems);
    if (labels.length >= 3) {
      topic = [
        `${labels[0]}, ${labels[1]} & ${labels[2]}`,
        `${labels[0]}, ${labels[1]} & More`,
        `Upgraded ${labels[0]} & ${labels[1]}`
      ][v];
    } else if (labels.length === 2) {
      topic = [
        `${labels[0]} & ${labels[1]}`,
        `${labels[0]} + ${labels[1]} Upgrades`,
        `Better ${labels[0]} & ${labels[1]}`
      ][v];
    } else if (labels.length === 1) {
      topic = [
        `${labels[0]} Highlights`,
        `New ${labels[0]} Upgrades`,
        `Smoother ${labels[0]} Experience`
      ][v];
    } else {
      topic = ['Community & Tracking Upgrades', 'Smoother Saving & Group Tools', 'Fresh Group & Tracking Polish'][v];
    }
  }
  const full = `${prefix}: ${topic}`;
  return full.length > 140 ? `${full.slice(0, 137).replace(/[\s,&+-]+$/, '')}...` : full;
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

async function activateUserAndMembership(
  admin: AdminClient,
  userId: string,
  fill: { first_name?: string | null; middle_name?: string | null; last_name?: string | null; full_name?: string | null; contact_number?: string | null; email?: string | null } = {}
) {
  if (!userId) return { profile: null, disabled: false };

  let { data: prof } = await admin
    .from('profiles')
    .select('id, status, group_id, role, member_id, first_name, middle_name, last_name, full_name, contact_number, email')
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
      await admin.from('profiles').insert({
        id: userId,
        email: String(authUser.email || fill.email || '').trim().toLowerCase(),
        first_name: first,
        middle_name: middle,
        last_name: last,
        full_name: full,
        contact_number: contact,
        role: 'MEMBER',
        status: 'ACTIVE'
      }).select('id').maybeSingle();
      const reloaded = await admin
        .from('profiles')
        .select('id, status, group_id, role, member_id, first_name, middle_name, last_name, full_name, contact_number, email')
        .eq('id', userId)
        .maybeSingle();
      prof = reloaded.data;
    }
  }

  if (!prof) return { profile: null, disabled: false };
  if (prof.status === 'DISABLED') return { profile: prof, disabled: true };

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

  const { data: updated } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .neq('status', 'DISABLED')
    .select('id, status, group_id, role, member_id, first_name, last_name, contact_number')
    .maybeSingle();

  return { profile: updated || prof, disabled: false };
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Account service is not configured.' }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: 'A valid JSON request body is required.' }, 400); }

  if (body.action === 'login-throttle-status') {
    const email = String(body.email || '').trim().toLowerCase();
    const clientIp = extractClientIp(request) || null;
    if ((!email || !email.includes('@')) && !clientIp) {
      return json({ ok: true, locked: false, retry_after_seconds: 0, threshold: 5 });
    }
    const { data: throttle, error: throttleError } = await admin.rpc('check_login_throttle', {
      p_email: email || '',
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
    const email = String(body.email || '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !email.includes('@') || email.length > 254 || !password || password.length > 1000) {
      return json({
        ok: false,
        locked: false,
        error: { code: 'invalid_credentials', message: 'Incorrect email or password.' }
      });
    }

    const clientIp = extractClientIp(request) || null;
    const { data: preThrottle } = await admin.rpc('check_login_throttle', {
      p_email: email,
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
        p_email: email,
        p_ip: clientIp
      });
      return json({
        ok: false,
        locked: Boolean(postThrottle?.locked),
        error: { code: 'invalid_credentials', message: 'Incorrect email or password.' },
        throttle: postThrottle || null
      });
    }

    if (!authData?.session?.access_token || !authData?.session?.refresh_token) {
      return json({
        ok: false,
        locked: false,
        error: { code: 'invalid_credentials', message: 'Incorrect email or password.' }
      });
    }

    await admin.rpc('clear_login_throttle', { p_email: email, p_ip: clientIp }).catch(() => null);
    return json({
      ok: true,
      locked: false,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token
      },
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
        message: 'Your account is already active. Please sign in with your credentials.'
      });
    }

    const expectedToken = authUser.user_metadata?.invite_token;
    if (!expectedToken || expectedToken !== token) {
      return json({ error: 'Invalid or expired invitation link. Please ask your administrator to send a new invite.' }, 400);
    }

    const updatePayload: Record<string, unknown> = {
      status: 'ACTIVE',
      role: targetRole
    };
    if (targetGroupId) updatePayload.group_id = targetGroupId;
    if (targetMemberId) updatePayload.member_id = targetMemberId;

    const { error: profileUpdateError } = await admin
      .from('profiles')
      .update(updatePayload)
      .eq('id', targetUserId);
    if (profileUpdateError) {
      return json({ error: 'Could not activate account. Please try again.' }, 500);
    }

    if (targetGroupId) {
      await admin
        .from('group_memberships')
        .update({ status: 'ACTIVE' })
        .eq('user_id', targetUserId)
        .eq('group_id', targetGroupId);
    } else {
      await admin
        .from('group_memberships')
        .update({ status: 'ACTIVE' })
        .eq('user_id', targetUserId);
    }

    const currentMeta = authUser.user_metadata || {};
    const { invite_token: _, ...cleanMeta } = currentMeta;
    await admin.auth.admin.updateUserById(targetUserId, {
      user_metadata: {
        ...cleanMeta,
        invite_accepted_at: new Date().toISOString()
      }
    });

    return json({
      success: true,
      group_name: groupName,
      message: 'Invitation accepted! Your account is now active.'
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

    const { profile, disabled } = await activateUserAndMembership(admin, userId, { email });
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

    if (!email || !email.includes('@')) return json({ error: 'A valid email address is required.' }, 400);
    if (!password || password.length < 8) return json({ error: 'A strong password of at least 8 characters is required.' }, 400);
    if (!first || !last) return json({ error: 'First name and last name are required.' }, 400);
    if (!contact) return json({ error: 'A contact number is required.' }, 400);
    if (!reason || reason.length < 10) return json({ error: 'A reason of at least 10 characters is required.' }, 400);

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
      email
    };
    const syncExistingAccount = async (targetId: string) => {
      const { profile: existingProf, disabled } = await activateUserAndMembership(admin, targetId, fillProfile);
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
          contact_number: contact
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
      await activateUserAndMembership(admin, userId, fillProfile);
    }

    return json({
      success: true,
      user_id: userId
    });
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

  async function ensureAnnouncementsBucket(client: ReturnType<typeof createClient>) {
    const { error } = await client.storage.createBucket(ANNOUNCEMENTS_BUCKET, { public: false, fileSizeLimit: 52428800 });
    if (error && !/already exists/i.test(error.message || '')) throw error;
  }

  async function ensureRecordCommentsBucket(client: ReturnType<typeof createClient>) {
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
      await ensureRecordCommentsBucket(admin);
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
        const path = `${actor.group_id}/${recordType}/${recordId}/${userResult.user.id}/${i}-${crypto.randomUUID().slice(0, 8)}-${cleanName}`;
        const { data, error } = await admin.storage.from(RECORD_COMMENTS_BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw error || new Error('Could not prepare file upload.');
        uploads.push({ path, token: data.token, name: rawName, kind, type: String(entry.type || '').slice(0, 120), size: Math.max(0, Math.round(rawSize)) });
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
    const paths = [...new Set(
      comments.flatMap((comment: { attachments?: unknown }) =>
        (Array.isArray(comment?.attachments) ? comment.attachments : [])
          .map((att: { path?: unknown }) => String(att?.path || ''))
          .filter((p: string) => p && !p.includes('..'))
      )
    )];
    if (!paths.length) return json({ urls: {} });
    const urls: Record<string, string> = {};
    for (let i = 0; i < paths.length; i += 100) {
      const slice = paths.slice(i, i + 100);
      const { data: signed, error: signError } = await admin.storage.from(RECORD_COMMENTS_BUCKET).createSignedUrls(slice, 3600);
      if (signError) return json({ error: signError.message || 'Unable to load attachment links.' }, 400);
      (signed || []).forEach((item: { path?: string | null; signedUrl?: string | null }) => {
        if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
      });
    }
    return json({ urls });
  }

  if (body.action === 'record-comment-cleanup-media') {
    const requested = Array.isArray(body.paths) ? body.paths.map((value) => String(value || '')).filter(Boolean) : [];
    const ownSegment = `/${userResult.user.id}/`;
    const allowedPaths = requested.filter((path) => !path.includes('..') && path.includes(ownSegment));
    if (!allowedPaths.length) return json({ removed: 0 });
    const { error: removeError } = await admin.storage.from(RECORD_COMMENTS_BUCKET).remove(allowedPaths);
    if (removeError) return json({ error: removeError.message || 'Unable to clean up uploaded files.' }, 400);
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
    const originUrl = typeof body.login_url === 'string' && /^https?:\/\//i.test(body.login_url)
      ? body.login_url
      : 'https://my-ipon.vercel.app/login.html';

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

  if (body.action === 'gemini-key-status') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can view Gemini AI configuration.' }, 403);
    const resolved = await resolveServerGeminiKey(admin);
    return json({
      configured: Boolean(resolved.key),
      source: resolved.source,
      masked: maskApiKey(resolved.key)
    });
  }

  if (body.action === 'save-gemini-key') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can configure the server Gemini API key.' }, 403);
    const nextKey = String(body.api_key || '').trim();
    if (!nextKey) {
      await admin.from('internal_webhook_config').delete().eq('key', GEMINI_CONFIG_KEY);
      const remaining = await resolveServerGeminiKey(admin);
      return json({
        success: true,
        cleared: true,
        configured: Boolean(remaining.key),
        source: remaining.source,
        masked: maskApiKey(remaining.key)
      });
    }
    try {
      const verify = await generateWithGemini({
        apiKey: nextKey,
        prompt: 'Return a JSON object: {"status": "ok"}',
        systemInstruction: 'Respond in JSON only.'
      });
      const { error: upsertErr } = await admin.from('internal_webhook_config').upsert({
        key: GEMINI_CONFIG_KEY,
        value: nextKey,
        updated_at: new Date().toISOString()
      });
      if (upsertErr) {
        return json({ error: upsertErr.message || 'Could not save Gemini API key on server.' }, 500);
      }
      return json({
        success: true,
        model: verify.model,
        configured: true,
        source: 'saved',
        masked: maskApiKey(nextKey)
      });
    } catch (verifyError: any) {
      return json({ error: verifyError?.message || 'Gemini key verification failed.' }, 400);
    }
  }

  if (body.action === 'test-gemini-key') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can test Gemini AI configuration.' }, 403);
    const resolved = await resolveServerGeminiKey(admin);
    const key = String(body.api_key || '').trim() || resolved.key;
    if (!key) return json({ error: 'Please enter a Gemini API key to test.' }, 400);
    try {
      const result = await generateWithGemini({
        apiKey: key,
        prompt: 'Return a JSON object: {"status": "ok", "message": "Gemini connection verified"}',
        systemInstruction: 'Respond in JSON only.'
      });
      return json({
        success: true,
        model: result.model,
        message: `Gemini API key verified on ${result.model}.`,
        result
      });
    } catch (testError: any) {
      return json({ error: testError?.message || 'Connection test failed.' }, 400);
    }
  }

  if (body.action === 'ai-generate-release-notes') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can generate release updates with AI.' }, 403);
    const version = String(body.version || 'Update 1.0').trim();
    const releaseDate = String(body.release_date || new Date().toISOString().slice(0, 10)).trim();
    let rawFeatures = Array.isArray(body.features) ? body.features : null;
    if (!rawFeatures) {
      const { data: implRows } = await admin
        .from('feature_requests')
        .select('title,details,requester_id')
        .eq('status', 'IMPLEMENTED')
        .is('release_version', null)
        .order('reviewed_at', { ascending: false })
        .limit(50);
      rawFeatures = implRows || [];
    }
    const features = rawFeatures.map((f: any) => ({
      title: String(f.title || '').trim(),
      description: String(f.details || f.description || '').trim(),
      requester_name: f.requester_name ? String(f.requester_name).trim() : null
    })).filter((f) => Boolean(f.title));
    const previousReleases = (Array.isArray(body.previous_releases) ? body.previous_releases : [])
      .map((item: any) => String(item || '').trim())
      .filter(Boolean);
    const previousTitle = String(body.previous_title || '').trim();
    const currentDraft = sanitizeReleaseDetails(String(body.current_draft || '').trim()).text;
    const styleAngle = String(body.style_angle || 'Clear, warm, user-benefit focused release notes').trim();
    const variationSeed = Number.isFinite(Number(body.variation_seed)) ? Number(body.variation_seed) : Math.floor(Math.random() * 12);
    let systemUpdates = canonicalizeCommitUpdates(
      Array.isArray(body.system_updates) ? body.system_updates.map((item: any) => String(item || '')) : []
    );

    if (!Array.isArray(body.system_updates)) {
      const { data: latestRel } = await admin
        .from('announcements')
        .select('created_at')
        .not('release_version', 'is', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      systemUpdates = await fetchRecentSystemUpdates(latestRel?.[0]?.created_at || null);
    }

    if (!features.length && !systemUpdates.length) {
      return json({
        success: true,
        no_new_changes: true,
        ai_powered: false,
        provider: 'none',
        message: 'No new system changes or implemented feature requests detected since the latest release.'
      });
    }

    const { key: geminiKey } = await resolveServerGeminiKey(admin);
    if (!geminiKey) {
      return json({
        error: 'Gemini AI is not configured on the server yet. Click Configure API key to save a Google AI Studio key on the server.'
      }, 502);
    }

    const featureListText = features.length
      ? features.map((f) => `- "${f.title}": ${f.description || 'User-requested enhancement'}${f.requester_name ? ` (Requested by: ${f.requester_name})` : ''}`).join('\n')
      : '- None in this release.';
    const updatesListText = systemUpdates.length
      ? systemUpdates.map((u, idx) => `${idx + 1}. ${u}`).join('\n')
      : '- None in this release.';
    const prevListText = previousReleases.length
      ? previousReleases.map((p) => `- ${p}`).join('\n')
      : '- None (initial release).';

    const prompt = `Write official, professionally crafted, human-sounding software release notes for myIPON (Group Savings and Financial Tracker). The product name is strictly "myIPON".
Version: ${version}
Release Date: ${releaseDate}
Voice & Editorial Angle: ${styleAngle}
Freshness Pass: #${variationSeed + 1}

Already shipped in earlier releases (DO NOT repeat these as new updates):
${prevListText}

Verified user-requested features implemented for ${version}:
${featureListText}

Verified system updates landed since the previous release (${systemUpdates.length} distinct items — analyze EVERY user-facing item 1-to-1 without skipping or merging unrelated items):
${updatesListText}
${previousTitle ? `\nPrevious title in editor (craft a distinct, fresh headline keeping "${formatReleaseVersionPrefix(version)}:" at the front):\n${previousTitle}` : ''}
${currentDraft ? `\nPrevious draft in editor (generate completely fresh phrasing, intro, bullet openings, and outro—NEVER recycle wording verbatim from it):\n${currentDraft}` : ''}

Categorization Rules (omit empty categories by returning [] for unused arrays):
- "new_features": Newly added user-facing capabilities or pages.
- "fixes": Resolved bugs, workflow errors, validation/sync glitches, or broken states.
- "improvements": Enhancements to existing screens, layout stability, responsiveness, speed, clarity, or usability.
- "requested_features": Features explicitly built from the implemented user requests above (preserve "(Requested by: Name)" when credited).
- "security_updates": Access control, account protection, privacy, authentication, or security-hardening improvements (leave [] if none apply).
- "other_changes": Relevant user-facing updates that do not cleanly fit the categories above (leave [] unless genuinely needed).

Writing & Accuracy Standards:
- Every bullet MUST follow "Descriptive Feature or Change Name: Detailed explanation".
- Each explanation MUST clearly cover: (1) what was added, fixed, or improved, (2) how it works / where users find it, (3) what users can expect, and (4) the practical benefit in daily use.
- Never write vague filler such as "Improved system performance" or repeat generic endings across bullets.
- Never invent or embellish unverified changes. If an item is purely internal developer plumbing (tests, build scripts, raw schema/migration filenames, Edge Function plumbing, CLI scripts, git tooling), exclude it instead of rewriting code jargon.
- Keep the tone friendly, polished, clear, natural English with consistent myIPON terminology.
- The "title" MUST begin strictly with "${formatReleaseVersionPrefix(version)}:" followed by a specific 3-7 word headline summarizing this release's most meaningful additions and fixes.

Output strictly valid JSON with this exact schema (EVERY entry inside each string array MUST be a plain JSON string, NEVER a nested object):
{
  "title": "${formatReleaseVersionPrefix(version)}: Concise 3-7 word headline",
  "intro": "1-2 short, natural paragraphs introducing ${version} with fresh wording tailored specifically to the changes in this update.",
  "new_features": ["Feature Name: Detailed user-focused explanation covering what changed, how it works, what users can expect, and practical impact."],
  "fixes": ["Fix Name: Detailed explanation of the resolved issue, how workflows now behave, and the reliability impact for users."],
  "improvements": ["Improvement Name: Detailed explanation of what was enhanced, how it behaves now, and how it improves everyday use."],
  "requested_features": ["Requested Feature Name: Detailed explanation of the shipped feature and its impact (Requested by: Name if credited)."],
  "security_updates": [],
  "other_changes": [],
  "outro": "1 concise, natural closing paragraph thanking myIPON savers for feedback and inviting continued suggestions."
}`;

    try {
      const { parsed: aiResult, model: aiModel } = await generateWithGemini({
        apiKey: geminiKey,
        prompt,
        systemInstruction: 'You are the head of product communications for myIPON, a group savings platform. Write authentic, richly detailed, human-sounding software release notes based strictly on the verified updates provided. Never invent changes, never use static boilerplate, never leak internal filenames/DB/CLI jargon. Output strictly valid JSON with flat string arrays (never nested item objects).'
      });

      const nf = coerceReleaseBulletList(aiResult.new_features);
      const fx = coerceReleaseBulletList(aiResult.fixes);
      const im = coerceReleaseBulletList(aiResult.improvements);
      const rf = coerceReleaseBulletList(aiResult.requested_features);
      const su = coerceReleaseBulletList(aiResult.security_updates);
      const oc = coerceReleaseBulletList(aiResult.other_changes);
      const hl = coerceReleaseBulletList(aiResult.highlights);

      const missingItems = findMissingReleaseItems({
        newFeatures: nf,
        fixes: fx,
        improvements: im,
        requestedFeatures: rf,
        securityUpdates: su,
        otherChanges: oc
      }, systemUpdates);

      if (missingItems.length > 0 && missingItems.length <= 40) {
        try {
          const pass2Prompt = `The following verified user-facing system changes for myIPON ${version} were missed in the initial changelog draft. Analyze each item and classify any genuine user-facing update into its proper category, writing detailed 1-2 sentence descriptions explaining what changed, how it works, what users can expect, and its practical impact. Omit any item that is purely internal code/testing/build maintenance. Use fresh, non-repetitive phrasing.

Missed changes (${missingItems.length}):
${missingItems.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}

Output strictly valid JSON with only these flat arrays of plain strings (no nested objects):
{
  "new_features": [],
  "fixes": [],
  "improvements": [],
  "requested_features": [],
  "security_updates": [],
  "other_changes": []
}`;
          const { parsed: pass2 } = await generateWithGemini({
            apiKey: geminiKey,
            prompt: pass2Prompt,
            systemInstruction: 'You write accurate, detailed, human-sounding release notes for myIPON strictly from provided changes. Output strictly valid JSON with plain string arrays.'
          });
          nf.push(...coerceReleaseBulletList(pass2.new_features));
          fx.push(...coerceReleaseBulletList(pass2.fixes));
          im.push(...coerceReleaseBulletList(pass2.improvements));
          rf.push(...coerceReleaseBulletList(pass2.requested_features));
          su.push(...coerceReleaseBulletList(pass2.security_updates));
          oc.push(...coerceReleaseBulletList(pass2.other_changes));
        } catch (pass2Error: any) {
          console.warn('Gemini completeness second pass skipped:', String(pass2Error?.message || pass2Error));
        }
      }

      const rawDetails = formatSectionedReleaseBody({
        intro: coerceReleaseBulletText(aiResult.intro),
        newFeatures: nf,
        fixes: fx,
        improvements: im,
        requestedFeatures: rf,
        securityUpdates: su,
        otherChanges: oc,
        highlights: hl,
        outro: coerceReleaseBulletText(aiResult.outro)
      });
      const sanitized = sanitizeReleaseDetails(rawDetails);
      if (sanitized.bulletCount > 0) {
        let title = formatReleaseTitle(
          version,
          String(aiResult.title || ''),
          [...rf, ...nf, ...fx, ...im, ...su, ...oc, ...hl, sanitized.text],
          variationSeed
        );
        if (previousTitle && title === previousTitle) {
          title = formatReleaseTitle(
            version,
            '',
            [...rf, ...nf, ...fx, ...im, ...su, ...oc, ...hl, sanitized.text],
            variationSeed + 1
          );
        }
        return json({
          success: true,
          ai_powered: true,
          provider: 'gemini',
          model: aiModel,
          title,
          details: sanitized.text
        });
      }
      return json({
        error: 'Gemini returned no valid user-facing release notes after filtering internal/technical entries. Please try again.'
      }, 502);
    } catch (geminiError: any) {
      const msg = String(geminiError?.message || 'Gemini AI request failed');
      console.warn('Gemini AI release-notes error:', msg);
      return json({ error: `Gemini AI failed to generate release notes: ${msg}` }, 502);
    }
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
    const originUrl = typeof body.login_url === 'string' && /^https?:\/\//i.test(body.login_url)
      ? body.login_url
      : 'https://my-ipon.vercel.app/login.html';

    if (existingProfile && actor.group_id) {
      await admin.from('notifications').insert({
        recipient_id: targetUserId,
        group_id: actor.group_id,
        type: 'GROUP_INVITE',
        title: `Invitation: ${groupName}`,
        message: `${inviterName} invited you to join "${groupName}" as a ${role.toLowerCase()}.`,
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
