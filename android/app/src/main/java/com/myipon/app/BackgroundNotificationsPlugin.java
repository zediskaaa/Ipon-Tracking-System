package com.myipon.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
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
        prefs.edit()
            .putString("supabase_url", supabaseUrl)
            .putString("anon_key", anonKey)
            .putString("feed_token", feedToken)
            .apply();

        JSArray shownArray = call.getArray("shownIds");
        if (shownArray != null) {
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < shownArray.length(); i++) {
                String value = shownArray.optString(i, "");
                if (!TextUtils.isEmpty(value)) ids.add(value);
            }
            NotificationPollReceiver.mergeShownIds(context, ids);
        }

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
        NotificationPollReceiver.cancel(context);
        context.getSharedPreferences(NotificationPollReceiver.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove("feed_token")
            .apply();
        call.resolve();
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
}
