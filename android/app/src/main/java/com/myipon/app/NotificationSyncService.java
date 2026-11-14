package com.myipon.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextUtils;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

public class NotificationSyncService extends Service {
    private static final int FOREGROUND_NOTIF_ID = 4401;
    private static final long HEARTBEAT_INTERVAL_MS = 25_000L;
    private static final long INITIAL_RETRY_MS = 3_000L;
    private static final long MAX_RETRY_MS = 60_000L;

    private static volatile boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AtomicInteger refSeq = new AtomicInteger(1);

    private OkHttpClient wsClient;
    private WebSocket activeSocket;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private long retryDelayMs = INITIAL_RETRY_MS;
    private boolean destroyed = false;
    private String currentFeedToken = "";

    public static boolean isRunning() {
        return running;
    }

    public static void ensureStarted(Context context) {
        Context appContext = context.getApplicationContext();
        if (!NotificationPollReceiver.shouldRunInstantSync(appContext)) {
            stop(appContext);
            return;
        }
        try {
            Intent intent = new Intent(appContext, NotificationSyncService.class);
            ContextCompat.startForegroundService(appContext, intent);
        } catch (Throwable ignored) {
            // Android 12+ may restrict starting FGS from certain background contexts;
            // WorkManager + AlarmManager fallback continues polling safely.
        }
    }

