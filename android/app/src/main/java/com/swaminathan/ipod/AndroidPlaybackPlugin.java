package com.swaminathan.ipod;

import android.content.Intent;
import android.content.pm.ActivityInfo;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidPlayback")
public class AndroidPlaybackPlugin extends Plugin {

    @PluginMethod
    public void setPlaybackActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active"));
        Intent intent = new Intent(getContext(), PlaybackKeepAliveService.class);

        if (active) {
            ContextCompat.startForegroundService(getContext(), intent);
        } else {
            getContext().stopService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String orientation = call.getString("orientation");
        final int requestedOrientation;
        if ("landscape".equals(orientation)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equals(orientation)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        } else {
            call.reject("Unsupported orientation");
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(requestedOrientation);
            call.resolve();
        });
    }
}
