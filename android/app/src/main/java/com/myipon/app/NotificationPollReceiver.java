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
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
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
    private static final long HEALTHY_WS_POLL_INTERVAL_MS = 300_000L;
    private static final long MIN_ALARM_POLL_GAP_MS = 15_000L;
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
        if (NotificationSyncService.isWsConnected()) {
            return HEALTHY_WS_POLL_INTERVAL_MS;
        }
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
        return readTrackedSet(prefs, "shown_ids");
    }

    private static Set<String> readTrackedSet(SharedPreferences prefs, String key) {
        String raw = prefs.getString(key, "");
        Set<String> set = new LinkedHashSet<>();
        if (!TextUtils.isEmpty(raw)) {
            set.addAll(Arrays.asList(raw.split(",")));
        }
        set.remove("");
        return set;
    }

    private static void saveShownSet(SharedPreferences prefs, Set<String> set) {
        saveTrackedSet(prefs, "shown_ids", set);
    }

    private static void saveTrackedSet(SharedPreferences prefs, String key, Set<String> set) {
        List<String> list = new ArrayList<>(set);
        if (list.size() > 120) {
            list = list.subList(list.size() - 120, list.size());
        }
        prefs.edit().putString(key, TextUtils.join(",", list)).apply();
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

    public static boolean isLegacyChatNotification(String type, String dedupeKey, String link) {
        if (!TextUtils.isEmpty(type) && type.trim().toUpperCase(java.util.Locale.US).startsWith("SOCIAL_")) {
            return true;
        }
        if (!TextUtils.isEmpty(dedupeKey)) {
            String upperDedupe = dedupeKey.trim().toUpperCase(java.util.Locale.US);
            if (upperDedupe.startsWith("SOCIAL_") || upperDedupe.startsWith("FRIEND_")) {
                return true;
            }
        }
        if (!TextUtils.isEmpty(link)) {
            String lower = link.trim().toLowerCase(java.util.Locale.US);
            if (lower.contains("?chat=") || lower.contains("&chat=") || lower.contains("?messages=") || lower.contains("&messages=")) {
                return true;
            }
        }
        return false;
    }

    public static String cleanNotificationTitle(String rawTitle) {
        String base = TextUtils.isEmpty(rawTitle) ? "myIPON" : rawTitle.trim();
        base = base.replaceFirst("(?i)^Update\\s+Update\\s+", "Update ");
        java.util.regex.Matcher relMatcher = java.util.regex.Pattern
            .compile("(?i)^Update\\s+v?(\\d+(?:\\.\\d+)*)\\s*:\\s*(.+)$")
            .matcher(base);
        if (relMatcher.matches()) {
            String ver = relMatcher.group(1);
            String rest = relMatcher.group(2) == null ? "" : relMatcher.group(2).trim();
            if (!TextUtils.isEmpty(ver) && rest.toLowerCase(java.util.Locale.US).contains(ver.toLowerCase(java.util.Locale.US))) {
                base = rest;
            } else if (!TextUtils.isEmpty(ver) && !TextUtils.isEmpty(rest)) {
                base = "v" + ver + ": " + rest;
            }
        }
        return TextUtils.isEmpty(base) ? "myIPON" : base;
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

    private static Bitmap loadCircularAvatarBitmap(String avatarUrl) {
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
        return null;
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
        if (isLegacyChatNotification(type, dedupeKey, link)) return;
        ensureChannel(appContext);

        String cleanTitle = cleanNotificationTitle(title);
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
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .setContentIntent(tapPending);

        if (!TextUtils.isEmpty(avatarUrl)) {
            Bitmap avatarBitmap = loadCircularAvatarBitmap(avatarUrl);
            if (avatarBitmap != null) {
                builder.setLargeIcon(avatarBitmap);
            }
        }

        String tag = "myipon-" + (!TextUtils.isEmpty(dedupeKey) ? dedupeKey : id);
        NotificationManagerCompat.from(appContext).notify(tag, 0, builder.build());
    }

    public static synchronized void showDirectNotificationIfNew(
        Context context,
        String id,
        String dedupeKey,
        String shownKey,
        String type,
        String title,
        String body,
        String link,
        String avatarUrl
    ) {
        if (context == null) return;
        if (isLegacyChatNotification(type, dedupeKey, link)) return;
        final Context appContext = context.getApplicationContext();
        if (!hasNotificationPermission(appContext)) return;
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> shown = readShownSet(prefs);
        String key = !TextUtils.isEmpty(shownKey) ? shownKey : id;
        if (!TextUtils.isEmpty(key) && shown.contains(key)) return;
        if (TextUtils.isEmpty(dedupeKey) && !TextUtils.isEmpty(id) && shown.contains(id)) return;
        String cleanTitle = cleanNotificationTitle(title);
        String cleanBody = body == null ? "" : body;
        if (!isAlreadyInTray(appContext, id, dedupeKey, cleanTitle, cleanBody)) {
            showDirectNotification(appContext, id, dedupeKey, type, title, cleanBody, link, avatarUrl);
        }
        if (!TextUtils.isEmpty(key)) shown.add(key);
        if (TextUtils.isEmpty(dedupeKey) && !TextUtils.isEmpty(id)) shown.add(id);
        saveShownSet(prefs, shown);
    }

    public static void showDirectNotificationAsync(
        Context context,
        String id,
        String dedupeKey,
        String shownKey,
        String type,
        String title,
        String body,
        String link,
        String avatarUrl
    ) {
        if (context == null) return;
        final Context appContext = context.getApplicationContext();
        if (!hasNotificationPermission(appContext)) return;
        POLL_EXECUTOR.execute(() -> showDirectNotificationIfNew(
            appContext, id, dedupeKey, shownKey, type, title, body, link, avatarUrl
        ));
    }

    private static boolean isAlreadyInTray(Context context, String id, String dedupeKey, String title, String body) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        String tag = "myipon-" + (!TextUtils.isEmpty(dedupeKey) ? dedupeKey : id);
        String normTitle = title == null ? "" : title.trim();
        String normBody = body == null ? "" : body.trim();
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            boolean sameTag = tag.equals(active.getTag());
            if (sameTag && TextUtils.isEmpty(dedupeKey)) {
                return true;
            }
            Notification notification = active.getNotification();
            if (notification == null || notification.extras == null) continue;
            CharSequence activeTitleCs = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence activeBodyCs = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
            String activeTitle = activeTitleCs == null ? "" : activeTitleCs.toString().trim();
            String activeBody = activeBodyCs == null ? "" : activeBodyCs.toString().trim();
            if (!TextUtils.isEmpty(normTitle) && !TextUtils.isEmpty(normBody)
                && normTitle.equals(activeTitle) && normBody.equals(activeBody)) {
                return true;
            }
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
                        if (isLegacyChatNotification(type, dedupeKey, link)) continue;
                        String shownKey = !TextUtils.isEmpty(dedupeKey)
                            ? (id + ":" + (!TextUtils.isEmpty(createdAt) ? createdAt : body))
                            : id;

                        if (!shown.contains(shownKey) && !(TextUtils.isEmpty(dedupeKey) && shown.contains(id))) {
                            if (!isAlreadyInTray(appContext, id, dedupeKey,
                                cleanNotificationTitle(title), body)) {
                                showDirectNotification(appContext, id, dedupeKey, type, title, body, link, avatarUrl);
                            }
                            shown.add(shownKey);
                            if (TextUtils.isEmpty(dedupeKey)) shown.add(id);
                            changed = true;
                        }
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
            NotificationSyncService.pokeOrReconnect(appContext, false);
        } else if (NotificationSyncService.canStartFromBackground(appContext)) {
            NotificationSyncService.ensureStarted(appContext);
        }

        if (!hasNotificationPermission(appContext)) {
            return;
        }

        long now = SystemClock.elapsedRealtime();
        long lastPoll = lastPollSuccessElapsedMs;
        if (NotificationSyncService.isWsConnected()
            && lastPoll > 0L
            && (now - lastPoll) < (HEALTHY_WS_POLL_INTERVAL_MS - MIN_ALARM_POLL_GAP_MS)) {
            return;
        }
        if (POLL_IN_FLIGHT.get() || (lastPoll > 0L && (now - lastPoll) < MIN_ALARM_POLL_GAP_MS)) {
            return;
        }

        final PendingResult pendingResult = goAsync();
        POLL_EXECUTOR.execute(() -> {
            if (!POLL_IN_FLIGHT.compareAndSet(false, true)) {
                pendingResult.finish();
                return;
            }
            try {
                pollWithWakeLock(appContext);
            } finally {
                POLL_IN_FLIGHT.set(false);
                pendingResult.finish();
            }
        });
    }
}
