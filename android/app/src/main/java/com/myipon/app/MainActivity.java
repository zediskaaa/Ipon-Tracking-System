package com.myipon.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        NotificationPollReceiver.ensureChannel(this);
        maybeRequestPostNotifications();
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
        if (!link.matches("^[a-zA-Z0-9_-]+\\.html(?:#[a-zA-Z0-9_-]+)?$")) return;
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
