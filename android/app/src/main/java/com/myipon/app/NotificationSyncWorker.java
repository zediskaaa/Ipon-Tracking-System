package com.myipon.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

public class NotificationSyncWorker extends Worker {
    private static final String WORK_NAME = "myipon_notification_sync_work";

    public NotificationSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void ensureScheduled(Context context) {
        Context appContext = context.getApplicationContext();
        if (!NotificationPollReceiver.hasFeedConfig(appContext)) return;
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                NotificationSyncWorker.class,
                15,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build();

            WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            );
        } catch (Throwable ignored) {
        }
    }

    public static void cancel(Context context) {
        try {
            WorkManager workManager = WorkManager.getInstance(context.getApplicationContext());
            workManager.cancelUniqueWork(WORK_NAME);
            workManager.cancelUniqueWork(WORK_NAME + "_once");
        } catch (Throwable ignored) {
        }
    }

    public static void enqueueImmediateSync(Context context, long delaySeconds) {
        Context appContext = context.getApplicationContext();
        if (!NotificationPollReceiver.hasFeedConfig(appContext)) return;
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NotificationSyncWorker.class)
                .setInitialDelay(Math.max(5L, delaySeconds), TimeUnit.SECONDS)
                .setConstraints(constraints)
                .build();
            WorkManager.getInstance(appContext).enqueueUniqueWork(
                WORK_NAME + "_once",
                ExistingWorkPolicy.REPLACE,
                request
            );
        } catch (Throwable ignored) {
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        Context appContext = getApplicationContext();
        if (!NotificationPollReceiver.hasFeedConfig(appContext)) {
            return Result.success();
        }
        if (NotificationSyncService.canStartFromBackground(appContext)) {
            NotificationSyncService.ensureStarted(appContext);
        }
        NotificationPollReceiver.pollWithWakeLock(appContext);
        NotificationPollReceiver.scheduleNext(appContext, NotificationPollReceiver.recommendedPollIntervalMs(appContext));
        return Result.success();
    }
}

