package com.swaminathan.ipod;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.util.Base64;

import androidx.core.app.NotificationCompat;

public class PlaybackKeepAliveService extends Service {
    static final String ACTION_UPDATE = "com.swaminathan.ipod.UPDATE_PLAYBACK_NOTIFICATION";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_ALBUM = "album";
    static final String EXTRA_PLAYING = "playing";
    static final String EXTRA_ARTWORK = "artwork";
    static final String CHANNEL_ID = "retropod_playback";
    private static final int NOTIFICATION_ID = 1042;

    private PowerManager.WakeLock wakeLock;
    private MediaSession mediaSession;
    private String title = "RetroPod";
    private String artist = "";
    private String album = "";
    private Bitmap artwork;
    private boolean playing;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        mediaSession = new MediaSession(this, "RetroPod");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                handleAction("play");
            }

            @Override
            public void onPause() {
                handleAction("pause");
            }

            @Override
            public void onSkipToPrevious() {
                handleAction("previous");
            }

            @Override
            public void onSkipToNext() {
                handleAction("next");
            }
        });
        mediaSession.setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_UPDATE.equals(intent.getAction())) {
            title = intent.getStringExtra(EXTRA_TITLE);
            artist = intent.getStringExtra(EXTRA_ARTIST);
            album = intent.getStringExtra(EXTRA_ALBUM);
            playing = intent.getBooleanExtra(EXTRA_PLAYING, false);
            artwork = decodeArtwork(intent.getStringExtra(EXTRA_ARTWORK));
        }
        updateMediaSession();
        updateNotification();
        if (playing) acquireWakeLock(); else releaseWakeLock();
        return START_NOT_STICKY;
    }

    private void updateNotification() {
        Intent openApp = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = openApp == null ? null : PendingIntent.getActivity(
                this,
                0,
                openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent previous = actionPendingIntent("previous", 1);
        PendingIntent toggle = actionPendingIntent(playing ? "pause" : "play", 2);
        PendingIntent next = actionPendingIntent("next", 3);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(artist.isEmpty() ? "RetroPod" : artist)
                .setSubText(album)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setLargeIcon(artwork)
                .setContentIntent(pendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_previous, "Previous", previous)
                .addAction(
                        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play",
                        toggle
                )
                .addAction(android.R.drawable.ic_media_next, "Next", next)
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2))
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private PendingIntent actionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaActionReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void updateMediaSession() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        }
        mediaSession.setMetadata(metadata.build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SKIP_TO_NEXT;
        PlaybackState state = new PlaybackState.Builder()
                .setActions(actions)
                .setState(
                        playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                        playing ? 1.0f : 0.0f
                )
                .build();
        mediaSession.setPlaybackState(state);
    }

    private Bitmap decodeArtwork(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith("data:image/")) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0) return null;
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (decoded == null) return null;
            float scale = Math.min(1f, 512f / Math.max(decoded.getWidth(), decoded.getHeight()));
            Bitmap scaled = Bitmap.createScaledBitmap(
                    decoded,
                    Math.max(1, Math.round(decoded.getWidth() * scale)),
                    Math.max(1, Math.round(decoded.getHeight() * scale)),
                    true
            );
            if (scaled != decoded) decoded.recycle();
            return scaled;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private void handleAction(String action) {
        if ("play".equals(action)) playing = true;
        else if ("pause".equals(action)) playing = false;
        updateMediaSession();
        updateNotification();
        if (playing) acquireWakeLock(); else releaseWakeLock();
        MainActivity.dispatchMediaAction(action);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RetroPod:Playback");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Audio playback",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps local music playback active in the background");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.cancel(NOTIFICATION_ID);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