    public static void stop(Context context) {
        Context appContext = context.getApplicationContext();
        try {
            appContext.stopService(new Intent(appContext, NotificationSyncService.class));
        } catch (Throwable ignored) {
        }
    }

    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            if (destroyed) return;
            WebSocket socket = activeSocket;
            if (socket != null) {
                try {
                    JSONObject hb = new JSONObject();
                    hb.put("topic", "phoenix");
                    hb.put("event", "heartbeat");
                    hb.put("payload", new JSONObject());
                    hb.put("ref", String.valueOf(refSeq.incrementAndGet()));
                    socket.send(hb.toString());
                } catch (Exception ignored) {
                }
            }
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
        }
    };

    private final Runnable reconnectRunnable = () -> {
        if (!destroyed) {
            connectSocket(true);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        destroyed = false;
        running = true;
        wsClient = new OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .build();
        registerNetworkObserver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Context appContext = getApplicationContext();
        NotificationPollReceiver.ensureChannel(appContext);

        Intent launchIntent = new Intent(appContext, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tapPending = PendingIntent.getActivity(
            appContext,
            FOREGROUND_NOTIF_ID,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification persistent = new NotificationCompat.Builder(appContext, NotificationPollReceiver.SYNC_CHANNEL_ID)
            .setSmallIcon(appContext.getApplicationInfo().icon)
            .setColor(0xFF0B3428)
            .setContentTitle("myIPON")
            .setContentText("Instant background alerts active")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setContentIntent(tapPending)
            .build();

        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(FOREGROUND_NOTIF_ID, persistent, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            } else {
                startForeground(FOREGROUND_NOTIF_ID, persistent);
            }
        } catch (Throwable ignored) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!NotificationPollReceiver.shouldRunInstantSync(appContext)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        SharedPreferences prefs = appContext.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, MODE_PRIVATE);
        String nextToken = prefs.getString("feed_token", "");
        boolean tokenChanged = !TextUtils.equals(currentFeedToken, nextToken);
        currentFeedToken = nextToken == null ? "" : nextToken;

        if (activeSocket == null || tokenChanged) {
            connectSocket(false);
        }
        NotificationPollReceiver.pollAsync(appContext);
        NotificationSyncWorker.ensureScheduled(appContext);
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Context appContext = getApplicationContext();
        if (NotificationPollReceiver.shouldRunInstantSync(appContext)) {
            NotificationPollReceiver.scheduleNext(appContext, 15_000L);
            NotificationSyncWorker.ensureScheduled(appContext);
        }
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        running = false;
        handler.removeCallbacks(heartbeatRunnable);
        handler.removeCallbacks(reconnectRunnable);
        unregisterNetworkObserver();
        closeActiveSocket();
        if (wsClient != null) {
            wsClient.dispatcher().executorService().shutdown();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void closeActiveSocket() {
        WebSocket socket = activeSocket;
        activeSocket = null;
        if (socket != null) {
            try {
                socket.close(1000, "reconnect");
            } catch (Throwable ignored) {
            }
        }
    }

    private void scheduleReconnect() {
        if (destroyed) return;
        handler.removeCallbacks(reconnectRunnable);
        long delay = retryDelayMs;
        retryDelayMs = Math.min(MAX_RETRY_MS, retryDelayMs * 2);
        handler.postDelayed(reconnectRunnable, delay);
    }

    private void connectSocket(boolean alsoPoll) {
        if (destroyed || wsClient == null) return;
        Context appContext = getApplicationContext();
        if (!NotificationPollReceiver.shouldRunInstantSync(appContext)) {
            stopSelf();
            return;
        }

        SharedPreferences prefs = appContext.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabase_url", "");
        String anonKey = prefs.getString("anon_key", "");
        String feedToken = prefs.getString("feed_token", "");
        if (TextUtils.isEmpty(supabaseUrl) || TextUtils.isEmpty(anonKey) || TextUtils.isEmpty(feedToken)) {
            stopSelf();
            return;
        }

        currentFeedToken = feedToken;
        closeActiveSocket();
        handler.removeCallbacks(heartbeatRunnable);

        String wsBase = supabaseUrl
            .replaceFirst("^https://", "wss://")
            .replaceFirst("^http://", "ws://")
            .replaceAll("/+$", "");
        String wsUrl = wsBase + "/realtime/v1/websocket?apikey=" + anonKey + "&vsn=1.0.0";
        final String topic = "realtime:notif-wake:" + feedToken;

        Request request = new Request.Builder().url(wsUrl).build();
        activeSocket = wsClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                retryDelayMs = INITIAL_RETRY_MS;
                try {
                    JSONObject broadcastCfg = new JSONObject();
                    broadcastCfg.put("ack", false);
                    broadcastCfg.put("self", false);
                    JSONObject presenceCfg = new JSONObject();
                    presenceCfg.put("key", "");
                    JSONObject config = new JSONObject();
                    config.put("broadcast", broadcastCfg);
                    config.put("presence", presenceCfg);
                    JSONObject payload = new JSONObject();
                    payload.put("config", config);

                    JSONObject join = new JSONObject();
                    join.put("topic", topic);
                    join.put("event", "phx_join");
                    join.put("payload", payload);
                    join.put("ref", String.valueOf(refSeq.incrementAndGet()));
                    webSocket.send(join.toString());
                } catch (Exception ignored) {
                }

                handler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
                if (alsoPoll) {
                    NotificationPollReceiver.pollAsync(appContext);
                }
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                try {
                    JSONObject frame = new JSONObject(text);
                    String event = frame.optString("event", "");
                    JSONObject payload = frame.optJSONObject("payload");
                    boolean isWake = false;
                    JSONObject innerPayload = payload;

                    if ("broadcast".equals(event) && payload != null) {
                        if ("wake".equals(payload.optString("event", ""))) {
                            isWake = true;
                            innerPayload = payload.optJSONObject("payload");
                        }
                    } else if ("wake".equals(event)) {
                        isWake = true;
                    }

                    if (!isWake) return;

                    if (innerPayload != null && innerPayload.optBoolean("test", false)) {
                        NotificationPollReceiver.showDirectNotification(
                            appContext,
                            "test-" + System.currentTimeMillis(),
                            "MYIPON_TEST_ALERT",
                            innerPayload.optString("title", "myIPON background alerts ready"),
                            innerPayload.optString("message", "Notifications arrive on this device even when myIPON is closed."),
                            innerPayload.optString("link", "account.html")
                        );
                    } else {
                        NotificationPollReceiver.pollAsync(appContext);
                    }
                } catch (Exception ignored) {
                }
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                if (activeSocket == webSocket) activeSocket = null;
                handler.removeCallbacks(heartbeatRunnable);
                scheduleReconnect();
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                if (activeSocket == webSocket) activeSocket = null;
                handler.removeCallbacks(heartbeatRunnable);
                if (!destroyed && code != 1000) {
                    scheduleReconnect();
                }
            }
        });
    }

    private void registerNetworkObserver() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivityManager == null) return;
            NetworkRequest req = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(@NonNull Network network) {
                    handler.post(() -> {
                        if (destroyed) return;
                        retryDelayMs = INITIAL_RETRY_MS;
                        if (activeSocket == null) {
                            connectSocket(true);
                        } else {
                            NotificationPollReceiver.pollAsync(getApplicationContext());
                        }
                    });
                }
            };
            connectivityManager.registerNetworkCallback(req, networkCallback);
        } catch (Throwable ignored) {
        }
    }

    private void unregisterNetworkObserver() {
        try {
            if (connectivityManager != null && networkCallback != null) {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            }
        } catch (Throwable ignored) {
        }
    }
}

