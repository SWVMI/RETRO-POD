package com.swaminathan.ipod;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile MainActivity instance;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
        instance = this;
        requestNotificationPermission();
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        goImmersive();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    1001
            );
        }
    }

    public static void dispatchPlaybackState(String state) {
        MainActivity activity = instance;
        if (activity == null || activity.getBridge() == null) return;
        String script = "window.dispatchEvent(new CustomEvent('native-playback-state',{detail:JSON.parse("
                + org.json.JSONObject.quote(state) + ")}));";
        activity.runOnUiThread(() -> {
            if (activity.getBridge() != null) {
                activity.getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-hide the system bars if the user swipes them back into view -
        // this is the same "sticky immersive" behavior games use.
        if (hasFocus) {
            goImmersive();
        }
    }

    private void goImmersive() {
        // Let our content draw behind the system bars (required for a true
        // edge-to-edge look, and mandatory behavior on Android 15+ / SDK 35+
        // where the OS ignores the old fullscreen flags otherwise).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}
