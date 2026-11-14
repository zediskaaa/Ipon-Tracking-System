import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-webhook-secret'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function buildPushTopic(rawKey: string | null | undefined): Promise<string | undefined> {
  const value = String(rawKey || '').trim();
  if (!value) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest).slice(0, 18);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@myipon.app';

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase server configuration.' }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON request body.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const providedSecret = req.headers.get('x-push-webhook-secret') || '';
  const isInternalWebhook = Boolean(webhookSecret && timingSafeEqual(providedSecret, webhookSecret));

  let recipientId = '';
  let notifId: number | string | null = null;
  let title = 'myIPON';
  let message = '';
  let link = 'dashboard.html';
  let dedupeKey: string | null = null;
  let createdAt = new Date().toISOString();
  let isTest = false;

  if (isInternalWebhook) {
    const rawId = Number(body.notification_id);
    if (!Number.isFinite(rawId) || rawId <= 0) {
      return json({ error: 'Valid notification_id is required.' }, 400);
    }
    const { data: notif, error: notifErr } = await admin
      .from('notifications')
      .select('id, recipient_id, type, title, message, link, dedupe_key, read_at, created_at')
      .eq('id', rawId)
      .maybeSingle();

    if (notifErr) return json({ error: notifErr.message }, 500);
    if (!notif || notif.read_at) {
      return json({ ok: true, skipped: true, reason: 'missing_or_read' });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('id, status, notifications_enabled')
      .eq('id', notif.recipient_id)
      .maybeSingle();

    if (!profile || profile.status !== 'ACTIVE' || profile.notifications_enabled === false) {
      return json({ ok: true, skipped: true, reason: 'notifications_disabled' });
    }

    notifId = notif.id;
    recipientId = String(notif.recipient_id);
    title = String(notif.title || 'myIPON');
    message = String(notif.message || 'You have a new notification.');
    link = String(notif.link || 'dashboard.html');
    dedupeKey = notif.dedupe_key ? String(notif.dedupe_key) : null;
    createdAt = String(notif.created_at || createdAt);
  } else {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt || body.action !== 'test') {
      return json({ error: 'Unauthorized.' }, 401);
    }

    const { data: authData, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !authData?.user) {
      return json({ error: 'Authentication required.' }, 401);
    }

    const delayMs = Math.min(Math.max(Number(body.delay_ms) || 0, 0), 5000);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    isTest = true;
    notifId = `test-${Date.now()}`;
    recipientId = authData.user.id;
    title = 'myIPON background alerts ready';
    message = 'Notifications arrive on this device even when myIPON is closed.';
    link = 'account.html';
    dedupeKey = 'MYIPON_TEST_ALERT';
  }

  let webSent = 0;
  let webFailed = 0;
  let webTotal = 0;

  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', recipientId);

    const list = Array.isArray(subs) ? subs : [];
    webTotal = list.length;

    if (list.length > 0) {
      const trayKey = dedupeKey || String(notifId);
      const tag = `myipon-${trayKey}`;
      const topic = await buildPushTopic(dedupeKey);
      const payload = JSON.stringify({
        id: notifId,
        title,
        body: message,
        message,
        link,
        url: link,
        dedupe_key: dedupeKey,
        tag,
        renotify: Boolean(dedupeKey),
        timestamp: Date.parse(createdAt) || Date.now()
      });

      const expiredIds: string[] = [];
      const succeededIds: string[] = [];

      await Promise.allSettled(
        list.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
              },
              payload,
              {
                TTL: 86400,
                urgency: 'high',
                ...(topic ? { topic } : {})
              }
            );
            webSent += 1;
            succeededIds.push(sub.id);
          } catch (err: unknown) {
            webFailed += 1;
            const statusCode = Number((err as { statusCode?: number })?.statusCode || 0);
            if (statusCode === 404 || statusCode === 410) {
              expiredIds.push(sub.id);
            }
          }
        })
      );

      if (expiredIds.length > 0) {
        await admin.from('push_subscriptions').delete().in('id', expiredIds);
      }
      if (succeededIds.length > 0) {
        await admin
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString() })
          .in('id', succeededIds);
      }
    }
  }

  let nativePingSent = false;
  try {
    const { data: feedRow } = await admin
      .from('notification_feed_tokens')
      .select('token')
      .eq('user_id', recipientId)
      .maybeSingle();

    if (feedRow?.token) {
      const broadcastRes = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          messages: [
            {
              topic: `notif-wake:${feedRow.token}`,
              event: 'wake',
              payload: isTest
                ? { ts: Date.now(), test: true, title, message, link }
                : { ts: Date.now(), notification_id: notifId }
            }
          ]
        })
      });
      nativePingSent = broadcastRes.ok;
    }
  } catch {
    nativePingSent = false;
  }

  return json({
    ok: true,
    web_total: webTotal,
    web_sent: webSent,
    web_failed: webFailed,
    native_ping_sent: nativePingSent
  });
});

