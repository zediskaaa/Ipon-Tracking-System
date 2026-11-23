package com.myipon.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

@CapacitorPlugin(name = "BackgroundNotifications")
public class BackgroundNotificationsPlugin extends Plugin {
    private static final String APP_UPDATE_MANIFEST_URL = "https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/app-update.json";
    private static final String APP_UPDATE_ALLOWED_PREFIX = "https://github.com/zediskaaa/Ipon-Tracking-System/";
    private static final AtomicBoolean updateInProgress = new AtomicBoolean(false);

    private static long getInstalledVersionCode(Context ctx) {
        if (ctx == null) return 0L;
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (info == null) return 0L;
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : (long) info.versionCode;
        } catch (Throwable ignored) {
            return 0L;
        }
    }

    private static String getInstalledVersionName(Context ctx) {
        if (ctx == null) return "";
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return info != null && info.versionName != null ? info.versionName : "";
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static OkHttpClient createUpdateHttpClient(long readTimeoutSec) {
        return new OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(readTimeoutSec, TimeUnit.SECONDS)
            .build();
    }

    private void emitAppUpdateProgress(String phase, int progress, long downloadedBytes, long totalBytes, String message) {
        JSObject payload = new JSObject();
        payload.put("phase", phase);
        payload.put("progress", progress);
        payload.put("downloadedBytes", downloadedBytes);
        payload.put("totalBytes", totalBytes);
        if (!TextUtils.isEmpty(message)) payload.put("message", message);
        notifyListeners("appUpdateProgress", payload);
    }

    @PluginMethod
    public void checkNativeAppUpdate(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("App context is unavailable.");
            return;
        }
        String rawManifestUrl = call.getString("manifestUrl", APP_UPDATE_MANIFEST_URL);
        String manifestUrl = TextUtils.isEmpty(rawManifestUrl) ? APP_UPDATE_MANIFEST_URL : rawManifestUrl.trim();
        if (!manifestUrl.startsWith(APP_UPDATE_ALLOWED_PREFIX)) {
            call.reject("Untrusted update manifest URL.");
            return;
        }
        long installedCode = getInstalledVersionCode(ctx);
        String installedName = getInstalledVersionName(ctx);
        boolean canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || ctx.getPackageManager().canRequestPackageInstalls();

        new Thread(() -> {
            try {
                OkHttpClient client = createUpdateHttpClient(12);
                Request req = new Request.Builder()
                    .url(manifestUrl)
                    .header("Cache-Control", "no-cache")
                    .header("Accept", "application/json")
                    .build();
                try (Response res = client.newCall(req).execute()) {
                    if (!res.isSuccessful() || res.body() == null) {
                        JSObject result = new JSObject();
                        result.put("supported", true);
                        result.put("updateAvailable", false);
                        result.put("installedVersionCode", installedCode);
                        result.put("installedVersionName", installedName);
                        result.put("canRequestPackageInstalls", canInstall);
                        call.resolve(result);
                        return;
                    }
                    String body = res.body().string();
                    JSONObject json = new JSONObject(body);
                    long remoteCode = json.optLong("versionCode", json.optLong("build", 0L));
                    String remoteName = json.optString("version", "");
                    String apkUrl = json.optString("apkUrl", APP_UPDATE_ALLOWED_PREFIX + "releases/latest/download/myIPON.apk");
                    if (!apkUrl.startsWith(APP_UPDATE_ALLOWED_PREFIX)) {
                        apkUrl = APP_UPDATE_ALLOWED_PREFIX + "releases/latest/download/myIPON.apk";
                    }
                    boolean available = installedCode > 0 && remoteCode > installedCode;
                    JSObject result = new JSObject();
                    result.put("supported", true);
                    result.put("updateAvailable", available);
                    result.put("installedVersionCode", installedCode);
                    result.put("installedVersionName", installedName);
                    result.put("remoteVersionCode", remoteCode);
                    result.put("remoteVersionName", remoteName);
                    result.put("apkUrl", apkUrl);
                    result.put("canRequestPackageInstalls", canInstall);
                    call.resolve(result);
                }
            } catch (Throwable err) {
                call.reject("Could not check for app updates: " + err.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void downloadAndInstallAppUpdate(PluginCall call) {
        Activity activity = getActivity();
        Context ctx = activity != null ? activity : getContext();
        if (ctx == null) {
            call.reject("App context is unavailable.");
            return;
        }
        String rawUrl = call.getString("url", APP_UPDATE_ALLOWED_PREFIX + "releases/latest/download/myIPON.apk");
        String apkUrl = TextUtils.isEmpty(rawUrl) ? (APP_UPDATE_ALLOWED_PREFIX + "releases/latest/download/myIPON.apk") : rawUrl.trim();
        if (!apkUrl.startsWith(APP_UPDATE_ALLOWED_PREFIX)) {
            call.reject("Untrusted update download URL.");
            return;
        }
        boolean closeAfterPrompt = !Boolean.FALSE.equals(call.getBoolean("closeAfterPrompt", true));
        boolean forceInstall = Boolean.TRUE.equals(call.getBoolean("force", false));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            emitAppUpdateProgress("permission_required", 0, 0L, 0L, "Allow installing updates for myIPON.");
            try {
                Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(permIntent);
            } catch (Throwable ignored) { }
            JSObject result = new JSObject();
            result.put("status", "permission_required");
            result.put("canRequestPackageInstalls", false);
            call.resolve(result);
            return;
        }

        if (!updateInProgress.compareAndSet(false, true)) {
            JSObject result = new JSObject();
            result.put("status", "in_progress");
            call.resolve(result);
            return;
        }

        long installedCode = getInstalledVersionCode(ctx);
        emitAppUpdateProgress("downloading", 0, 0L, 0L, "Downloading latest update...");

        new Thread(() -> {
            File updateDir = new File(ctx.getCacheDir(), "updates");
            File partFile = new File(updateDir, "myIPON.apk.part");
            File apkFile = new File(updateDir, "myIPON.apk");
            try {
                if (!updateDir.exists() && !updateDir.mkdirs()) {
                    throw new IllegalStateException("Could not prepare update folder.");
                }
                if (partFile.exists()) partFile.delete();

                OkHttpClient client = createUpdateHttpClient(90);
                Request req = new Request.Builder()
                    .url(apkUrl)
                    .header("Cache-Control", "no-cache")
                    .build();
                try (Response res = client.newCall(req).execute()) {
                    if (!res.isSuccessful() || res.body() == null) {
                        throw new IllegalStateException("Download failed (HTTP " + res.code() + ").");
                    }
                    ResponseBody body = res.body();
                    long totalBytes = body.contentLength();
                    long downloaded = 0L;
                    long lastEmitMs = 0L;
                    int lastPct = -1;
                    byte[] buffer = new byte[16384];
                    try (InputStream in = body.byteStream(); FileOutputStream out = new FileOutputStream(partFile)) {
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                            downloaded += read;
                            int pct = totalBytes > 0 ? (int) Math.min(99, (downloaded * 100L) / totalBytes) : -1;
                            long nowMs = System.currentTimeMillis();
                            if (nowMs - lastEmitMs >= 150 || (pct >= 0 && pct >= lastPct + 2)) {
                                lastEmitMs = nowMs;
                                lastPct = pct;
                                emitAppUpdateProgress("downloading", Math.max(0, pct), downloaded, totalBytes, "");
                            }
                        }
                        out.flush();
                    }
                }

                if (apkFile.exists()) apkFile.delete();
                if (!partFile.renameTo(apkFile)) {
                    throw new IllegalStateException("Could not finalize update package.");
                }

                PackageInfo archiveInfo = ctx.getPackageManager().getPackageArchiveInfo(apkFile.getAbsolutePath(), 0);
                if (archiveInfo == null || !ctx.getPackageName().equals(archiveInfo.packageName)) {
                    apkFile.delete();
                    throw new IllegalStateException("Downloaded update package is invalid.");
                }
                long archiveCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? archiveInfo.getLongVersionCode()
                    : (long) archiveInfo.versionCode;
                if (!forceInstall && installedCode > 0 && archiveCode > 0 && archiveCode <= installedCode) {
                    apkFile.delete();
                    JSObject already = new JSObject();
                    already.put("status", "up_to_date");
                    call.resolve(already);
                    return;
                }

                emitAppUpdateProgress("installing", 100, apkFile.length(), apkFile.length(), "Opening installer and closing app...");

                Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile);
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        ctx.startActivity(installIntent);
                        JSObject result = new JSObject();
                        result.put("status", "installing");
                        result.put("closing", closeAfterPrompt);
                        call.resolve(result);
                        if (closeAfterPrompt && activity != null) {
                            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                try { activity.finishAffinity(); } catch (Throwable ignored) { }
                            }, 900L);
                        }
                    } catch (Throwable launchErr) {
                        call.reject("Could not launch installer: " + launchErr.getMessage());
                    }
                });
            } catch (Throwable err) {
                if (partFile.exists()) partFile.delete();
                call.reject(err.getMessage() != null ? err.getMessage() : "Could not download update.");
            } finally {
                updateInProgress.set(false);
            }
        }).start();
    }

    @PluginMethod
    public void closeAppForUpdate(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            JSObject res = new JSObject();
            res.put("closed", false);
            call.resolve(res);
            return;
        }
        activity.runOnUiThread(() -> {
            JSObject res = new JSObject();
            res.put("closed", true);
            call.resolve(res);
            try { activity.finishAffinity(); } catch (Throwable ignored) { }
        });
    }

    @PluginMethod
    public void openAuthBrowser(PluginCall call) {
        String state = call.getString("appState", "");
        Activity activity = getActivity();
        if (activity == null || !state.matches("[a-f0-9]{32}")) {
            call.reject("App sign-in is not ready. Reopen myIPON and try again.");
            return;
        }
        Uri.Builder url = Uri.parse("https://my-ipon.vercel.app/login.html").buildUpon()
            .appendQueryParameter("app", "1")
            .appendQueryParameter("app_handoff", "1")
            .appendQueryParameter("app_state", state)
            .appendQueryParameter("start_google", "1");
        if (Boolean.TRUE.equals(call.getBoolean("signup", false))) {
            url.appendQueryParameter("mode", "signup");
        }
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, url.build()));
            call.resolve();
        } catch (Throwable error) {
            call.reject("Could not open Google sign-in in your browser.");
        }
    }

    @PluginMethod
    public void consumeAuthCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("payload", getActivity() instanceof MainActivity
            ? ((MainActivity) getActivity()).consumePendingAuthCallback() : "");
        call.resolve(result);
    }

    private static boolean isOAuthHost(String host) {
        if (TextUtils.isEmpty(host)) return false;
        String h = host.toLowerCase(Locale.US);
        return "accounts.google.com".equals(h)
            || h.endsWith(".clerk.accounts.dev")
            || "clerk.accounts.dev".equals(h)
            || h.startsWith("clerk.")
            || "www.facebook.com".equals(h)
            || "m.facebook.com".equals(h)
            || "facebook.com".equals(h);
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null) return null;
        if (!"https".equalsIgnoreCase(url.getScheme()) || !isOAuthHost(url.getHost())) {
            return null;
        }
        Activity activity = getActivity();
        Context ctx = activity != null ? activity : getContext();
        if (ctx == null) return null;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            Bundle customTabsExtras = new Bundle();
            customTabsExtras.putBinder("android.support.customtabs.extra.SESSION", null);
            intent.putExtras(customTabsExtras);
            intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", Color.parseColor("#0b3428"));
            intent.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            }
            return Boolean.TRUE;
        } catch (Throwable err) {
            try {
                Intent fallback = new Intent(Intent.ACTION_VIEW, url);
                if (activity == null) fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                return Boolean.TRUE;
            } catch (Throwable ignored) {
                return null;
            }
        }
    }
    @PluginMethod
    public void configure(PluginCall call) {
        String supabaseUrl = call.getString("supabaseUrl");
        String anonKey = call.getString("anonKey");
        String feedToken = call.getString("feedToken");
        if (TextUtils.isEmpty(supabaseUrl) || TextUtils.isEmpty(anonKey) || TextUtils.isEmpty(feedToken)) {
            call.reject("Missing notification configuration.");
            return;
        }

        Context context = getContext();
        NotificationPollReceiver.ensureChannel(context);

        SharedPreferences prefs = context.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        String previousFeedToken = prefs.getString("feed_token", "");
        SharedPreferences.Editor editor = prefs.edit()
            .putString("supabase_url", supabaseUrl)
            .putString("anon_key", anonKey)
            .putString("feed_token", feedToken);
        if (call.hasOption("instantSync")) {
            editor.putBoolean("instant_sync_enabled", Boolean.TRUE.equals(call.getBoolean("instantSync", true)));
        }
        editor.apply();
        if (!TextUtils.equals(previousFeedToken, feedToken) && !TextUtils.isEmpty(previousFeedToken)) {
            FirebaseMessaging.getInstance().unsubscribeFromTopic("notif-" + previousFeedToken);
        }
        FirebaseMessaging.getInstance().subscribeToTopic("notif-" + feedToken);

        JSArray shownArray = call.getArray("shownIds");
        if (shownArray != null) {
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < shownArray.length(); i++) {
                String value = shownArray.optString(i, "");
                if (!TextUtils.isEmpty(value)) ids.add(value);
            }
            NotificationPollReceiver.mergeShownIds(context, ids);
        }

        NotificationSyncService.ensureStarted(context);
        NotificationSyncService.pokeOrReconnect(context);
        NotificationSyncWorker.ensureScheduled(context);
        NotificationPollReceiver.scheduleNext(context, 20_000L);
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || TextUtils.isEmpty(task.getResult())) {
                Exception error = task.getException();
                call.reject(error != null && !TextUtils.isEmpty(error.getMessage())
                    ? "Firebase registration failed: " + error.getMessage()
                    : "Firebase did not provide a device token. Check Google Play services and retry.");
                return;
            }
            JSObject result = new JSObject();
            result.put("fcmToken", task.getResult());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void markShown(PluginCall call) {
        String id = call.getString("id");
        if (!TextUtils.isEmpty(id)) {
            List<String> ids = new ArrayList<>();
            ids.add(id);
            NotificationPollReceiver.mergeShownIds(getContext(), ids);
        }
        call.resolve();
    }

    @PluginMethod
    public void showNotification(PluginCall call) {
        String id = call.getString("id", "");
        String dedupeKey = call.getString("dedupeKey", "");
        String shownKey = call.getString("shownKey", "");
        String type = call.getString("type", "");
        String title = call.getString("title", "myIPON");
        String body = call.getString("body", "");
        String link = call.getString("link", "dashboard.html");
        String avatarUrl = call.getString("avatarUrl", "");
        if (TextUtils.isEmpty(id) && TextUtils.isEmpty(dedupeKey)) {
            call.reject("Missing notification identifier.");
            return;
        }
        NotificationPollReceiver.showDirectNotificationAsync(
            getContext(),
            id,
            dedupeKey,
            shownKey,
            type,
            title,
            body,
            link,
            avatarUrl
        );
        JSObject result = new JSObject();
        result.put("shown", true);
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext();
        String feedToken = context.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, Context.MODE_PRIVATE)
            .getString("feed_token", "");
        if (!TextUtils.isEmpty(feedToken)) FirebaseMessaging.getInstance().unsubscribeFromTopic("notif-" + feedToken);
        NotificationSyncService.stop(context);
        NotificationSyncWorker.cancel(context);
        NotificationPollReceiver.cancel(context);
        context.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove("feed_token")
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void setInstantSync(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        Context context = getContext();
        context.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("instant_sync_enabled", enabled)
            .apply();
        if (enabled) {
            NotificationSyncService.ensureStarted(context);
        } else {
            NotificationSyncService.stop(context);
        }
        JSObject result = new JSObject();
        result.put("instantSyncEnabled", enabled);
        result.put("instantSyncRunning", NotificationSyncService.isRunning());
        call.resolve(result);
    }

    @PluginMethod
    public void getBackgroundStatus(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        boolean hasPerm = NotificationPollReceiver.hasNotificationPermission(context);
        boolean batteryIgnored = NotificationPollReceiver.isBatteryOptimizationIgnored(context);
        JSObject result = new JSObject();
        result.put("hasPermission", hasPerm);
        result.put("batteryOptimizationIgnored", batteryIgnored);
        result.put("instantSyncEnabled", NotificationPollReceiver.isInstantSyncEnabled(context));
        result.put("instantSyncRunning", NotificationSyncService.isRunning());
        result.put("wsConnected", NotificationSyncService.isWsConnected());
        result.put("hasFeedConfig", NotificationPollReceiver.hasFeedConfig(context));
        result.put("lastPollHttpCode", prefs.getInt("last_poll_http_code", 0));
        result.put("lastPollError", prefs.getString("last_poll_error", ""));
        result.put("lastServiceError", prefs.getString("last_service_error", ""));
        result.put("lastWsError", prefs.getString("last_ws_error", ""));
        result.put("androidSdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        boolean launched = false;
        boolean alreadyIgnored = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            alreadyIgnored = pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
            if (!alreadyIgnored && getActivity() != null) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    getActivity().startActivity(intent);
                    launched = true;
                } catch (Throwable ignored) {
                    try {
                        Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        getActivity().startActivity(fallback);
                        launched = true;
                    } catch (Throwable ignored2) {
                        try {
                            Intent appInfo = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                .setData(Uri.parse("package:" + context.getPackageName()));
                            getActivity().startActivity(appInfo);
                            launched = true;
                        } catch (Throwable ignored3) {
                        }
                    }
                }
            }
        }
        JSObject result = new JSObject();
        result.put("launched", launched);
        result.put("alreadyIgnored", alreadyIgnored);
        call.resolve(result);
    }

    @PluginMethod
    public void requestSystemPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null) {
            ActivityCompat.requestPermissions(
                getActivity(),
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                1001
            );
        }
        JSObject result = new JSObject();
        result.put("requested", true);
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        boolean launched = false;
        if (getActivity() != null) {
            try {
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + context.getPackageName()));
                }
                getActivity().startActivity(intent);
                launched = true;
            } catch (Throwable ignored) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + context.getPackageName()));
                    getActivity().startActivity(fallback);
                    launched = true;
                } catch (Throwable ignored2) {
                }
            }
        }
        JSObject result = new JSObject();
        result.put("launched", launched);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Context context = getContext();
        boolean launched = false;
        if (getActivity() != null) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + context.getPackageName()));
                getActivity().startActivity(intent);
                launched = true;
            } catch (Throwable ignored) {
            }
        }
        JSObject result = new JSObject();
        result.put("launched", launched);
        call.resolve(result);
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String url = call.getString("url", "");
        String fileName = call.getString("fileName", "");
        String mimeType = call.getString("mimeType", "");
        try {
            JSObject result = enqueueSystemDownload(getContext(), url, fileName, mimeType);
            call.resolve(result);
        } catch (Throwable err) {
            call.reject(err.getMessage() != null ? err.getMessage() : "Could not download file.");
        }
    }

    @PluginMethod
    public void printPage(PluginCall call) {
        final String jobName = call.getString("jobName", "myIPON Report");
        final Activity activity = getActivity();
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (activity == null || webView == null) {
            call.reject("Print view is unavailable.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    call.reject("Android Print service is unavailable.");
                    return;
                }
                String cleanJob = TextUtils.isEmpty(jobName) ? "myIPON Report" : jobName.trim();
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(cleanJob);
                printManager.print(cleanJob, adapter, new PrintAttributes.Builder().build());
                JSObject result = new JSObject();
                result.put("started", true);
                result.put("jobName", cleanJob);
                call.resolve(result);
            } catch (Throwable err) {
                call.reject(err.getMessage() != null ? err.getMessage() : "Could not open print dialog.");
            }
        });
    }

    static String sanitizeDownloadName(String requestedName, String rawUrl, String mimeType) {
        String base = TextUtils.isEmpty(requestedName)
            ? URLUtil.guessFileName(rawUrl, null, mimeType)
            : requestedName;
        String clean = base.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]+", "-").replaceAll("^[.\\s-]+", "").trim();
        if (TextUtils.isEmpty(clean)) clean = "myipon-attachment";
        if (!clean.contains(".") && !TextUtils.isEmpty(mimeType)) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            if (!TextUtils.isEmpty(ext)) clean = clean + "." + ext;
        }
        return clean;
    }

    static JSObject enqueueSystemDownload(Context context, String rawUrl, String requestedName, String requestedMime) throws Exception {
        if (context == null || TextUtils.isEmpty(rawUrl)) {
            throw new IllegalArgumentException("Missing download link.");
        }
        String url = rawUrl.trim();
        if (url.startsWith("data:")) {
            int commaIdx = url.indexOf(',');
            if (commaIdx < 0) throw new IllegalArgumentException("Invalid file payload.");
            String meta = url.substring(5, commaIdx);
            String payload = url.substring(commaIdx + 1);
            String detectedMime = requestedMime;
            if (TextUtils.isEmpty(detectedMime)) {
                int semiIdx = meta.indexOf(';');
                String candidate = semiIdx >= 0 ? meta.substring(0, semiIdx) : meta;
                if (!TextUtils.isEmpty(candidate)) detectedMime = candidate;
            }
            if (TextUtils.isEmpty(detectedMime)) detectedMime = "application/octet-stream";
            String safeName = sanitizeDownloadName(requestedName, url, detectedMime);
            byte[] bytes = meta.contains(";base64")
                ? Base64.decode(payload, Base64.DEFAULT)
                : Uri.decode(payload).getBytes();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = context.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, detectedMime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("Could not create download entry.");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("Could not open download stream.");
                    out.write(bytes);
                    out.flush();
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null || (!dir.exists() && !dir.mkdirs()) || !dir.canWrite()) {
                    dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                }
                if (dir != null && !dir.exists()) dir.mkdirs();
                File outFile = new File(dir, safeName);
                try (FileOutputStream out = new FileOutputStream(outFile)) {
                    out.write(bytes);
                    out.flush();
                }
            }
            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("started", true);
            result.put("fileName", safeName);
            return result;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new IllegalArgumentException("Unsupported download URL.");
        }
        String safeName = sanitizeDownloadName(requestedName, url, requestedMime);
        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) throw new IllegalStateException("Download manager unavailable.");
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle(safeName);
        req.setDescription("Downloading from myIPON");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setAllowedOverMetered(true);
        req.setAllowedOverRoaming(true);
        if (!TextUtils.isEmpty(requestedMime)) {
            req.setMimeType(requestedMime);
        }
        try {
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName);
        } catch (SecurityException ignored) {
            req.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, safeName);
        }
        long id = dm.enqueue(req);
        JSObject result = new JSObject();
        result.put("started", true);
        result.put("saved", false);
        result.put("fileName", safeName);
        result.put("downloadId", id);
        return result;
    }
}
