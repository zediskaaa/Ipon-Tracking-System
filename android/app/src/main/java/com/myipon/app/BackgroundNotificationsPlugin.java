package com.myipon.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.TextUtils;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "BackgroundNotifications")
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
        SharedPreferences.Editor editor = prefs.edit()
            .putString("supabase_url", supabaseUrl)
            .putString("anon_key", anonKey)
            .putString("feed_token", feedToken);
        if (call.hasOption("instantSync")) {
            editor.putBoolean("instant_sync_enabled", Boolean.TRUE.equals(call.getBoolean("instantSync", true)));
        }
        editor.apply();

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
        NotificationSyncWorker.ensureScheduled(context);
        NotificationPollReceiver.scheduleNext(context, 45_000L);
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
        boolean hasPerm = NotificationPollReceiver.hasNotificationPermission(context);
        boolean batteryIgnored = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                batteryIgnored = pm.isIgnoringBatteryOptimizations(context.getPackageName());
            }
        }
        JSObject result = new JSObject();
        result.put("hasPermission", hasPerm);
        result.put("batteryOptimizationIgnored", batteryIgnored);
        result.put("instantSyncEnabled", NotificationPollReceiver.isInstantSyncEnabled(context));
        result.put("instantSyncRunning", NotificationSyncService.isRunning());
        result.put("androidSdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        boolean launched = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            boolean alreadyIgnored = pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
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
                    }
                }
            }
        }
        JSObject result = new JSObject();
        result.put("launched", launched);
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
}
