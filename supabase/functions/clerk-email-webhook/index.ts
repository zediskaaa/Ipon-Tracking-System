import { Webhook } from 'npm:svix@1.76.1';

const SYSTEM_NAME = 'myIPON';
const EMAIL_LOGO_URL = 'https://my-ipon.vercel.app/assets/icon-192.png?v=2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function emailHtml(code: string) {
  return `
    <div style="font-family:Arial,sans-serif;color:#163029;line-height:1.55;max-width:540px;margin:0 auto;padding:24px;background:#fbf9f2;border:1px solid #d9d6c8;border-radius:14px">
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
        <tr>
          <td style="vertical-align:middle;padding-right:10px">
            <img src="${EMAIL_LOGO_URL}" alt="myIPON" width="34" height="34" style="display:block;width:34px;height:34px;border-radius:8px;border:0" />
          </td>
          <td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;font-weight:800;letter-spacing:.01em;color:#163029">
            ${SYSTEM_NAME}
          </td>
        </tr>
      </table>
      <h2 style="margin:0 0 12px;color:#163029">Your sign-in verification code</h2>
      <p style="margin:0 0 14px">Use this code to continue signing in:</p>
      <div style="margin:0 0 18px;padding:16px 20px;background:#fff;border:1px solid #c9c5b5;border-radius:12px;text-align:center">
        <span style="font-family:Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:.35em;color:#163029">${escapeHtml(code)}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#5c5749">This code expires in 10 minutes. If you did not try to sign in, you can safely ignore this email.</p>
    </div>
  `.trim();
}

function parseSender(raw: string) {
  const value = raw.trim();
  const match = value.match(/^(.*?)<([^<>]+)>$/);
  if (match) {
    const parsedName = match[1].trim().replace(/^["']|["']$/g, '');
    const normalizedName = !parsedName || /^IPON(?:\s+Group\s+Savings\s+Tracker)?$/i.test(parsedName)
      ? SYSTEM_NAME
      : parsedName;
    return { name: normalizedName, email: match[2].trim() };
  }
  return { name: SYSTEM_NAME, email: value };
}

function plainText(code: string) {
  return `${SYSTEM_NAME}\n\nYour sign-in verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not try to sign in, you can safely ignore this email.`;
}

async function sendWithBrevo({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  const apiKey = String(Deno.env.get('BREVO_API_KEY') || '').trim();
  const rawSender = String(Deno.env.get('INVITE_FROM_EMAIL') || Deno.env.get('BREVO_SENDER_EMAIL') || '').trim();
  if (!apiKey || !rawSender) throw new Error('Brevo email delivery is not configured.');
  const sender = parseSender(rawSender);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender,
      replyTo: sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    })
  });
  if (!response.ok) throw new Error(`Brevo returned status ${response.status}.`);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const secret = String(Deno.env.get('CLERK_WEBHOOK_SIGNING_SECRET') || '').trim();
  if (!secret) return json({ error: 'Webhook signing secret is not configured.' }, 500);

  const rawBody = await request.text();
  let event: { type?: string; data?: Record<string, unknown> };
  try {
    const webhook = new Webhook(secret);
    event = webhook.verify(rawBody, {
      'svix-id': request.headers.get('svix-id') || '',
      'svix-timestamp': request.headers.get('svix-timestamp') || '',
      'svix-signature': request.headers.get('svix-signature') || ''
    }) as typeof event;
  } catch {
    return json({ error: 'Invalid webhook signature.' }, 400);
  }

  if (event.type !== 'email.created') return json({ ok: true, ignored: true });
  const data = event.data || {};
  const messageData = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {};
  const otpCode = String(messageData.otp_code || '').trim();
  const recipient = String(data.to_email_address || '').trim().toLowerCase();
  if (!otpCode || !/^\d{6}$/.test(otpCode) || !/^\S+@\S+\.\S+$/.test(recipient)) {
    return json({ ok: true, ignored: true, reason: 'Not an OTP email event.' });
  }

  const subject = String(data.subject || 'Your myIPON sign-in verification code').trim();
  await sendWithBrevo({ to: recipient, subject, html: emailHtml(otpCode), text: plainText(otpCode) });
  return json({ ok: true, delivered_by: 'brevo' });
});
