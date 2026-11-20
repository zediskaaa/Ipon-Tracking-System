package com.myipon.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public class NotificationPollReceiver extends BroadcastReceiver {
    public static final String PREFS_NAME = "myipon_bg_notifs";
    public static final String CHANNEL_ID = "myipon_alerts";
    public static final String SYNC_CHANNEL_ID = "myipon_bg_sync";
    public static final String ACTION_POLL = "com.myipon.app.ACTION_POLL_NOTIFICATIONS";
    private static final int ALARM_REQUEST_CODE = 4419;
    private static final long POLL_INTERVAL_MS = 60_000L;
    private static final long RESTRICTED_POLL_INTERVAL_MS = 90_000L;
    private static final long POLL_WAKELOCK_TIMEOUT_MS = 15_000L;
    private static final ExecutorService POLL_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean POLL_IN_FLIGHT = new AtomicBoolean(false);
    private static final AtomicBoolean POLL_PENDING = new AtomicBoolean(false);
    private static volatile long lastPollSuccessElapsedMs = 0L;

    public static long getLastPollSuccessElapsedMs() {
        return lastPollSuccessElapsedMs;
    }

    public static boolean isBatteryOptimizationIgnored(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    public static long recommendedPollIntervalMs(Context context) {
        return isBatteryOptimizationIgnored(context) ? POLL_INTERVAL_MS : RESTRICTED_POLL_INTERVAL_MS;
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "myIPON Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Role updates, discussions, approvals, announcements, and due reminders");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(SYNC_CHANNEL_ID) == null) {
            NotificationChannel syncChannel = new NotificationChannel(
                SYNC_CHANNEL_ID,
                "Background Alert Sync",
                NotificationManager.IMPORTANCE_MIN
            );
            syncChannel.setDescription("Keeps real-time alerts running even when myIPON is closed");
            syncChannel.setShowBadge(false);
            syncChannel.enableLights(false);
            syncChannel.enableVibration(false);
            syncChannel.setSound(null, null);
            manager.createNotificationChannel(syncChannel);
        }
    }

    public static boolean hasFeedConfig(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return !TextUtils.isEmpty(prefs.getString("supabase_url", null))
            && !TextUtils.isEmpty(prefs.getString("anon_key", null))
            && !TextUtils.isEmpty(prefs.getString("feed_token", null));
    }

    public static boolean isInstantSyncEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean("instant_sync_enabled", true);
    }

    public static boolean shouldRunInstantSync(Context context) {
        return hasFeedConfig(context)
            && isInstantSyncEnabled(context)
            && hasNotificationPermission(context);
    }

    @SuppressLint({"ScheduleExactAlarm", "MissingPermission"})
    public static void scheduleNext(Context context, long delayMs) {
        if (!hasFeedConfig(context)) return;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        Intent intent = new Intent(context, NotificationPollReceiver.class);
        intent.setAction(ACTION_POLL);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        long triggerAt = SystemClock.elapsedRealtime() + Math.max(15_000L, delayMs);
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms();
        if (canExact) {
            try {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
                return;
            } catch (SecurityException ignored) {
            }
        }
        alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
    }

    public static void scheduleServiceRestart(Context context, long delayMs) {
        if (context == null || !shouldRunInstantSync(context) || !NotificationSyncService.canStartFromBackground(context)) {
            return;
        }
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        Intent serviceIntent = new Intent(context, NotificationSyncService.class);
        PendingIntent pending = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? PendingIntent.getForegroundService(
                context,
                ALARM_REQUEST_CODE + 1,
                serviceIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            )
            : PendingIntent.getService(
                context,
                ALARM_REQUEST_CODE + 1,
                serviceIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        long triggerAt = SystemClock.elapsedRealtime() + Math.max(2_000L, delayMs);
        alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
    }

    public static void cancel(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        Intent intent = new Intent(context, NotificationPollReceiver.class);
        intent.setAction(ACTION_POLL);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        alarmManager.cancel(pending);
    }

    public static synchronized void mergeShownIds(Context context, List<String> newIds) {
        if (newIds == null || newIds.isEmpty()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> set = readShownSet(prefs);
        set.addAll(newIds);
        saveShownSet(prefs, set);
    }

    private static Set<String> readShownSet(SharedPreferences prefs) {
        String raw = prefs.getString("shown_ids", "");
        Set<String> set = new LinkedHashSet<>();
        if (!TextUtils.isEmpty(raw)) {
            set.addAll(Arrays.asList(raw.split(",")));
        }
        set.remove("");
        return set;
    }

    private static void saveShownSet(SharedPreferences prefs, Set<String> set) {
        List<String> list = new ArrayList<>(set);
        if (list.size() > 120) {
            list = list.subList(list.size() - 120, list.size());
        }
        prefs.edit().putString("shown_ids", TextUtils.join(",", list)).apply();
    }

    public static boolean hasNotificationPermission(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private static int buildNotifId(String id, String dedupeKey) {
        if (!TextUtils.isEmpty(dedupeKey)) {
            return (dedupeKey.hashCode() & 0x7fffffff) + 1000;
        }
        try {
            return (int) (Math.abs(Long.parseLong(id)) & 0x7fffffffL);
        } catch (NumberFormatException ignored) {
            return (String.valueOf(id).hashCode() & 0x7fffffff) + 1000;
        }
    }

    private static boolean isMessageNotification(String type, String dedupeKey, String title) {
        if (!TextUtils.isEmpty(type)) {
            String upper = type.trim().toUpperCase();
            if ("SOCIAL_NEW_MESSAGE".equals(upper)
                || "SOCIAL_MESSAGE_REPLY".equals(upper)
                || "SOCIAL_MESSAGE_REQUEST".equals(upper)) {
                return true;
            }
        }
        if (!TextUtils.isEmpty(dedupeKey) && dedupeKey.trim().toUpperCase().startsWith("SOCIAL_MSG")) {
            return true;
        }
        if (!TextUtils.isEmpty(title)) {
            String t = title.trim().toLowerCase();
            return t.startsWith("new message from ")
                || t.startsWith("new reply from ")
                || t.startsWith("message request from ");
        }
        return false;
    }

    public static String cleanMessageNotificationTitle(String type, String dedupeKey, String rawTitle) {
        String base = TextUtils.isEmpty(rawTitle) ? "myIPON" : rawTitle.trim();
        if (isMessageNotification(type, dedupeKey, base)) {
            base = base.replaceFirst("(?i)^(?:New message from|New reply from|Message request from)\\s+", "").trim();
            if (TextUtils.isEmpty(base)) base = "User";
        }
        return base;
    }

    private static Bitmap toCircularBitmap(Bitmap source) {
        if (source == null) return null;
        int size = 128;
        int minEdge = Math.min(source.getWidth(), source.getHeight());
        if (minEdge <= 0) return null;
        int x = (source.getWidth() - minEdge) / 2;
        int y = (source.getHeight() - minEdge) / 2;
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        float radius = size / 2f;
        canvas.drawCircle(radius, radius, radius, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        Rect srcRect = new Rect(x, y, x + minEdge, y + minEdge);
        Rect dstRect = new Rect(0, 0, size, size);
        canvas.drawBitmap(source, srcRect, dstRect, paint);
        return output;
    }

    private static Bitmap createInitialsAvatarBitmap(String senderName) {
        int size = 128;
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setColor(0xFF0F5240);
        float radius = size / 2f;
        canvas.drawCircle(radius, radius, radius, bgPaint);

        String initials = "U";
        if (!TextUtils.isEmpty(senderName)) {
            String[] parts = senderName.trim().split("\\s+");
            StringBuilder sb = new StringBuilder();
            for (String part : parts) {
                if (!part.isEmpty()) {
                    sb.append(Character.toUpperCase(part.charAt(0)));
                    if (sb.length() == 2) break;
                }
            }
            if (sb.length() > 0) initials = sb.toString();
        }

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(0xFFF6F1E4);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        textPaint.setTextSize(46f);
        Paint.FontMetrics fm = textPaint.getFontMetrics();
        float textY = radius - (fm.ascent + fm.descent) / 2f;
        canvas.drawText(initials, radius, textY, textPaint);
        return output;
    }

    private static Bitmap loadCircularAvatarBitmap(String avatarUrl, String senderName, boolean fallbackToInitials) {
        if (!TextUtils.isEmpty(avatarUrl)) {
            String trimmed = avatarUrl.trim();
            try {
                if (trimmed.startsWith("data:image/")) {
                    int comma = trimmed.indexOf(',');
                    if (comma > 0) {
                        byte[] decoded = Base64.decode(trimmed.substring(comma + 1), Base64.DEFAULT);
                        Bitmap raw = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
                        Bitmap circle = toCircularBitmap(raw);
                        if (circle != null) return circle;
                    }
                } else if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
                    HttpURLConnection avatarConn = null;
                    try {
                        avatarConn = (HttpURLConnection) new URL(trimmed).openConnection();
                        avatarConn.setConnectTimeout(4_000);
                        avatarConn.setReadTimeout(4_000);
                        avatarConn.setInstanceFollowRedirects(true);
                        if (avatarConn.getResponseCode() >= 200 && avatarConn.getResponseCode() < 300) {
                            try (InputStream is = avatarConn.getInputStream()) {
                                Bitmap raw = BitmapFactory.decodeStream(is);
                                Bitmap circle = toCircularBitmap(raw);
                                if (circle != null) return circle;
                            }
                        }
                    } finally {
                        if (avatarConn != null) avatarConn.disconnect();
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return fallbackToInitials ? createInitialsAvatarBitmap(senderName) : null;
    }

    public static void showDirectNotification(
        Context appContext,
        String id,
        String dedupeKey,
        String title,
        String body,
        String link
    ) {
        showDirectNotification(appContext, id, dedupeKey, "", title, body, link, "");
    }

    public static void showDirectNotification(
        Context appContext,
        String id,
        String dedupeKey,
        String type,
        String title,
        String body,
        String link,
        String avatarUrl
    ) {
        if (!hasNotificationPermission(appContext)) return;
        ensureChannel(appContext);

        boolean isMsg = isMessageNotification(type, dedupeKey, title);
        String cleanTitle = cleanMessageNotificationTitle(type, dedupeKey, title);
        String cleanBody = body == null ? "" : body;

        Intent launchIntent = new Intent(appContext, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!TextUtils.isEmpty(link)) {
            launchIntent.putExtra("notification_link", link);
        }

        int notifId = buildNotifId(id, dedupeKey);
        PendingIntent tapPending = PendingIntent.getActivity(
            appContext,
            notifId,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_myipon)
            .setColor(0xFF0B3428)
            .setContentTitle(cleanTitle)
            .setContentText(cleanBody)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(cleanBody))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .setContentIntent(tapPending);

        if (isMsg || !TextUtils.isEmpty(avatarUrl)) {
            Bitmap avatarBitmap = loadCircularAvatarBitmap(avatarUrl, cleanTitle, isMsg);
            if (avatarBitmap != null) {
                builder.setLargeIcon(avatarBitmap);
                if (isMsg) {
                    Person sender = new Person.Builder()
                        .setName(cleanTitle)
                        .setIcon(IconCompat.createWithBitmap(avatarBitmap))
                        .build();
                    NotificationCompat.MessagingStyle msgStyle = new NotificationCompat.MessagingStyle(sender)
                        .addMessage(cleanBody, System.currentTimeMillis(), sender);
                    builder.setStyle(msgStyle);
                }
            }
        }

        String tag = "myipon-" + (!TextUtils.isEmpty(dedupeKey) ? dedupeKey : id);
        NotificationManagerCompat.from(appContext).notify(tag, 0, builder.build());
    }

    private static boolean isAlreadyInTray(Context context, String id, String dedupeKey, String title, String body) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        String tag = "myipon-" + (!TextUtils.isEmpty(dedupeKey) ? dedupeKey : id);
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            if (!tag.equals(active.getTag())) continue;
            Notification notification = active.getNotification();
            if (notification.extras == null) continue;
            if (TextUtils.equals(title, notification.extras.getCharSequence(Notification.EXTRA_TITLE))
                && TextUtils.equals(body, notification.extras.getCharSequence(Notification.EXTRA_TEXT))) return true;
        }
        return false;
    }

    public static void pollAsync(Context context) {
        pollAsync(context, null);
    }

    public static void pollAsync(Context context, final PowerManager.WakeLock handoffLock) {
        final Context appContext = context.getApplicationContext();
        if (!hasFeedConfig(appContext) || !hasNotificationPermission(appContext)) {
            if (handoffLock != null && handoffLock.isHeld()) {
                try { handoffLock.release(); } catch (Exception ignored) { }
            }
            return;
        }
        if (!POLL_IN_FLIGHT.compareAndSet(false, true)) {
            POLL_PENDING.set(true);
            if (handoffLock != null && handoffLock.isHeld()) {
                try { handoffLock.release(); } catch (Exception ignored) { }
            }
            return;
        }
        POLL_EXECUTOR.execute(() -> {
            try {
                do {
                    POLL_PENDING.set(false);
                    pollWithWakeLock(appContext);
                } while (POLL_PENDING.getAndSet(false)
                    && hasFeedConfig(appContext)
                    && hasNotificationPermission(appContext));
            } finally {
                POLL_IN_FLIGHT.set(false);
                if (handoffLock != null && handoffLock.isHeld()) {
                    try { handoffLock.release(); } catch (Exception ignored) { }
                }
            }
        });
    }

    public static void pollWithWakeLock(Context context) {
        final Context appContext = context.getApplicationContext();
        PowerManager.WakeLock wakeLock = null;
        try {
            PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "myipon:notif-poll");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(POLL_WAKELOCK_TIMEOUT_MS);
            }
            pollSync(appContext);
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (Exception ignored) {
                }
            }
        }
    }

    public static synchronized void pollSync(Context appContext) {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabase_url", null);
        String anonKey = prefs.getString("anon_key", null);
        String feedToken = prefs.getString("feed_token", null);

        if (TextUtils.isEmpty(supabaseUrl) || TextUtils.isEmpty(anonKey) || TextUtils.isEmpty(feedToken)) {
            return;
        }
        if (!hasNotificationPermission(appContext)) {
            return;
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(supabaseUrl + "/rest/v1/rpc/get_unread_notifications_by_token");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("apikey", anonKey);
            if (anonKey.startsWith("eyJ")) {
                conn.setRequestProperty("Authorization", "Bearer " + anonKey);
            }
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");

            JSONObject payload = new JSONObject();
            payload.put("p_token", feedToken);
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }

            int statusCode = conn.getResponseCode();
            prefs.edit()
                .putInt("last_poll_http_code", statusCode)
                .putLong("last_poll_at_ms", System.currentTimeMillis())
                .putString("last_poll_error", statusCode >= 200 && statusCode < 300 ? "" : ("HTTP " + statusCode))
                .apply();

            if (statusCode >= 200 && statusCode < 300) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                }

                JSONArray rows = new JSONArray(sb.toString());
                lastPollSuccessElapsedMs = SystemClock.elapsedRealtime();
                if (rows.length() > 0) {
                    Set<String> shown = readShownSet(prefs);
                    boolean changed = false;

                    for (int i = rows.length() - 1; i >= 0; i--) {
                        JSONObject row = rows.optJSONObject(i);
                        if (row == null) continue;
                        String id = row.optString("id", "");
                        if (TextUtils.isEmpty(id)) continue;

                        String dedupeKey = row.optString("dedupe_key", "");
                        String createdAt = row.optString("created_at", "");
                        String type = row.optString("type", "");
                        String title = row.optString("title", "myIPON");
                        String body = row.optString("message", "");
                        String link = row.optString("link", "");
                        String avatarUrl = row.optString("actor_avatar_url", "");
                        String shownKey = !TextUtils.isEmpty(dedupeKey)
                            ? (id + ":" + (!TextUtils.isEmpty(createdAt) ? createdAt : body))
                            : id;

                        if (shown.contains(shownKey) || (TextUtils.isEmpty(dedupeKey) && shown.contains(id))) {
                            continue;
                        }

                        if (!isAlreadyInTray(appContext, id, dedupeKey,
                            cleanMessageNotificationTitle(type, dedupeKey, title), body)) {
                            showDirectNotification(appContext, id, dedupeKey, type, title, body, link, avatarUrl);
                        }
                        shown.add(shownKey);
                        if (TextUtils.isEmpty(dedupeKey)) {
                            shown.add(id);
                        }
                        changed = true;
                    }

                    if (changed) {
                        saveShownSet(prefs, shown);
                    }
                }
            }
        } catch (Exception err) {
            prefs.edit()
                .putInt("last_poll_http_code", 0)
                .putLong("last_poll_at_ms", System.currentTimeMillis())
                .putString("last_poll_error", err.getMessage() != null ? err.getMessage() : err.getClass().getSimpleName())
                .apply();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context appContext = context.getApplicationContext();
        if (!hasFeedConfig(appContext)) {
            return;
        }

        scheduleNext(appContext, recommendedPollIntervalMs(appContext));
        NotificationSyncWorker.ensureScheduled(appContext);
        if (NotificationSyncService.isRunning()) {
            NotificationSyncService.pokeOrReconnect(appContext);
        } else if (NotificationSyncService.canStartFromBackground(appContext)) {
            NotificationSyncService.ensureStarted(appContext);
        }

        if (!hasNotificationPermission(appContext)) {
            return;
        }

        final PendingResult pendingResult = goAsync();
        POLL_EXECUTOR.execute(() -> {
            try {
                pollWithWakeLock(appContext);
            } finally {
                pendingResult.finish();
            }
        });
    }
}
