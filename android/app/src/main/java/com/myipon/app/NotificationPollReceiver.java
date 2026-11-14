package com.myipon.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.text.TextUtils;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
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
import org.json.JSONArray;
import org.json.JSONObject;

public class NotificationPollReceiver extends BroadcastReceiver {
    public static final String PREFS_NAME = "myipon_bg_notifs";
    public static final String CHANNEL_ID = "myipon_alerts";
    public static final String SYNC_CHANNEL_ID = "myipon_bg_sync";
    public static final String ACTION_POLL = "com.myipon.app.ACTION_POLL_NOTIFICATIONS";
    private static final int ALARM_REQUEST_CODE = 4419;
    private static final long POLL_INTERVAL_MS = 120_000L;
    private static final ExecutorService POLL_EXECUTOR = Executors.newSingleThreadExecutor();

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
            return Math.abs(dedupeKey.hashCode()) + 1000;
        }
        try {
            return Math.abs((int) Long.parseLong(id));
        } catch (NumberFormatException ignored) {
            return Math.abs(id.hashCode()) + 1000;
        }
    }

    public static void showDirectNotification(
        Context appContext,
        String id,
        String dedupeKey,
        String title,
        String body,
        String link
    ) {
        if (!hasNotificationPermission(appContext)) return;
        ensureChannel(appContext);

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
            .setSmallIcon(appContext.getApplicationInfo().icon)
            .setColor(0xFF0B3428)
            .setContentTitle(TextUtils.isEmpty(title) ? "myIPON" : title)
            .setContentText(body == null ? "" : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .setContentIntent(tapPending);

        NotificationManagerCompat.from(appContext).notify(notifId, builder.build());
    }

    public static void pollAsync(Context context) {
        final Context appContext = context.getApplicationContext();
        POLL_EXECUTOR.execute(() -> pollSync(appContext));
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
            conn.setRequestProperty("Authorization", "Bearer " + anonKey);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");

            JSONObject payload = new JSONObject();
            payload.put("p_token", feedToken);
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }

            if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                }

                JSONArray rows = new JSONArray(sb.toString());
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
                        String title = row.optString("title", "myIPON");
                        String body = row.optString("message", "");
                        String link = row.optString("link", "");
                        String shownKey = !TextUtils.isEmpty(dedupeKey)
                            ? (id + ":" + (!TextUtils.isEmpty(createdAt) ? createdAt : body))
                            : id;

                        if (shown.contains(shownKey) || (TextUtils.isEmpty(dedupeKey) && shown.contains(id))) {
                            continue;
                        }

                        showDirectNotification(appContext, id, dedupeKey, title, body, link);
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
        } catch (Exception ignored) {
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

        scheduleNext(appContext, POLL_INTERVAL_MS);
        NotificationSyncWorker.ensureScheduled(appContext);
        NotificationSyncService.ensureStarted(appContext);

        if (!hasNotificationPermission(appContext)) {
            return;
        }

        final PendingResult pendingResult = goAsync();
        POLL_EXECUTOR.execute(() -> {
            try {
                pollSync(appContext);
            } finally {
                pendingResult.finish();
            }
        });
    }
}
