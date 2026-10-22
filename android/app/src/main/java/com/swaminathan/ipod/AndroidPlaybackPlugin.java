package com.swaminathan.ipod;

import android.content.pm.ActivityInfo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidPlayback")
public class AndroidPlaybackPlugin extends Plugin {

    @PluginMethod
    public void setPlaybackActive(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            activity.syncPlaybackNotification();
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
