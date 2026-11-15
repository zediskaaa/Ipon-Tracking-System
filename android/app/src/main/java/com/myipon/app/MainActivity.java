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
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

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
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                if (url == null || (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("data:"))) {
                    return;
                }
                try {
                    String suggested = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    BackgroundNotificationsPlugin.enqueueSystemDownload(MainActivity.this, url, suggested, mimetype);
                    Toast.makeText(MainActivity.this, "Downloading " + suggested, Toast.LENGTH_SHORT).show();
                } catch (Throwable err) {
                    Toast.makeText(MainActivity.this, "Unable to start download.", Toast.LENGTH_SHORT).show();
                }
            });
        }
        splashScreen.setKeepOnScreenCondition(() -> {
            final long elapsed = SystemClock.uptimeMillis() - splashStartMs;
            if (elapsed >= 900L) return false;
            if (webView == null) return elapsed < 300L;
            return elapsed < 250L || webView.getProgress() < 80;
        });
        NotificationPollReceiver.ensureChannel(this);
        maybeRequestStartupPermissions();
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
    public void onResume() {
        super.onResume();
        NotificationSyncService.ensureStarted(this);
        NotificationSyncWorker.ensureScheduled(this);
    }

    @Override
    public void onStop() {
        super.onStop();
        NotificationSyncService.ensureStarted(this);
        NotificationSyncWorker.ensureScheduled(this);
        NotificationPollReceiver.scheduleNext(this, 30_000L);
    }

    private void maybeRequestStartupPermissions() {
        SharedPreferences prefs = getSharedPreferences(NotificationPollReceiver.PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean("native_perm_asked", false)) return;
        prefs.edit()
            .putBoolean("native_perm_asked", true)
            .putBoolean("native_mic_perm_asked", true)
            .apply();
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), 1001);
        }
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String link = intent.getStringExtra("notification_link");
        if (link == null || link.isEmpty()) return;
        if (!link.matches("^[a-zA-Z0-9_-]+\\.html(?:\\?[a-zA-Z0-9_=&:%.-]+)?(?:#[a-zA-Z0-9_-]+)?$")) return;
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
