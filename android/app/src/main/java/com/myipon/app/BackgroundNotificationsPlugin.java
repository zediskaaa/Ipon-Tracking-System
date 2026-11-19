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
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
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
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "BackgroundNotifications",
    permissions = {
        @Permission(
            strings = { Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS },
            alias = "microphone"
        )
    }
)
public class BackgroundNotificationsPlugin extends Plugin {
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
        call.resolve();
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
        boolean micManifestDeclared = hasManifestPermission(context, Manifest.permission.RECORD_AUDIO);
        boolean micPermissionGranted = micManifestDeclared
            && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("hasPermission", hasPerm);
        result.put("batteryOptimizationIgnored", batteryIgnored);
        result.put("micManifestDeclared", micManifestDeclared);
        result.put("micPermissionGranted", micPermissionGranted);
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

    private static boolean hasManifestPermission(Context context, String permission) {
        if (context == null || TextUtils.isEmpty(permission)) return false;
        try {
            PackageManager pm = context.getPackageManager();
            PackageInfo info = Build.VERSION.SDK_INT >= 33
                ? pm.getPackageInfo(
                    context.getPackageName(),
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS)
                )
                : pm.getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS);
            if (info != null && info.requestedPermissions != null) {
                for (String declared : info.requestedPermissions) {
                    if (permission.equals(declared)) return true;
                }
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    @PluginMethod
    public void ensureMicrophonePermission(PluginCall call) {
        Context context = getContext();
        if (!hasManifestPermission(context, Manifest.permission.RECORD_AUDIO)) {
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("state", "missing_manifest");
            result.put("canAskAgain", false);
            result.put("manifestDeclared", false);
            result.put("manifestMissing", true);
            call.resolve(result);
            return;
        }
        boolean hasAudio = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
        if (hasAudio) {
            JSObject result = new JSObject();
            result.put("granted", true);
            result.put("state", "granted");
            result.put("canAskAgain", true);
            result.put("manifestDeclared", true);
            result.put("manifestMissing", false);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermsCallback");
    }

    @PermissionCallback
    private void microphonePermsCallback(PluginCall call) {
        if (call == null) return;
        Context context = getContext();
        boolean hasAudio = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
        PermissionState state = getPermissionState("microphone");
        boolean rationale = getActivity() != null
            && ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.RECORD_AUDIO);
        boolean canAskAgain = hasAudio || rationale || state != PermissionState.DENIED;
        JSObject result = new JSObject();
        result.put("granted", hasAudio);
        result.put("state", hasAudio ? "granted" : (state != null ? state.toString() : "denied"));
        result.put("canAskAgain", canAskAgain);
        result.put("manifestDeclared", true);
        result.put("manifestMissing", false);
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
