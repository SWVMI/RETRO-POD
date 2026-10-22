package com.swaminathan.ipod;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class MediaActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if ("play".equals(action) || "pause".equals(action)
                || "previous".equals(action) || "next".equals(action)) {
            MainActivity.dispatchMediaAction(action);
        }
    }
}
