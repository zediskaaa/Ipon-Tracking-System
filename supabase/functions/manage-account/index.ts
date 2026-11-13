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
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6d6552;">${escapeHtml(SYSTEM_NAME)}</p>
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
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6d6552;">${escapeHtml(SYSTEM_NAME)}</p>
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
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #1f6a43;">${escapeHtml(SYSTEM_NAME)}</p>
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

async function generateWithGemini({
  apiKey,
  prompt,
  systemInstruction
}: {
  apiKey: string;
  prompt: string;
  systemInstruction?: string;
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json'
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text generated by Gemini.');
  return JSON.parse(text);
}

function generateProceduralReleaseNotes(
  version: string,
  features: Array<{ title: string; description: string; requester_name?: string | null }>
) {
  const titles = [
    `System ${version} Released: Smarter Tracking & Community Features`,
    `System ${version} is Live: New Tools & Community Requests`,
    `What's New in System ${version}: Enhanced Experience for Every Saver`,
    `Introducing System ${version}: Elevating Your Daily Savings Journey`,
    `System ${version} Feature Drop: Built with Community Feedback`
  ];
  const intros = [
    `We are delighted to bring you System ${version}! This release delivers key enhancements shaped directly by our savers' everyday needs, making group tracking smoother and more engaging than ever.`,
    `Say hello to System ${version}! Packed with user-inspired updates, performance tweaks, and exciting new tools designed to keep your savings goals on track.`,
    `A fresh update has landed! In System ${version}, we focused on elevating transparency, personal controls, and intuitive interactions across the entire platform.`,
    `Welcome to System ${version}! Thank you for your continuous enthusiasm—this milestone incorporates your top feature requests and quality-of-life polishes.`,
    `Big news for all savers: System ${version} is now officially live! Here is everything you need to know about the newest capabilities now available across IPON.`
  ];
  const outros = [
    `Thank you for contributing, testing, and helping us make IPON better with every update. Happy saving!`,
    `Your ideas drive IPON forward! Keep submitting your feedback and suggestions—more improvements are already on the horizon.`,
    `We could not build this without our incredible community. Here is to simpler, smarter group savings together!`,
    `Special thanks to everyone who reported ideas and suggestions. Enjoy exploring the new update!`
  ];

  const title = titles[Math.floor(Math.random() * titles.length)];
  const intro = intros[Math.floor(Math.random() * intros.length)];
  const outro = outros[Math.floor(Math.random() * outros.length)];

  let body = `${intro}\n\n`;
  body += `• Live Active Now Presence: See who is online in real time with live green activity indicators on profile avatars.\n`;
  body += `• Profile Picture Editor: Crop, rotate 90 degrees, and preview your avatar before saving.\n`;
  body += `• Announcement Reactions: Messenger-style reaction picker (Like, Love, Haha, Wow, Sad, Angry) and who-reacted summary dialog.\n`;
  body += `• Quick Record Entry: Convenient dashboard shortcut to log additions, deductions, and expenses on the fly.\n`;
  body += `• Records Spotlight & Chart: Filter financial records by member with dedicated personal graphs and totals.\n`;
  body += `• Monthly Contribution Pledge: Group administrators can manage their monthly contribution pledge directly.\n`;

  if (features.length > 0) {
    body += `\nCommunity Feature Requests Implemented in this Release:\n`;
    features.forEach((req) => {
      const credit = req.requester_name ? ` (Suggested by: ${req.requester_name})` : '';
      body += `• ${req.title}: ${req.description || 'Feature enhancement'}${credit}\n`;
    });
  }

  body += `\n${outro}`;
  return { title, details: body };
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

  if (body.action === 'accept-email-invite') {
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '').trim();
    if (!email || !email.includes('@')) return json({ error: 'A valid email address is required.' }, 400);
    if (!token) return json({ error: 'An invitation token is required.' }, 400);

    const { data: profile } = await admin
      .from('profiles')
      .select('id, status, role, group_id, member_id')
      .eq('email', email)
      .maybeSingle();

    let targetUserId = profile?.id;
    let authUser = null;

    if (targetUserId) {
      const { data: userRes } = await admin.auth.admin.getUserById(targetUserId).catch(() => ({ data: null }));
      authUser = userRes?.user;
    }

    if (!authUser) {
      const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 100 }).catch(() => ({ data: null }));
      authUser = usersData?.users?.find((u) => u.email?.toLowerCase() === email) || null;
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
    const userId = String(body.user_id || '').trim();
    if (userId) {
      const { data: prof } = await admin.from('profiles').select('group_id, role, member_id').eq('id', userId).maybeSingle();
      if (prof && !prof.group_id) {
        const { data: mem } = await admin.from('group_memberships').select('group_id, role, member_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (mem?.group_id) {
          await admin.from('profiles').update({
            status: 'ACTIVE',
            group_id: mem.group_id,
            role: mem.role || prof.role || 'MEMBER',
            member_id: mem.member_id || prof.member_id
          }).eq('id', userId);
        } else {
          await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', userId).neq('status', 'DISABLED');
        }
      } else {
        await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', userId).neq('status', 'DISABLED');
      }
    }
    if (email) {
      await admin.from('profiles').update({ status: 'ACTIVE' }).eq('email', email).neq('status', 'DISABLED');
    }
    await admin.from('profiles').update({ status: 'ACTIVE' }).eq('status', 'PENDING');
    return json({ success: true, activated: true });
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

    const { data: existingUser } = await admin
      .from('profiles')
      .select('id, status')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      if (existingUser.status !== 'DISABLED') {
        await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', existingUser.id);
        await admin.auth.admin.updateUserById(existingUser.id, { password, email_confirm: true });
        return json({
          success: true,
          user_id: existingUser.id
        });
      }
      return json({ error: 'This account is disabled. Please contact support.' }, 400);
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
        const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 100 }).catch(() => ({ data: null }));
        const matched = usersData?.users?.find((u) => u.email?.toLowerCase() === email);
        if (matched) {
          await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', matched.id);
          await admin.auth.admin.updateUserById(matched.id, { password, email_confirm: true });
          return json({ success: true, user_id: matched.id });
        }
        return json({ error: 'An account with this email already exists.' }, 400);
      }
      return json({ error: createError.message }, 400);
    }

    const userId = newUserData.user?.id;
    if (userId) {
      await admin
        .from('profiles')
        .update({ status: 'ACTIVE', role: 'MEMBER' })
        .eq('id', userId);
    }

    await admin.from('profiles').update({ status: 'ACTIVE' }).eq('status', 'PENDING');

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

  if (body.action === 'test-gemini-key') {
    const key = String(body.api_key || '').trim() || Deno.env.get('GEMINI_API_KEY')?.trim();
    if (!key) return json({ error: 'Please enter a Gemini API key to test.' }, 400);
    try {
      const result = await generateWithGemini({
        apiKey: key,
        prompt: 'Return a JSON object: {"status": "ok", "message": "Gemini connection verified"}',
        systemInstruction: 'Respond in JSON only.'
      });
      return json({ success: true, message: 'Gemini API key is valid and working!', result });
    } catch (testError: any) {
      return json({ error: `Connection test failed: ${testError?.message || 'Invalid key'}` }, 400);
    }
  }

  if (body.action === 'ai-generate-release-notes') {
    if (actor.role !== 'SUPER_ADMIN') return json({ error: 'Only the Super Admin can generate release updates with AI.' }, 403);
    const version = String(body.version || 'Update 1.0').trim();
    const releaseDate = String(body.release_date || new Date().toISOString().slice(0, 10)).trim();
    const rawFeatures = Array.isArray(body.features) ? body.features : [];
    const features = rawFeatures.map((f: any) => ({
      title: String(f.title || '').trim(),
      description: String(f.details || f.description || '').trim(),
      requester_name: f.requester_name ? String(f.requester_name).trim() : null
    })).filter((f) => Boolean(f.title));

    const geminiKey = String(body.api_key || '').trim() || Deno.env.get('GEMINI_API_KEY')?.trim();

    if (geminiKey) {
      try {
        const featureListText = features.length
          ? features.map((f) => `- "${f.title}": ${f.description || 'System enhancement'}${f.requester_name ? ` (Requested by: ${f.requester_name})` : ''}`).join('\n')
          : '- General performance improvements, UI refinements, and stability enhancements across IPON.';

        const prompt = `Write an official, engaging, and celebratory product release announcement for myIPON (Group Savings and Financial Tracker). The system name is strictly "myIPON".
Version: ${version}
Release Date: ${releaseDate}

Implemented User-Requested Features and Enhancements:
${featureListText}

System-wide improvements included in this release:
- Real-time online presence indicators (active now green dot on profile avatars)
- Interactive profile picture cropper, 90-degree rotation, and avatar controls
- Announcement reactions (Messenger-style emoji picker: Like, Love, Haha, Wow, Sad, Angry) with who-reacted modal
- Quick financial record entry modal on the calendar dashboard
- Financial records member spotlight card with personal contribution graph and totals
- Group administrator monthly pledge synchronization across member rosters and reports

Please generate a JSON object with this exact structure:
{
  "title": "A punchy, attractive announcement title mentioning myIPON ${version}",
  "intro": "A 1-2 paragraph fresh, engaging, non-cliché introduction celebrating this milestone for myIPON and explaining its value to users",
  "highlights": [
    "A concise bullet point describing the first major feature with user credit if applicable",
    "A concise bullet point describing the second feature",
    "A concise bullet point describing the third feature",
    "Additional bullet points for the remaining features"
  ],
  "outro": "A warm, inspiring 1-paragraph closing message thanking myIPON savers for their continuous feedback and encouraging them to keep reaching their financial goals"
}`;

        const aiResult = await generateWithGemini({
          apiKey: geminiKey,
          prompt,
          systemInstruction: 'You are the head of product communications for myIPON, a modern group savings platform in the Philippines. The official name is strictly "myIPON". Write polished, engaging, inspiring release copy in English. Output strictly valid JSON.'
        });

        const title = String(aiResult.title || `System ${version} Released`).trim();
        const intro = String(aiResult.intro || `We are excited to roll out System ${version}!`).trim();
        const highlights = Array.isArray(aiResult.highlights) ? aiResult.highlights.map((h: string) => `• ${String(h).trim()}`).join('\n') : '';
        const outro = String(aiResult.outro || 'Thank you for being part of IPON. Happy saving!').trim();

        const details = `${intro}\n\n${highlights}\n\n${outro}`;
        return json({
          success: true,
          ai_powered: true,
          provider: 'gemini',
          title,
          details
        });
      } catch (geminiError: any) {
        console.warn('Gemini API call failed, falling back to smart composer:', geminiError?.message);
      }
    }

    const fallback = generateProceduralReleaseNotes(version, features);
    return json({
      success: true,
      ai_powered: false,
      provider: 'smart-composer',
      note: 'Drafted using local smart composer. Set GEMINI_API_KEY in Supabase secrets or enter your Gemini API key to enable Gemini AI.',
      title: fallback.title,
      details: fallback.details
    });
  }

  if (body.action === 'ai-savings-insights') {
    const goalName = String(body.goal_name || 'General Savings').trim();
    const targetAmount = Number(body.target_amount) || 0;
    const currentSaved = Number(body.current_saved) || 0;
    const monthlyPledge = Number(body.monthly_pledge) || 0;
    const targetDate = String(body.target_date || '').trim();
    const remaining = Math.max(0, targetAmount - currentSaved);
    const progressPct = targetAmount > 0 ? Math.min(100, Math.round((currentSaved / targetAmount) * 100)) : 0;

    const geminiKey = String(body.api_key || '').trim() || Deno.env.get('GEMINI_API_KEY')?.trim();

    if (geminiKey) {
      try {
        const prompt = `Analyze this user's group savings progress in IPON:
- Goal: "${goalName}"
- Target Amount: ₱${targetAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
- Current Balance Saved: ₱${currentSaved.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${progressPct}% completed)
- Remaining Needed: ₱${remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}
- Monthly Contribution Pledge: ₱${monthlyPledge.toLocaleString('en-US', { minimumFractionDigits: 2 })}
${targetDate ? `- Target Completion Date: ${targetDate}` : ''}

Generate 3 personalized, realistic financial tips in English in JSON format:
{
  "forecast": "1-2 sentences calculating their timeline, pace, and projected completion date based on their monthly pledge",
  "smart_tip": "1-2 sentences giving an actionable, micro-saving habit or strategy to accelerate reaching this goal",
  "motivation": "1 sentence celebrating their discipline and encouraging their savings habit"
}`;

        const aiResult = await generateWithGemini({
          apiKey: geminiKey,
          prompt,
          systemInstruction: 'You are an intelligent, friendly, and practical financial coach for the IPON savings app. Provide encouraging, mathematically sound financial insights in English. Output strictly valid JSON.'
        });

        return json({
          success: true,
          ai_powered: true,
          provider: 'gemini',
          goal_name: goalName,
          progress_pct: progressPct,
          forecast: String(aiResult.forecast || '').trim(),
          smart_tip: String(aiResult.smart_tip || '').trim(),
          motivation: String(aiResult.motivation || '').trim()
        });
      } catch (geminiError: any) {
        console.warn('Gemini savings insights failed, falling back to rule engine:', geminiError?.message);
      }
    }

    const monthsNeeded = monthlyPledge > 0 ? Math.ceil(remaining / monthlyPledge) : 0;
    const forecast = monthlyPledge > 0
      ? `At your current monthly pledge of ₱${monthlyPledge.toLocaleString('en-US', { minimumFractionDigits: 2 })}, you are on track to achieve your goal in approximately ${monthsNeeded} month${monthsNeeded === 1 ? '' : 's'}.`
      : `Set a monthly contribution pledge to calculate your exact projected completion date.`;
    const smartTip = remaining > 0
      ? `Contributing just ₱${Math.max(100, Math.round(remaining / 52)).toLocaleString('en-US')} extra each week can shave months off your timeline.`
      : `Congratulations on reaching 100% of your target! Consider starting an emergency buffer or a new long-term milestone.`;
    const motivation = progressPct >= 100
      ? `You have achieved your target! Your consistency is truly commendable.`
      : progressPct >= 50
        ? `You have passed the halfway mark (${progressPct}%)! Momentum is on your side—keep going strong.`
        : `Every deposit counts toward your future financial security. Consistency beats intensity every time!`;

    return json({
      success: true,
      ai_powered: false,
      provider: 'smart-engine',
      goal_name: goalName,
      progress_pct: progressPct,
      forecast,
      smart_tip: smartTip,
      motivation
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
        invite_token: inviteToken
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
      await admin.from('profiles').update({ status: 'PENDING' }).eq('id', targetUserId);
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
