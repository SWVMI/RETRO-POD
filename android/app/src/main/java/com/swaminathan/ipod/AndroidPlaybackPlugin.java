package com.swaminathan.ipod;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AndroidPlayback")
public class AndroidPlaybackPlugin extends Plugin {
    private static final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void hasTrack(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("Track name is required");
            return;
        }

        long expectedSize = call.getData().optLong("size", -1L);
        long expectedModified = call.getData().optLong("lastModified", -1L);
        fileExecutor.execute(() -> {
            try {
                JSONObject metadata = getContext().getSharedPreferences("native_music", 0)
                        .getJSONObject("track_" + trackKey(name), new JSONObject());
                File trackFile = trackFile(name);
                boolean matches = trackFile.isFile()
                        && trackFile.length() == expectedSize
                        && metadata.optLong("lastModified", -2L) == expectedModified;
                JSObject result = new JSObject();
                result.put("exists", matches);
                call.resolve(result);
            } catch (Exception error) {
                Log.e("RetroPod", "Unable to check native track", error);
                call.reject("Unable to check native music storage", error);
            }
        });
    }

    @PluginMethod
    public void appendTrackChunk(PluginCall call) {
        String name = call.getString("name");
        String chunk = call.getString("chunk");
        if (name == null || name.isEmpty() || chunk == null) {
            call.reject("Track name and chunk data are required");
            return;
        }

        boolean first = call.getBoolean("first", false);
        boolean last = call.getBoolean("last", false);
        long size = call.getData().optLong("size", -1L);
        long lastModified = call.getData().optLong("lastModified", -1L);
        String title = call.getString("title", name);
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        fileExecutor.execute(() -> {
            File temporary = new File(getContext().getFilesDir(), trackKey(name) + ".part");
            File destination = trackFile(name);
            try {
                if (first && temporary.exists() && !temporary.delete()) {
                    throw new IOException("Unable to replace the temporary track file");
                }
                byte[] bytes = Base64.decode(chunk, Base64.DEFAULT);
                try (FileOutputStream output = new FileOutputStream(temporary, !first)) {
                    output.write(bytes);
                    output.getFD().sync();
                }

                if (last) {
                    if (size >= 0 && temporary.length() != size) {
                        throw new IOException("Imported track size does not match");
                    }
                    if (destination.exists() && !destination.delete()) {
                        throw new IOException("Unable to replace the existing track");
                    }
                    if (!temporary.renameTo(destination)) {
                        throw new IOException("Unable to finalize the imported track");
                    }
                    JSONObject metadata = new JSONObject();
                    metadata.put("name", name);
                    metadata.put("title", title);
                    metadata.put("artist", artist);
                    metadata.put("album", album);
                    metadata.put("size", destination.length());
                    metadata.put("lastModified", lastModified);
                    getContext().getSharedPreferences("native_music", 0)
                            .edit()
                            .putString("track_" + trackKey(name), metadata.toString())
                            .apply();
                }
                call.resolve();
            } catch (Exception error) {
                Log.e("RetroPod", "Unable to import native track " + name, error);
                temporary.delete();
                call.reject("Unable to copy track into Android music storage", error);
            }
        });
    }

    @PluginMethod
    public void removeTrack(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("Track name is required");
            return;
        }
        fileExecutor.execute(() -> {
            File track = trackFile(name);
            if (track.exists() && !track.delete()) {
                call.reject("Unable to remove track from Android music storage");
                return;
            }
            getContext().getSharedPreferences("native_music", 0)
                    .edit()
                    .remove("track_" + trackKey(name))
                    .apply();
            call.resolve();
        });
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        String tracks = call.getString("tracks");
        if (tracks == null) {
            call.reject("A playback queue is required");
            return;
        }
        try {
            JSONArray parsed = new JSONArray(tracks);
            if (parsed.length() == 0) {
                call.reject("The playback queue is empty");
                return;
            }
            Intent intent = new Intent(getContext(), PlaybackKeepAliveService.class)
                    .setAction(PlaybackKeepAliveService.ACTION_SET_QUEUE)
                    .putExtra(PlaybackKeepAliveService.EXTRA_QUEUE, tracks)
                    .putExtra(PlaybackKeepAliveService.EXTRA_INDEX, call.getInt("index", 0))
                    .putExtra(PlaybackKeepAliveService.EXTRA_REPEAT_START_INDEX,
                            call.getInt("repeatStartIndex", 0))
                    .putExtra(PlaybackKeepAliveService.EXTRA_REPEAT_MODE, call.getString("repeatMode", "all"))
                    .putExtra(PlaybackKeepAliveService.EXTRA_SHUFFLE, call.getBoolean("shuffle", false))
                    .putExtra(PlaybackKeepAliveService.EXTRA_SPEED,
                            (float) call.getData().optDouble("speed", 1d));
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (JSONException error) {
            call.reject("The playback queue is invalid", error);
        }
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        boolean playing = call.getBoolean("playing", false);
        startService(serviceIntent(playing
                ? PlaybackKeepAliveService.ACTION_PLAY : PlaybackKeepAliveService.ACTION_PAUSE), call);
    }

    @PluginMethod
    public void next(PluginCall call) {
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_NEXT), call);
    }

    @PluginMethod
    public void previous(PluginCall call) {
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_PREVIOUS), call);
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        double position = call.getDouble("position", 0d);
        Intent intent = serviceIntent(PlaybackKeepAliveService.ACTION_SEEK)
                .putExtra(PlaybackKeepAliveService.EXTRA_POSITION, position);
        startService(intent, call);
    }

    @PluginMethod
    public void setPlaybackSpeed(PluginCall call) {
        float speed = (float) call.getData().optDouble("speed", 1d);
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_SPEED)
                .putExtra(PlaybackKeepAliveService.EXTRA_SPEED, speed), call);
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String repeatMode = call.getString("repeatMode");
        if (!"off".equals(repeatMode) && !"one".equals(repeatMode) && !"all".equals(repeatMode)) {
            call.reject("Unsupported repeat mode");
            return;
        }
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_REPEAT)
                .putExtra(PlaybackKeepAliveService.EXTRA_REPEAT_MODE, repeatMode), call);
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_SHUFFLE)
                .putExtra(PlaybackKeepAliveService.EXTRA_SHUFFLE, call.getBoolean("shuffle", false)), call);
    }

    @PluginMethod
    public void setEqualizer(PluginCall call) {
        String gains = call.getString("gains");
        if (gains == null) {
            call.reject("Five equalizer gains are required");
            return;
        }
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_EQUALIZER)
                .putExtra(PlaybackKeepAliveService.EXTRA_GAINS, gains), call);
    }

    @PluginMethod
    public void setSleepTimer(PluginCall call) {
        long endAt = call.getLong("endAt", 0L);
        boolean fade = call.getBoolean("fade", true);
        startService(serviceIntent(PlaybackKeepAliveService.ACTION_SLEEP_TIMER)
                .putExtra(PlaybackKeepAliveService.EXTRA_SLEEP_END_AT, endAt)
                .putExtra(PlaybackKeepAliveService.EXTRA_SLEEP_FADE, fade), call);
    }

    @PluginMethod
    public void queryState(PluginCall call) {
        android.content.SharedPreferences preferences = getContext()
                .getSharedPreferences("native_playback", 0);
        JSObject result = new JSObject();
        try {
            JSONArray queue = new JSONArray(preferences.getString("queue", "[]"));
            int index = Math.max(0, Math.min(preferences.getInt("index", 0), queue.length() - 1));
            JSONObject current = queue.length() == 0 ? new JSONObject() : queue.getJSONObject(index);
            result.put("fileName", current.optString("fileName", ""));
            result.put("title", current.optString("title", ""));
            result.put("artist", current.optString("artist", ""));
            result.put("album", current.optString("album", ""));
            result.put("playing", preferences.getBoolean("playing", false));
            result.put("position", preferences.getLong("position", 0L));
            result.put("duration", preferences.getLong("duration", 0L));
            result.put("index", index);
            call.resolve(result);
        } catch (JSONException error) {
            call.reject("Unable to read Android playback state", error);
        }
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

    private void startService(Intent intent, PluginCall call) {
        getContext().startService(intent);
        call.resolve();
    }

    private Intent serviceIntent(String action) {
        return new Intent(getContext(), PlaybackKeepAliveService.class).setAction(action);
    }

    private File trackFile(String name) {
        return new File(getContext().getFilesDir(), trackKey(name) + ".audio");
    }

    private static String trackKey(String name) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte value : digest) result.append(String.format("%02x", value));
            return result.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }
}
