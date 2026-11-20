package com.myipon.app;

import android.text.TextUtils;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import androidx.annotation.NonNull;
import java.util.Collections;

public class MyIponMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if (!NotificationPollReceiver.hasFeedConfig(this)
            || !NotificationPollReceiver.hasNotificationPermission(this)) return;
        if ("true".equals(message.getData().get("test"))) {
            NotificationPollReceiver.showDirectNotification(this,
                "test-" + System.currentTimeMillis(), "MYIPON_TEST_ALERT",
                "myIPON background alerts ready",
                "Notifications arrive on this device even when myIPON is closed.", "account.html");
            return;
        }
        RemoteMessage.Notification notification = message.getNotification();
        if (notification != null) {
            String id = message.getData().get("notification_id");
            if (TextUtils.isEmpty(id)) return;
            String dedupeKey = message.getData().get("dedupe_key");
            String notifType = message.getData().get("notification_type");
            String title = notification.getTitle();
            if (NotificationPollReceiver.isMessageNotification(notifType, dedupeKey, title)) {
                NotificationPollReceiver.pollWithWakeLock(this);
                return;
            }
            String shownKey = message.getData().get("shown_key");
            NotificationPollReceiver.showDirectNotification(this, id,
                dedupeKey, notifType, title,
                notification.getBody(), message.getData().get("notification_link"),
                message.getData().get("actor_avatar_url"));
            if (!TextUtils.isEmpty(shownKey)) {
                NotificationPollReceiver.mergeShownIds(this, Collections.singletonList(shownKey));
            }
            return;
        }
        NotificationPollReceiver.pollWithWakeLock(this);
    }

    @Override
    public void onDeletedMessages() {
        if (NotificationPollReceiver.hasFeedConfig(this)
            && NotificationPollReceiver.hasNotificationPermission(this)) {
            NotificationPollReceiver.pollWithWakeLock(this);
        }
    }
}
