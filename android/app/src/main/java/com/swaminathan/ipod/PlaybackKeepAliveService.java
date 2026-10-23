package com.swaminathan.ipod;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.audiofx.Equalizer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class PlaybackKeepAliveService extends Service {
    static final String ACTION_SET_QUEUE = "com.swaminathan.ipod.SET_QUEUE";
    static final String ACTION_PLAY = "com.swaminathan.ipod.PLAY";
    static final String ACTION_PAUSE = "com.swaminathan.ipod.PAUSE";
    static final String ACTION_NEXT = "com.swaminathan.ipod.NEXT";
    static final String ACTION_PREVIOUS = "com.swaminathan.ipod.PREVIOUS";
    static final String ACTION_SEEK = "com.swaminathan.ipod.SEEK";
    static final String ACTION_SPEED = "com.swaminathan.ipod.SPEED";
    static final String ACTION_EQUALIZER = "com.swaminathan.ipod.EQUALIZER";
    static final String ACTION_QUERY = "com.swaminathan.ipod.QUERY";
    static final String ACTION_REPEAT = "com.swaminathan.ipod.REPEAT";
    static final String ACTION_SHUFFLE = "com.swaminathan.ipod.SHUFFLE";
    static final String ACTION_SLEEP_TIMER = "com.swaminathan.ipod.SLEEP_TIMER";
    static final String EXTRA_QUEUE = "queue";
    static final String EXTRA_INDEX = "index";
    static final String EXTRA_REPEAT_START_INDEX = "repeatStartIndex";
    static final String EXTRA_REPEAT_MODE = "repeatMode";
    static final String EXTRA_SPEED = "speed";
    static final String EXTRA_POSITION = "position";
    static final String EXTRA_GAINS = "gains";
    static final String EXTRA_SHUFFLE = "shuffle";
    static final String EXTRA_SLEEP_END_AT = "sleepEndAt";
    static final String EXTRA_SLEEP_FADE = "sleepFade";
    private static final String CHANNEL_ID = "retropod_playback";
    private static final int NOTIFICATION_ID = 1042;
    private static final String PREFERENCES = "native_playback";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<JSONObject> queue = new ArrayList<>();
    private final Set<Integer> playedIndices = new HashSet<>();
    private final float[] equalizerGains = new float[] {0, 0, 0, 0, 0};
    private MediaPlayer player;
    private Equalizer equalizer;
    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private int index;
    private int repeatStartIndex;
    private String repeatMode = "all";
    private boolean shuffle;
    private String title = "RetroPod";
    private String artist = "";
    private String album = "";
    private float speed = 1f;
    private long pendingPosition;
    private boolean playing;
    private boolean prepared;
    private long sleepTimerEndAt;
    private boolean sleepFadeEnabled = true;

    private final Runnable positionUpdater = new Runnable() {
        @Override
        public void run() {
            if (player == null || !prepared) return;
            persistState();
            updatePlaybackState();
            publishState();
            handler.postDelayed(this, 1000);
        }
    };

    private final Runnable sleepTimerUpdater = new Runnable() {
        @Override
        public void run() {
            if (sleepTimerEndAt <= 0) return;
            long remaining = sleepTimerEndAt - System.currentTimeMillis();
            if (remaining <= 0) {
                sleepTimerEndAt = 0;
                if (player != null && prepared) {
                    if (player.isPlaying()) pendingPosition = player.getCurrentPosition();
                    player.pause();
                    player.setVolume(1f, 1f);
                }
                playing = false;
                persistState();
                updatePlaybackState();
                updateNotification();
                publishState();
                return;
            }
            if (sleepFadeEnabled && remaining <= 10_000 && player != null && prepared) {
                float volume = Math.max(0f, Math.min(1f, remaining / 10_000f));
                player.setVolume(volume, volume);
            }
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        createNotificationChannel();
        restoreState();
        if (sleepTimerEndAt > 0) handler.post(sleepTimerUpdater);
        mediaSession = new MediaSessionCompat(this, "RetroPod");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { advance(1); }
            @Override public void onSkipToPrevious() { skipPrevious(); }
            @Override public void onSeekTo(long position) { seekTo(position); }
        });
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_SET_QUEUE.equals(action)) {
            setQueue(intent);
        } else if (ACTION_PLAY.equals(action)) {
            play();
        } else if (ACTION_PAUSE.equals(action)) {
            pause();
        } else if (ACTION_NEXT.equals(action)) {
            advance(1);
        } else if (ACTION_PREVIOUS.equals(action)) {
            skipPrevious();
        } else if (ACTION_SEEK.equals(action)) {
            seekTo(intent.getLongExtra(EXTRA_POSITION, 0L));
        } else if (ACTION_SPEED.equals(action)) {
            setSpeed(intent.getFloatExtra(EXTRA_SPEED, 1f));
        } else if (ACTION_EQUALIZER.equals(action)) {
            setEqualizerGains(intent.getStringExtra(EXTRA_GAINS));
        } else if (ACTION_REPEAT.equals(action)) {
            repeatMode = intent.getStringExtra(EXTRA_REPEAT_MODE);
            if (repeatMode == null) repeatMode = "all";
            persistState();
        } else if (ACTION_SHUFFLE.equals(action)) {
            shuffle = intent.getBooleanExtra(EXTRA_SHUFFLE, false);
            persistState();
        } else if (ACTION_SLEEP_TIMER.equals(action)) {
            sleepTimerEndAt = Math.max(0, intent.getLongExtra(EXTRA_SLEEP_END_AT, 0L));
            sleepFadeEnabled = intent.getBooleanExtra(EXTRA_SLEEP_FADE, true);
            if (player != null && prepared) player.setVolume(1f, 1f);
            handler.removeCallbacks(sleepTimerUpdater);
            if (sleepTimerEndAt > 0) handler.post(sleepTimerUpdater);
            persistState();
        } else if (ACTION_QUERY.equals(action)) {
            publishState();
            return START_NOT_STICKY;
        } else if (intent == null && playing && !queue.isEmpty()) {
            showForeground(buildNotification());
            if (mediaSession != null) mediaSession.setActive(true);
            startCurrentTrack(pendingPosition);
        }
        if (intent != null && player == null && playing && !queue.isEmpty()
                && !ACTION_PAUSE.equals(action) && !ACTION_NEXT.equals(action)
                && !ACTION_PREVIOUS.equals(action) && !ACTION_SET_QUEUE.equals(action)) {
            showForeground(buildNotification());
            if (mediaSession != null) mediaSession.setActive(true);
            startCurrentTrack(pendingPosition);
        }
        return START_STICKY;
    }

    private void setQueue(Intent intent) {
        try {
            JSONArray tracks = new JSONArray(intent.getStringExtra(EXTRA_QUEUE));
            queue.clear();
            for (int i = 0; i < tracks.length(); i++) queue.add(tracks.getJSONObject(i));
            if (queue.isEmpty()) {
                stopPlayback();
                stopSelf();
                return;
            }
            index = Math.max(0, Math.min(intent.getIntExtra(EXTRA_INDEX, 0), queue.size() - 1));
            repeatMode = intent.getStringExtra(EXTRA_REPEAT_MODE);
            if (repeatMode == null) repeatMode = "all";
            speed = intent.getFloatExtra(EXTRA_SPEED, 1f);
            repeatStartIndex = Math.max(0, Math.min(
                    intent.getIntExtra(EXTRA_REPEAT_START_INDEX, 0), queue.size()));
            shuffle = intent.getBooleanExtra(EXTRA_SHUFFLE, false);
            playedIndices.clear();
            playedIndices.add(index);
            playing = true;
            pendingPosition = 0;
            persistState();
            showForeground(buildNotification());
            if (mediaSession != null) mediaSession.setActive(true);
            startCurrentTrack(0);
        } catch (JSONException error) {
            Log.e("RetroPod", "Invalid Android playback queue", error);
            stopPlayback();
            stopSelf();
        }
    }

    private void startCurrentTrack(long position) {
        releasePlayer();
        if (queue.isEmpty() || index < 0 || index >= queue.size()) {
            stopPlayback();
            return;
        }
        JSONObject track = queue.get(index);
        String fileName = track.optString("fileName", "");
        File audioFile = new File(getFilesDir(), trackKey(fileName) + ".audio");
        if (fileName.isEmpty() || !audioFile.isFile()) {
            Log.e("RetroPod", "Missing Android audio file for " + fileName);
            playing = false;
            publishState();
            updateNotification();
            persistState();
            return;
        }
        title = track.optString("title", fileName);
        artist = track.optString("artist", "");
        album = track.optString("album", "");
        pendingPosition = Math.max(0, position);
        prepared = false;
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
            player.setWakeMode(getApplicationContext(), android.os.PowerManager.PARTIAL_WAKE_LOCK);
            player.setOnPreparedListener(mediaPlayer -> {
                prepared = true;
                mediaPlayer.setPlaybackParams(mediaPlayer.getPlaybackParams().setSpeed(speed));
                configureEqualizer(mediaPlayer.getAudioSessionId());
                if (pendingPosition > 0 && pendingPosition < mediaPlayer.getDuration()) {
                    mediaPlayer.seekTo((int) pendingPosition);
                }
                if (playing) {
                    if (requestAudioFocus()) {
                        mediaPlayer.start();
                    } else {
                        playing = false;
                    }
                }
                pendingPosition = 0;
                updateMediaMetadata();
                updatePlaybackState();
                updateNotification();
                persistState();
                publishState();
                handler.removeCallbacks(positionUpdater);
                handler.post(positionUpdater);
            });
            player.setOnCompletionListener(mediaPlayer -> advance(1, true));
            player.setOnErrorListener((mediaPlayer, what, extra) -> {
                Log.e("RetroPod", "Native audio playback failed: " + what + "/" + extra);
                playing = false;
                pendingPosition = 0;
                persistState();
                updatePlaybackState();
                updateNotification();
                publishState();
                return true;
            });
            player.setDataSource(audioFile.getAbsolutePath());
            player.prepareAsync();
            updateMediaMetadata();
            updatePlaybackState();
            updateNotification();
        } catch (Exception error) {
            Log.e("RetroPod", "Unable to prepare native audio", error);
            playing = false;
            persistState();
            publishState();
        }
    }

    private void play() {
        if (queue.isEmpty()) restoreState();
        if (queue.isEmpty()) {
            stopSelf();
            return;
        }
        playing = true;
        if (player != null && prepared) {
            if (!requestAudioFocus()) {
                playing = false;
                updatePlaybackState();
                updateNotification();
                persistState();
                publishState();
                return;
            }
            player.start();
            updatePlaybackState();
            updateNotification();
            handler.removeCallbacks(positionUpdater);
            handler.post(positionUpdater);
        } else {
            showForeground(buildNotification());
            startCurrentTrack(pendingPosition);
        }
        persistState();
        publishState();
    }

    private void pause() {
        playing = false;
        if (player != null && prepared && player.isPlaying()) {
            pendingPosition = player.getCurrentPosition();
            player.pause();
        }
        abandonAudioFocus();
        handler.removeCallbacks(positionUpdater);
        updatePlaybackState();
        updateNotification();
        persistState();
        publishState();
    }

    private void advance(int direction) {
        advance(direction, false);
    }

    private void advance(int direction, boolean trackEnded) {
        if (queue.isEmpty()) {
            restoreState();
            if (queue.isEmpty()) return;
        }
        if (trackEnded && "one".equals(repeatMode)) {
            pendingPosition = 0;
            startCurrentTrack(0);
            return;
        }
        int next = index + direction;
        if (direction > 0 && shuffle) {
            if (index + 1 < repeatStartIndex) {
                next = index + 1;
            } else {
                List<Integer> candidates = new ArrayList<>();
                for (int candidate = repeatStartIndex; candidate < queue.size(); candidate++) {
                    if (!playedIndices.contains(candidate)) candidates.add(candidate);
                }
                if (candidates.isEmpty() && "all".equals(repeatMode)) {
                    for (int candidate = repeatStartIndex; candidate < queue.size(); candidate++) {
                        candidates.add(candidate);
                    }
                    playedIndices.clear();
                    playedIndices.add(index);
                }
                if (candidates.isEmpty()) {
                    pause();
                    return;
                }
                next = candidates.get((int) (Math.random() * candidates.size()));
            }
            playedIndices.add(next);
        }
        if (direction > 0 && next >= queue.size()) {
            if ("all".equals(repeatMode) && repeatStartIndex < queue.size()) next = repeatStartIndex;
            else {
                pause();
                return;
            }
        } else if (direction < 0 && next < 0) {
            next = "all".equals(repeatMode) ? queue.size() - 1 : 0;
        }
        index = next;
        pendingPosition = 0;
        playing = true;
        persistState();
        showForeground(buildNotification());
        if (mediaSession != null) mediaSession.setActive(true);
        startCurrentTrack(0);
    }

    private void skipPrevious() {
        if (player != null && prepared && player.getCurrentPosition() > 3000) {
            seekTo(0);
        } else {
            advance(-1);
        }
    }

    private void seekTo(long position) {
        long bounded = Math.max(0, position);
        if (player != null && prepared) {
            bounded = Math.min(bounded, player.getDuration());
            player.seekTo((int) bounded);
        }
        pendingPosition = bounded;
        updatePlaybackState();
        publishState();
        persistState();
    }

    private void setSpeed(float value) {
        speed = Math.max(0.5f, Math.min(2f, value));
        if (player != null && prepared) {
            try {
                player.setPlaybackParams(player.getPlaybackParams().setSpeed(speed));
            } catch (IllegalArgumentException error) {
                Log.e("RetroPod", "Unable to set native playback speed", error);
            }
        }
        persistState();
    }

    private void setEqualizerGains(String json) {
        try {
            JSONArray gains = new JSONArray(json);
            if (gains.length() != equalizerGains.length) return;
            for (int i = 0; i < equalizerGains.length; i++) {
                equalizerGains[i] = (float) Math.max(-12, Math.min(12, gains.getDouble(i)));
            }
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                    .putString("equalizer", gains.toString()).apply();
            if (player != null && prepared) configureEqualizer(player.getAudioSessionId());
        } catch (JSONException error) {
            Log.e("RetroPod", "Invalid equalizer gains", error);
        }
    }

    private void configureEqualizer(int audioSessionId) {
        try {
            if (equalizer != null) equalizer.release();
            equalizer = new Equalizer(0, audioSessionId);
            short bands = equalizer.getNumberOfBands();
            short[] range = equalizer.getBandLevelRange();
            boolean enabled = false;
            for (int i = 0; i < equalizerGains.length; i++) {
                short band = (short) Math.round((double) i * (bands - 1) / (equalizerGains.length - 1));
                short level = (short) Math.max(range[0], Math.min(range[1], Math.round(equalizerGains[i] * 100)));
                equalizer.setBandLevel(band, level);
                enabled |= equalizerGains[i] != 0;
            }
            equalizer.setEnabled(enabled);
        } catch (Exception error) {
            Log.e("RetroPod", "Unable to attach Android equalizer", error);
        }
    }

    private boolean requestAudioFocus() {
        if (audioManager == null) return true;
        AudioManager.OnAudioFocusChangeListener listener = focusChange -> {
            if (focusChange <= AudioManager.AUDIOFOCUS_LOSS_TRANSIENT && playing) pause();
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build())
                    .setOnAudioFocusChangeListener(listener)
                    .build();
            return audioManager.requestAudioFocus(audioFocusRequest)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        return audioManager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        }
    }

    private void updateMediaMetadata() {
        if (mediaSession == null) return;
        long duration = player != null && prepared ? player.getDuration()
                : queue.isEmpty() ? 0 : queue.get(index).optLong("duration", 0);
        MediaMetadataCompat metadata = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
                .build();
        mediaSession.setMetadata(metadata);
    }

    private void updatePlaybackState() {
        if (mediaSession == null) return;
        long position = player != null && prepared ? player.getCurrentPosition() : pendingPosition;
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SEEK_TO;
        PlaybackStateCompat state = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(
                        playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        position,
                        playing ? speed : 0f,
                        SystemClock.elapsedRealtime()
                )
                .build();
        mediaSession.setPlaybackState(state);
    }

    private Notification buildNotification() {
        Intent openApp = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = openApp == null ? null : PendingIntent.getActivity(
                this, 0, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(artist.isEmpty() ? "RetroPod" : artist)
                .setSubText(album)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(contentIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .addAction(android.R.drawable.ic_media_previous, "Previous", actionIntent(ACTION_PREVIOUS, 1))
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play", actionIntent(playing ? ACTION_PAUSE : ACTION_PLAY, 2))
                .addAction(android.R.drawable.ic_media_next, "Next", actionIntent(ACTION_NEXT, 3));
        if (mediaSession != null) {
            builder.setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
        }
        return builder.build();
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaActionReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(this, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void showForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Music playback", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Playback controls and current track information");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void restoreState() {
        android.content.SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        String storedQueue = preferences.getString("queue", "[]");
        try {
            JSONArray tracks = new JSONArray(storedQueue);
            queue.clear();
            for (int i = 0; i < tracks.length(); i++) queue.add(tracks.getJSONObject(i));
        } catch (JSONException error) {
            Log.e("RetroPod", "Unable to restore native playback queue", error);
        }
        index = Math.max(0, Math.min(preferences.getInt("index", 0), Math.max(0, queue.size() - 1)));
        repeatStartIndex = preferences.getInt("repeatStartIndex", 0);
        repeatMode = preferences.getString("repeatMode", "all");
        speed = preferences.getFloat("speed", 1f);
        shuffle = preferences.getBoolean("shuffle", false);
        sleepTimerEndAt = preferences.getLong("sleepTimerEndAt", 0L);
        sleepFadeEnabled = preferences.getBoolean("sleepFadeEnabled", true);
        playedIndices.clear();
        if (!queue.isEmpty()) playedIndices.add(index);
        playing = preferences.getBoolean("playing", false);
        pendingPosition = preferences.getLong("position", 0L);
        try {
            JSONArray gains = new JSONArray(preferences.getString("equalizer", "[0,0,0,0,0]"));
            for (int i = 0; i < equalizerGains.length && i < gains.length(); i++) {
                equalizerGains[i] = (float) gains.getDouble(i);
            }
        } catch (JSONException error) {
            Log.e("RetroPod", "Unable to restore native equalizer", error);
        }
        if (!queue.isEmpty()) {
            JSONObject track = queue.get(index);
            title = track.optString("title", track.optString("fileName", "RetroPod"));
            artist = track.optString("artist", "");
            album = track.optString("album", "");
        }
    }

    private void persistState() {
        if (!queue.isEmpty()) {
            JSONArray tracks = new JSONArray();
            for (JSONObject track : queue) tracks.put(track);
            long position = player != null && prepared ? player.getCurrentPosition() : pendingPosition;
            long duration = player != null && prepared
                    ? player.getDuration() : queue.get(index).optLong("duration", 0L);
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                    .putString("queue", tracks.toString())
                    .putInt("index", index)
                    .putInt("repeatStartIndex", repeatStartIndex)
                    .putString("repeatMode", repeatMode)
                    .putBoolean("shuffle", shuffle)
                    .putFloat("speed", speed)
                    .putBoolean("playing", playing)
                    .putLong("position", position)
                    .putLong("duration", duration)
                    .putLong("sleepTimerEndAt", sleepTimerEndAt)
                    .putBoolean("sleepFadeEnabled", sleepFadeEnabled)
                    .apply();
        } else {
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                    .putLong("sleepTimerEndAt", sleepTimerEndAt)
                    .putBoolean("sleepFadeEnabled", sleepFadeEnabled)
                    .apply();
        }
    }

    private void publishState() {
        JSONObject state = new JSONObject();
        try {
            JSONObject current = queue.isEmpty() ? new JSONObject() : queue.get(index);
            state.put("fileName", current.optString("fileName", ""));
            state.put("title", current.optString("title", title));
            state.put("artist", current.optString("artist", artist));
            state.put("album", current.optString("album", album));
            state.put("playing", playing);
            state.put("position", player != null && prepared ? player.getCurrentPosition() : pendingPosition);
            state.put("duration", player != null && prepared ? player.getDuration() : current.optLong("duration", 0));
            state.put("index", index);
        } catch (JSONException error) {
            Log.e("RetroPod", "Unable to publish playback state", error);
        }
        MainActivity.dispatchPlaybackState(state.toString());
    }

    private void releasePlayer() {
        handler.removeCallbacks(positionUpdater);
        prepared = false;
        if (equalizer != null) {
            equalizer.release();
            equalizer = null;
        }
        if (player != null) {
            player.setOnPreparedListener(null);
            player.setOnCompletionListener(null);
            player.setOnErrorListener(null);
            player.release();
            player = null;
        }
    }

    private void stopPlayback() {
        playing = false;
        pendingPosition = 0;
        releasePlayer();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
                    .setState(PlaybackStateCompat.STATE_STOPPED, 0, 0).build());
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        publishState();
    }

    private static String trackKey(String name) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte value : digest) result.append(String.format("%02x", value));
            return result.toString();
        } catch (Exception error) {
            throw new IllegalStateException("Unable to identify local track", error);
        }
    }

    @Override
    public void onDestroy() {
        long position = player != null && prepared ? player.getCurrentPosition() : pendingPosition;
        pendingPosition = position;
        persistState();
        releasePlayer();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
