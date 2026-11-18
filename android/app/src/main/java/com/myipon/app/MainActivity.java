package com.myipon.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final long SLOW_CONNECTION_THRESHOLD_MS = 6000L;
    private static final long OVERLAY_SHOW_DELAY_MS = 350L;
    private static final String APP_ENTRY_URL = "https://my-ipon.vercel.app/login.html?app=1";

    private final Handler connectionMonitorHandler = new Handler(Looper.getMainLooper());
    private FrameLayout connectionOverlay;
    private ProgressBar connectionSpinner;
    private TextView connectionTitleView;
    private TextView connectionBodyView;
    private LinearLayout connectionActionsRow;
    private Button connectionWaitButton;
    private long connectionStartMs = 0L;
    private boolean userDismissedSlowCard = false;
    private volatile String pendingPickerSource = "";
    private volatile long pendingPickerSetAtMs = 0L;
    private ValueCallback<Uri[]> pendingFileCallback = null;

    private final ActivityResultLauncher<Intent> sourceFilePickerLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            final ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback == null) return;
            Uri[] uris = null;
            final Intent data = result.getData();
            if (result.getResultCode() == Activity.RESULT_OK && data != null) {
                final ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    uris = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        uris[i] = clip.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    uris = new Uri[] { data.getData() };
                } else {
                    uris = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data);
                }
            }
            callback.onReceiveValue(uris);
        }
    );

    private class PickerSourceBridge {
        @JavascriptInterface
        public void setSource(String source) {
            if ("gallery".equals(source) || "files".equals(source) || "gdrive".equals(source)) {
                pendingPickerSource = source;
                pendingPickerSetAtMs = SystemClock.uptimeMillis();
            } else {
                pendingPickerSource = "";
                pendingPickerSetAtMs = 0L;
            }
        }
    }

    private String consumePendingPickerSource() {
        final String src = pendingPickerSource;
        final long age = SystemClock.uptimeMillis() - pendingPickerSetAtMs;
        pendingPickerSource = "";
        pendingPickerSetAtMs = 0L;
        return (!src.isEmpty() && age >= 0 && age <= 10_000L) ? src : "";
    }

    private Intent buildIntentForAttachmentSource(String source, boolean allowMultiple) {
        if ("gallery".equals(source)) {
            if (Build.VERSION.SDK_INT >= 33) {
                final Intent photoPicker = new Intent(MediaStore.ACTION_PICK_IMAGES);
                if (allowMultiple) {
                    photoPicker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(20, MediaStore.getPickImagesMaxLimit()));
                }
                if (photoPicker.resolveActivity(getPackageManager()) != null) {
                    return photoPicker;
                }
            }
            final Intent galleryIntent = new Intent(Intent.ACTION_PICK);
            galleryIntent.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");
            galleryIntent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "video/*" });
            if (allowMultiple) galleryIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            if (galleryIntent.resolveActivity(getPackageManager()) != null) {
                return galleryIntent;
            }
            return null;
        }
        if ("gdrive".equals(source)) {
            final Intent driveIntent = new Intent(Intent.ACTION_GET_CONTENT);
            driveIntent.addCategory(Intent.CATEGORY_OPENABLE);
            driveIntent.setType("*/*");
            driveIntent.setPackage("com.google.android.apps.docs");
            if (allowMultiple) driveIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            if (driveIntent.resolveActivity(getPackageManager()) != null) {
                return driveIntent;
            }
        }
        if ("files".equals(source) || "gdrive".equals(source)) {
            final Intent docsIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            docsIntent.addCategory(Intent.CATEGORY_OPENABLE);
            docsIntent.setType("*/*");
            if (allowMultiple) docsIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            if (docsIntent.resolveActivity(getPackageManager()) != null) {
                return docsIntent;
            }
        }
        return null;
    }

    private final Runnable connectionMonitorTask = new Runnable() {
        @Override
        public void run() {
            updateConnectionOverlay();
            if (connectionOverlay != null && !isFinishing() && !isDestroyed()) {
                final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.getProgress() < 85) {
                    connectionMonitorHandler.postDelayed(this, 300L);
                }
            }
        }
    };

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
            webView.addJavascriptInterface(new PickerSourceBridge(), "IponNativePicker");
            if (getBridge() != null) {
                webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public boolean onShowFileChooser(
                        WebView wv,
                        ValueCallback<Uri[]> filePathCallback,
                        FileChooserParams fileChooserParams
                    ) {
                        final String source = consumePendingPickerSource();
                        final boolean allowMultiple = fileChooserParams != null
                            && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                        if (!source.isEmpty()) {
                            final Intent targeted = buildIntentForAttachmentSource(source, allowMultiple);
                            if (targeted != null) {
                                if (pendingFileCallback != null) {
                                    pendingFileCallback.onReceiveValue(null);
                                    pendingFileCallback = null;
                                }
                                try {
                                    pendingFileCallback = filePathCallback;
                                    sourceFilePickerLauncher.launch(targeted);
                                    return true;
                                } catch (Throwable err) {
                                    pendingFileCallback = null;
                                }
                            }
                        }
                        return super.onShowFileChooser(wv, filePathCallback, fileChooserParams);
                    }
                });
            }
            setupStartupConnectionOverlay(webView);
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
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final OnBackPressedCallback self = this;
                final WebView currentWebView = getBridge() != null ? getBridge().getWebView() : null;
                if (currentWebView == null) {
                    performDefaultBack(self);
                    return;
                }
                currentWebView.evaluateJavascript(
                    "(function(){try{return window.Ipon&&typeof window.Ipon.handleNativeBack==='function'?window.Ipon.handleNativeBack():'unhandled';}catch(e){return 'unhandled';}})()",
                    result -> {
                        String normalized = result == null ? "" : result.replace("\"", "").trim();
                        if ("handled".equals(normalized)) {
                            return;
                        }
                        if ("exit".equals(normalized)) {
                            performDefaultBack(self);
                            return;
                        }
                        if (currentWebView.canGoBack()) {
                            currentWebView.goBack();
                        } else {
                            performDefaultBack(self);
                        }
                    }
                );
            }
        });
    }

    private void performDefaultBack(OnBackPressedCallback callback) {
        if (callback != null) callback.setEnabled(false);
        try {
            getOnBackPressedDispatcher().onBackPressed();
        } finally {
            if (callback != null) callback.setEnabled(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    private void dispatchWindowEvent(final String eventName) {
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                "(function(){try{window.dispatchEvent(new Event('" + eventName + "'));}catch(e){}})()",
                null
            ));
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        dispatchWindowEvent(hasFocus ? "focus" : "blur");
    }

    @Override
    public void onResume() {
        super.onResume();
        NotificationSyncService.ensureStarted(this);
        NotificationSyncWorker.ensureScheduled(this);
        if (connectionOverlay != null) {
            updateConnectionOverlay();
            final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null && webView.getProgress() < 85) {
                connectionMonitorHandler.removeCallbacks(connectionMonitorTask);
                connectionMonitorHandler.postDelayed(connectionMonitorTask, 300L);
            }
        }
    }

    @Override
    public void onDestroy() {
        connectionMonitorHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onStop() {
        super.onStop();
        if (NotificationSyncService.canStartFromBackground(this)) {
            NotificationSyncService.ensureStarted(this);
        }
        NotificationSyncWorker.ensureScheduled(this);
        NotificationPollReceiver.scheduleNext(this, NotificationPollReceiver.recommendedPollIntervalMs(this));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1001 && NotificationPollReceiver.hasNotificationPermission(this)) {
            NotificationPollReceiver.ensureChannel(this);
            NotificationSyncService.ensureStarted(this);
            NotificationSyncWorker.ensureScheduled(this);
            NotificationPollReceiver.scheduleNext(this, 15_000L);
            dispatchWindowEvent("focus");
        }
    }

    private void maybeRequestStartupPermissions() {
        SharedPreferences prefs = getSharedPreferences(NotificationPollReceiver.PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean("native_perm_asked", false)) return;
        prefs.edit().putBoolean("native_perm_asked", true).apply();
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
        }
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String link = intent.getStringExtra("notification_link");
        if (link == null || link.isEmpty()) return;
        intent.removeExtra("notification_link");
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

    private void setupStartupConnectionOverlay(final WebView webView) {
        if (webView == null || !(webView.getParent() instanceof ViewGroup)) return;
        final ViewGroup parent = (ViewGroup) webView.getParent();
        connectionStartMs = SystemClock.uptimeMillis();
        userDismissedSlowCard = false;

        connectionOverlay = new FrameLayout(this);
        connectionOverlay.setBackgroundColor(Color.parseColor("#CC081D16"));
        connectionOverlay.setVisibility(View.GONE);
        connectionOverlay.setClickable(true);
        connectionOverlay.setFocusable(true);

        final LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(24), dp(26), dp(24), dp(22));
        final GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.parseColor("#102922"));
        cardBg.setCornerRadius(dp(18));
        cardBg.setStroke(dp(1), Color.argb(46, 245, 238, 224));
        card.setBackground(cardBg);

        connectionSpinner = new ProgressBar(this);
        connectionSpinner.setIndeterminateTintList(ColorStateList.valueOf(Color.parseColor("#E4B95B")));
        final LinearLayout.LayoutParams spinParams = new LinearLayout.LayoutParams(dp(36), dp(36));
        spinParams.bottomMargin = dp(14);
        card.addView(connectionSpinner, spinParams);

        connectionTitleView = new TextView(this);
        connectionTitleView.setTextColor(Color.parseColor("#F5EEE0"));
        connectionTitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
        connectionTitleView.setTypeface(Typeface.DEFAULT_BOLD);
        connectionTitleView.setGravity(Gravity.CENTER);
        final LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleParams.bottomMargin = dp(8);
        card.addView(connectionTitleView, titleParams);

        connectionBodyView = new TextView(this);
        connectionBodyView.setTextColor(Color.argb(214, 245, 238, 224));
        connectionBodyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        connectionBodyView.setLineSpacing(dp(3), 1.0f);
        connectionBodyView.setGravity(Gravity.CENTER);
        final LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bodyParams.bottomMargin = dp(18);
        card.addView(connectionBodyView, bodyParams);

        connectionActionsRow = new LinearLayout(this);
        connectionActionsRow.setOrientation(LinearLayout.HORIZONTAL);
        connectionActionsRow.setGravity(Gravity.CENTER);
        connectionActionsRow.setVisibility(View.GONE);

        connectionWaitButton = new Button(this);
        connectionWaitButton.setText("Keep waiting");
        connectionWaitButton.setAllCaps(false);
        connectionWaitButton.setTextColor(Color.parseColor("#F5EEE0"));
        connectionWaitButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        connectionWaitButton.setPadding(dp(16), dp(10), dp(16), dp(10));
        final GradientDrawable waitBg = new GradientDrawable();
        waitBg.setColor(Color.parseColor("#16382E"));
        waitBg.setCornerRadius(dp(10));
        waitBg.setStroke(dp(1), Color.argb(64, 245, 238, 224));
        connectionWaitButton.setBackground(waitBg);
        connectionWaitButton.setOnClickListener(v -> {
            userDismissedSlowCard = true;
            updateConnectionOverlay();
        });
        final LinearLayout.LayoutParams waitParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        waitParams.rightMargin = dp(8);
        connectionActionsRow.addView(connectionWaitButton, waitParams);

        final Button retryBtn = new Button(this);
        retryBtn.setText("Try again");
        retryBtn.setAllCaps(false);
        retryBtn.setTypeface(Typeface.DEFAULT_BOLD);
        retryBtn.setTextColor(Color.parseColor("#0A1B17"));
        retryBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        retryBtn.setPadding(dp(16), dp(10), dp(16), dp(10));
        final GradientDrawable retryBg = new GradientDrawable();
        retryBg.setColor(Color.parseColor("#E4B95B"));
        retryBg.setCornerRadius(dp(10));
        retryBtn.setBackground(retryBg);
        retryBtn.setOnClickListener(v -> reloadAfterConnectionIssue(webView));
        final LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        retryParams.leftMargin = dp(8);
        connectionActionsRow.addView(retryBtn, retryParams);

        card.addView(connectionActionsRow, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        final FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
            Math.min(dp(360), getResources().getDisplayMetrics().widthPixels - dp(40)),
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        connectionOverlay.addView(card, cardParams);

        parent.addView(connectionOverlay, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        connectionMonitorHandler.removeCallbacks(connectionMonitorTask);
        connectionMonitorHandler.postDelayed(connectionMonitorTask, OVERLAY_SHOW_DELAY_MS);
    }

    private void reloadAfterConnectionIssue(final WebView webView) {
        if (webView == null) return;
        connectionStartMs = SystemClock.uptimeMillis();
        userDismissedSlowCard = false;
        updateConnectionOverlay();
        connectionMonitorHandler.removeCallbacks(connectionMonitorTask);
        connectionMonitorHandler.postDelayed(connectionMonitorTask, 300L);
        final String currentUrl = webView.getUrl();
        if (currentUrl == null || currentUrl.isEmpty() || "about:blank".equals(currentUrl) || currentUrl.endsWith("offline.html")) {
            webView.loadUrl(APP_ENTRY_URL);
        } else {
            webView.stopLoading();
            webView.reload();
        }
    }

    private void updateConnectionOverlay() {
        if (connectionOverlay == null) return;
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            connectionOverlay.setVisibility(View.GONE);
            return;
        }
        final String currentUrl = webView.getUrl();
        final boolean showingOfflineFallback = currentUrl != null && currentUrl.endsWith("offline.html");
        final int progress = webView.getProgress();
        if (progress >= 85 || showingOfflineFallback) {
            connectionOverlay.setVisibility(View.GONE);
            return;
        }

        final long elapsed = SystemClock.uptimeMillis() - connectionStartMs;
        final boolean online = hasInternetConnection();
        if (!online) {
            connectionOverlay.setVisibility(View.VISIBLE);
            connectionSpinner.setVisibility(View.GONE);
            connectionTitleView.setText("No internet connection");
            connectionBodyView.setText("You appear to be offline. Turn on Wi-Fi or mobile data so myIPON can connect, then tap Try again.");
            connectionWaitButton.setVisibility(View.GONE);
            connectionActionsRow.setVisibility(View.VISIBLE);
            return;
        }

        if (userDismissedSlowCard) {
            connectionOverlay.setVisibility(View.VISIBLE);
            connectionSpinner.setVisibility(View.VISIBLE);
            connectionTitleView.setText("Still connecting…");
            connectionBodyView.setText("Waiting for a response over your slow connection.");
            connectionWaitButton.setVisibility(View.GONE);
            connectionActionsRow.setVisibility(View.VISIBLE);
            return;
        }

        if (elapsed >= SLOW_CONNECTION_THRESHOLD_MS) {
            connectionOverlay.setVisibility(View.VISIBLE);
            connectionSpinner.setVisibility(View.GONE);
            connectionTitleView.setText("Slow or unstable internet");
            connectionBodyView.setText("myIPON is taking longer than usual to load because your connection is weak. Please check your Wi-Fi or mobile data signal, then try again.");
            connectionWaitButton.setVisibility(View.VISIBLE);
            connectionActionsRow.setVisibility(View.VISIBLE);
            return;
        }

        if (elapsed >= OVERLAY_SHOW_DELAY_MS) {
            connectionOverlay.setVisibility(View.VISIBLE);
            connectionSpinner.setVisibility(View.VISIBLE);
            connectionTitleView.setText("Connecting to myIPON");
            connectionBodyView.setText("Loading your workspace. This may take a moment on slower connections.");
            connectionActionsRow.setVisibility(View.GONE);
        }
    }

    private boolean hasInternetConnection() {
        try {
            final ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            final Network active = cm.getActiveNetwork();
            if (active == null) return false;
            final NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Throwable err) {
            return true;
        }
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            getResources().getDisplayMetrics()
        ));
    }
}
