package com.mywallet.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class NotificationService extends Service {
    public static final String CHANNEL_ID = "mywallet_notifications";

    public NotificationService() { }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_NOT_STICKY;
    }

    public static void createChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "محفظتي - تنبيهات",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("تنبيهات الميزانية والمعاملات");
            nm.createNotificationChannel(channel);
        }
    }
}
