package com.myipon.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import androidx.annotation.NonNull;

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
        NotificationPollReceiver.pollWithWakeLock(this);
    }
}
