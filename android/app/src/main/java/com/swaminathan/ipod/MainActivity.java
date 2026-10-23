package com.swaminathan.ipod;

import android.webkit.JavascriptInterface;
import android.os.Bundle;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile MainActivity instance;
    private volatile long metadataGeneration;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
        instance = this;
        getBridge().getWebView().addJavascriptInterface(new PlaybackMetadataBridge(), "RetroPodMedia");
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        goImmersive();
    }

    synchronized void syncPlaybackNotification() {
        long generation = ++metadataGeneration;
        String script = "(function(){"
                + "var m=navigator.mediaSession&&navigator.mediaSession.metadata;"
                + "if(!m){window.RetroPodMedia.update('{\"clear\":true,\"generation\":"
                + generation + "}');return;}"
                + "var send=function(art){try{window.RetroPodMedia.update(JSON.stringify({"
                + "title:m.title||'Unknown track',artist:m.artist||'',album:m.album||'',"
                + "playing:navigator.mediaSession.playbackState==='playing',artwork:art||'',generation:"
                + generation
                + "}));}catch(e){}};"
                + "var src=m.artwork&&m.artwork.length?m.artwork[0].src:'';"
                + "if(!src){send('');return;}"
                + "send('');"
                + "fetch(src).then(function(r){return r.blob();}).then(function(blob){"
                + "return createImageBitmap(blob);}).then(function(bitmap){"
                + "var scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));"
                + "var canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));"
                + "canvas.height=Math.max(1,Math.round(bitmap.height*scale));"
                + "canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);"
                + "var data=canvas.toDataURL('image/jpeg',0.82);bitmap.close();send(data);"
                + "}).catch(function(){send('');});"
                + "})()";
        runOnUiThread(() -> {
            if (getBridge() != null) {
                getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    public static void dispatchMediaAction(String action) {
        MainActivity activity = instance;
        if (activity == null || activity.getBridge() == null) return;

        String selector;
        if ("previous".equals(action)) {
            selector = "button[aria-label='Previous song']";
        } else if ("next".equals(action)) {
            selector = "button[aria-label='Next song']";
        } else if ("play".equals(action)) {
            selector = "button[aria-label='Play song'],button[aria-label='Resume playback']";
        } else if ("pause".equals(action)) {
            selector = "button[aria-label='Pause song'],button[aria-label='Pause playback']";
        } else {
            return;
        }

        String script = "(function(){var b=document.querySelector(\"" + selector + "\");"
                + "if(!b||b.disabled)return false;b.click();return true;})()";
        activity.runOnUiThread(() -> {
            if (activity.getBridge() != null) {
                activity.getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    @Override
    public void onDestroy() {
        if (getBridge() != null) {
            getBridge().getWebView().removeJavascriptInterface("RetroPodMedia");
        }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    private final class PlaybackMetadataBridge {
        @JavascriptInterface
        public void update(String serializedMetadata) {
            try {
                JSONObject metadata = new JSONObject(serializedMetadata);
                long generation = metadata.optLong("generation", -1);
                if (generation != metadataGeneration) return;
                if (metadata.optBoolean("clear", false)) {
                    stopService(new android.content.Intent(
                            MainActivity.this, PlaybackKeepAliveService.class
                    ));
                    return;
                }

                android.content.Intent intent = new android.content.Intent(
                        MainActivity.this, PlaybackKeepAliveService.class
                );
                intent.setAction(PlaybackKeepAliveService.ACTION_UPDATE);
                intent.putExtra(PlaybackKeepAliveService.EXTRA_TITLE, metadata.optString("title"));
                intent.putExtra(PlaybackKeepAliveService.EXTRA_ARTIST, metadata.optString("artist"));
                intent.putExtra(PlaybackKeepAliveService.EXTRA_ALBUM, metadata.optString("album"));
                intent.putExtra(PlaybackKeepAliveService.EXTRA_PLAYING, metadata.optBoolean("playing", false));
                intent.putExtra(PlaybackKeepAliveService.EXTRA_ARTWORK, metadata.optString("artwork"));
                ContextCompat.startForegroundService(MainActivity.this, intent);
            } catch (Exception ignored) {
                stopService(new android.content.Intent(
                        MainActivity.this, PlaybackKeepAliveService.class
                ));
            }
        }
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
