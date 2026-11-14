package com.myipon.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        final long splashStartMs = SystemClock.uptimeMillis();
        final SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        final int emeraldBg = Color.parseColor("#0b3428");
        registerPlugin(BackgroundNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new ColorDrawable(emeraldBg));
        getWindow().getDecorView().setBackgroundColor(emeraldBg);
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(Color.parseColor("#0b3428"));
            if (webView.getParent() instanceof View) {
                ((View) webView.getParent()).setBackgroundColor(emeraldBg);
            }
        }
        splashScreen.setKeepOnScreenCondition(() -> {
            final long elapsed = SystemClock.uptimeMillis() - splashStartMs;
            if (elapsed >= 900L) return false;
            if (webView == null) return elapsed < 300L;
            return elapsed < 250L || webView.getProgress() < 80;
        });
        NotificationPollReceiver.ensureChannel(this);
        maybeRequestPostNotifications();
        NotificationSyncService.ensureStarted(this);
        NotificationSyncWorker.ensureScheduled(this);
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    public void onStop() {
        super.onStop();
        NotificationSyncService.ensureStarted(this);
        NotificationSyncWorker.ensureScheduled(this);
        NotificationPollReceiver.scheduleNext(this, 30_000L);
    }

    private void maybeRequestPostNotifications() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        SharedPreferences prefs = getSharedPreferences(NotificationPollReceiver.PREFS_NAME, MODE_PRIVATE);
        if (!prefs.getBoolean("native_perm_asked", false)) {
            prefs.edit().putBoolean("native_perm_asked", true).apply();
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String link = intent.getStringExtra("notification_link");
        if (link == null || link.isEmpty()) return;
        if (!link.matches("^[a-zA-Z0-9_-]+\\.html(?:\\?[a-zA-Z0-9_=&:.-]+)?(?:#[a-zA-Z0-9_-]+)?$")) return;
        if (bridge != null && bridge.getWebView() != null) {
            final String safePath = link;
            bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript(
                    "window.location.href='" + safePath + "';",
                    null
                )
            );
        }
    }
}
