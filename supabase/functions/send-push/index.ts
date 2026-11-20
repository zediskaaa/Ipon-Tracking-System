import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import webpush from 'npm:web-push@3.6.7';
import { importPKCS8, SignJWT } from 'npm:jose@5.10.0';

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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
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
  let notifGroupId: string | null = null;
  let notifType = '';
  let actorAvatarUrl: string | null = null;
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
      .select('id, recipient_id, group_id, type, title, message, link, dedupe_key, actor_id, actor_avatar_url, read_at, created_at')
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
    notifGroupId = notif.group_id ? String(notif.group_id) : null;
    notifType = String(notif.type || '');
    recipientId = String(notif.recipient_id);
    title = String(notif.title || 'myIPON');
    if (['SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST'].includes(notifType)) {
      title = title.replace(/^(?:New message from|New reply from|Message request from)\s+/i, '').trim() || 'User';
    }
    actorAvatarUrl = notif.actor_avatar_url ? String(notif.actor_avatar_url) : null;
    if (!actorAvatarUrl && notif.actor_id) {
      const { data: actorProf } = await admin
        .from('profiles')
        .select('avatar_url')
        .eq('id', notif.actor_id)
        .maybeSingle();
      if (actorProf?.avatar_url) actorAvatarUrl = String(actorProf.avatar_url);
    }
    message = String(notif.message || 'You have a new notification.');
    link = String(notif.link || 'dashboard.html');
    if (notif.type === 'RELEASE' && /^https?:/i.test(link)) {
      const m = `${title} ${message} ${link}`.match(/v?(\d+\.\d+\.\d+)/i);
      link = `dashboard.html?release=${encodeURIComponent(m ? m[1] : 'latest')}`;
    }
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
        group_id: notifGroupId,
        type: notifType,
        title,
        body: message,
        message,
        icon: actorAvatarUrl || '/assets/icon-192.png',
        actor_avatar_url: actorAvatarUrl,
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

  let nativeHasToken = false;
  let nativePingSent = false;
  let nativePingStatus = 0;
  let fcmSent = false;
  try {
    const { data: feedRow } = await admin
      .from('notification_feed_tokens')
      .select('token')
      .eq('user_id', recipientId)
      .maybeSingle();

    if (feedRow?.token) {
      nativeHasToken = true;
      const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
      if (serviceAccountJson) {
        try {
          const account = JSON.parse(serviceAccountJson);
          if (account.project_id !== 'myipon-29788' || !account.client_email || !account.private_key) {
            throw new Error('Invalid Firebase service account configuration.');
          }
          const key = await importPKCS8(account.private_key, 'RS256');
          const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
            .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
            .setIssuer(account.client_email)
            .setSubject(account.client_email)
            .setAudience('https://oauth2.googleapis.com/token')
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(key);
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
          });
          if (!tokenResponse.ok) throw new Error(`Firebase OAuth HTTP ${tokenResponse.status}`);
          const { access_token } = await tokenResponse.json();
          const { data: devices, error: deviceError } = await admin
            .from('notification_device_tokens')
            .select('fcm_token')
            .eq('feed_token', feedRow.token);
          if (deviceError) console.error('send-push device lookup error', deviceError.message);
          const deviceTokens = (devices || []).map((row) => String(row.fcm_token || '')).filter(Boolean);
          const staleTokens: string[] = [];
          const notificationTag = `myipon-${dedupeKey || notifId}`;
          // Message data wakes the Android poller, which renders the sender avatar.
          const isMessage = ['SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST'].includes(notifType);
          const fcmMessage = {
            ...(isMessage ? {} : { notification: {
              title: title.replace(/^(?:New message from|New reply from|Message request from)\s+/i, '') || 'myIPON',
              body: message
            } }),
            data: {
              notification_id: String(notifId),
              notification_type: notifType,
              notification_link: link,
              actor_avatar_url: actorAvatarUrl || '',
              shown_key: dedupeKey ? `${notifId}:${createdAt}` : String(notifId),
              dedupe_key: dedupeKey || '',
              test: isTest ? 'true' : 'false'
            },
            android: {
              priority: 'HIGH',
              ttl: '86400s',
              ...(isMessage ? {} : { notification: { channel_id: 'myipon_alerts', icon: 'ic_stat_myipon', tag: notificationTag } })
            }
          };
          const sendFcm = async (target: { token?: string; topic?: string }) => {
            try {
              const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: { ...fcmMessage, ...target } })
              });
              if (response.ok) return true;
              const errorBody = await response.json().catch(() => ({}));
              const errorStatus = errorBody?.error?.status || 'unknown';
              console.error('send-push FCM error', response.status, errorStatus);
              if (target.token && (response.status === 404 || errorStatus === 'UNREGISTERED')) {
                staleTokens.push(target.token);
              }
            } catch (sendError) {
              console.error('send-push FCM network error', sendError);
            }
            return false;
          };
          const sentToDevices = await Promise.all(deviceTokens.map((token) => sendFcm({ token })));
          fcmSent = sentToDevices.some(Boolean);
          if (staleTokens.length > 0) {
            await admin.from('notification_device_tokens').delete().in('fcm_token', staleTokens);
          }
          if (!fcmSent) fcmSent = await sendFcm({ topic: `notif-${feedRow.token}` });
        } catch (fcmError) {
          console.error('send-push FCM error', fcmError);
        }
      } else {
        console.error('send-push FCM service account missing');
      }
      const wakeBody = JSON.stringify({
        messages: [
          {
            topic: `notif-wake:${feedRow.token}`,
            event: 'wake',
            payload: isTest
              ? { ts: Date.now(), test: true, title, message, link }
              : { ts: Date.now(), notification_id: notifId }
          }
        ]
      });
      const authCandidates = [...new Set([serviceKey, anonKey].filter(Boolean))];
      for (const apiKey of authCandidates) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          apikey: apiKey
        };
        if (apiKey.split('.').length === 3) {
          headers.Authorization = `Bearer ${apiKey}`;
        }
        const broadcastRes = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers,
          body: wakeBody
        });
        nativePingStatus = broadcastRes.status;
        if (broadcastRes.ok) {
          nativePingSent = true;
          break;
        }
        const errText = await broadcastRes.text().catch(() => '');
        console.error('send-push broadcast attempt failed', broadcastRes.status, errText);
      }
    }
  } catch (err) {
    console.error('send-push native wake error', err);
    nativePingSent = false;
  }

  return json({
    ok: true,
    web_total: webTotal,
    web_sent: webSent,
    web_failed: webFailed,
    native_has_token: nativeHasToken,
    native_ping_sent: nativePingSent,
    native_ping_status: nativePingStatus,
    fcm_sent: fcmSent
  });
});

