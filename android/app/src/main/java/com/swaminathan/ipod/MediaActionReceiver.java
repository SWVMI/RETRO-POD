package com.swaminathan.ipod;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

public class MediaActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String serviceAction;
        if (PlaybackKeepAliveService.ACTION_PLAY.equals(action)) {
            serviceAction = PlaybackKeepAliveService.ACTION_PLAY;
        } else if (PlaybackKeepAliveService.ACTION_PAUSE.equals(action)) {
            serviceAction = PlaybackKeepAliveService.ACTION_PAUSE;
        } else if (PlaybackKeepAliveService.ACTION_PREVIOUS.equals(action)) {
            serviceAction = PlaybackKeepAliveService.ACTION_PREVIOUS;
        } else if (PlaybackKeepAliveService.ACTION_NEXT.equals(action)) {
            serviceAction = PlaybackKeepAliveService.ACTION_NEXT;
        } else {
            return;
        }
        ContextCompat.startForegroundService(
                context,
                new Intent(context, PlaybackKeepAliveService.class)
                        .setAction(serviceAction)
                        .putExtra(PlaybackKeepAliveService.EXTRA_START_FOREGROUND, true)
        );
    }
}
