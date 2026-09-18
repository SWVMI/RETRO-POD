import {
  Innertube,
  UniversalCache,
  Platform,
  Types,
  Constants,
  YT,
} from "youtubei.js";

import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

Platform.shim.eval = async (
  data: Types.BuildScriptResult
) => {
  return new Function(data.output)();
};

let youtube: Innertube | null = null;

function generateCpn(length = 16): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
}

export async function getYouTube() {
  if (!youtube) {
    youtube = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true,
    });
  }

  return youtube;
}

export type YouTubeTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  thumbnail: string;
  source: "youtube";
};

function thumbnailFrom(item: any): string {
  const thumbnails =
    item?.thumbnails ||
    item?.thumbnail?.thumbnails ||
    item?.video_thumbnails ||
    [];

  return (
    thumbnails[thumbnails.length - 1]?.url ||
    thumbnails[0]?.url ||
    ""
  );
}

function durationFrom(item: any): number {
  if (typeof item?.duration === "number") {
    return item.duration;
  }

  if (typeof item?.duration?.seconds === "number") {
    return item.duration.seconds;
  }

  if (typeof item?.duration?.text === "string") {
    const parts = item.duration.text
      .split(":")
      .map(Number);

    if (parts.length === 3) {
      return (
        parts[0] * 3600 +
        parts[1] * 60 +
        parts[2]
      );
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  return 0;
}

function mapVideo(
  item: any
): YouTubeTrack | null {
  const id =
    item?.id ||
    item?.video_id ||
    item?.endpoint?.payload?.videoId;

  if (!id) {
    return null;
  }

  return {
    id,
    title:
      item?.title?.text ||
      item?.title ||
      "Unknown",
    artist:
      item?.author?.name ||
      item?.author?.text ||
      item?.artists?.[0]?.name ||
      "YouTube",
    album:
      item?.album?.name ||
      "YouTube",
    duration: durationFrom(item),
    thumbnail: thumbnailFrom(item),
    source: "youtube",
  };
}

/* ---------------------------------------------------------
   SEARCH
--------------------------------------------------------- */

export async function searchYouTube(
  query: string
) {
  const yt = await getYouTube();

  const result = await yt.search(query, {
    type: "video",
  });

  const videos: YouTubeTrack[] = [];

  for (const item of result.results || []) {
    const mapped = mapVideo(item);

    if (mapped) {
      videos.push(mapped);
    }
  }

  return videos;
}

/* ---------------------------------------------------------
   SABR STREAMING
--------------------------------------------------------- */

export async function createYouTubeSabrStream(
  videoId: string
) {
  const yt = await getYouTube();

  console.log(
    `[YouTube SABR] Getting video info for ${videoId}`
  );

  const info = await yt.getBasicInfo(videoId, {
    client: "MWEB",
  });

  if (!info.streaming_data) {
    throw new Error(
      "YouTube did not return streaming data."
    );
  }

  const streamingData = info.streaming_data;

  const rawSabrUrl =
    streamingData.server_abr_streaming_url;

  if (
    typeof rawSabrUrl !== "string" ||
    rawSabrUrl.length === 0
  ) {
    throw new Error(
      "YouTube did not return a server ABR streaming URL."
    );
  }

  if (!yt.actions.session.player) {
    throw new Error(
      "YouTube session player is not available (retrieve_player must be enabled)."
    );
  }

  const sabrUrl = await yt.actions.session.player.decipher(rawSabrUrl);

  if (
    typeof sabrUrl !== "string" ||
    sabrUrl.length === 0
  ) {
    throw new Error(
      "Unable to decipher the YouTube SABR streaming URL."
    );
  }

  const sabrFormats =
    streamingData.adaptive_formats.map(
      (format: any) =>
        buildSabrFormat(format)
    );

  if (!sabrFormats.length) {
    throw new Error(
      "YouTube returned no SABR-compatible formats."
    );
  }

  const audioFormats =
    sabrFormats.filter((format: any) =>
      String(format.mimeType || "").startsWith(
        "audio/"
      )
    );

  const videoFormats =
    sabrFormats.filter((format: any) =>
      String(format.mimeType || "").startsWith(
        "video/"
      )
    );

  if (!audioFormats.length) {
    throw new Error(
      "YouTube returned no audio formats."
    );
  }

  if (!videoFormats.length) {
    throw new Error(
      "YouTube returned no video formats required by SABR."
    );
  }

  const clientInfo = {
    osName: yt.session.context.client.osName,
    osVersion: yt.session.context.client.osVersion,
    clientName: parseInt(
      Constants.CLIENT_NAME_IDS[
        yt.session.context.client
          .clientName as keyof typeof Constants.CLIENT_NAME_IDS
      ]
    ),
    clientVersion:
      yt.session.context.client.clientVersion,
  };

  const ustreamerConfig =
    info.player_config
      ?.media_common_config
      ?.media_ustreamer_request_config
      ?.video_playback_ustreamer_config;

  if (
    typeof ustreamerConfig !== "string" ||
    ustreamerConfig.length === 0
  ) {
    throw new Error(
      "YouTube did not provide a Ustreamer configuration."
    );
  }

  const selectedAudio =
    audioFormats
      .filter((format: any) =>
        String(format.mimeType || "").includes(
          "webm"
        )
      )
      .sort(
        (a: any, b: any) =>
          (b.bitrate || 0) -
          (a.bitrate || 0)
      )[0] ||
    audioFormats
      .slice()
      .sort(
        (a: any, b: any) =>
          (b.bitrate || 0) -
          (a.bitrate || 0)
      )[0];

  const selectedVideo =
    videoFormats
      .slice()
      .sort(
        (a: any, b: any) =>
          (b.height || 0) -
          (a.height || 0)
      )[0];

  const sabr =
    new SabrStream({
      fetch: globalThis.fetch,
      serverAbrStreamingUrl: sabrUrl,
      videoPlaybackUstreamerConfig:
        ustreamerConfig,
      clientInfo,
      formats: sabrFormats,
      durationMs:
        info.basic_info?.duration
          ? Number(
              info.basic_info.duration
            ) * 1000
          : undefined,
    });

  /*
   * IMPORTANT:
   *
   * YouTube can ask the SABR client to reload
   * its player response while playback is active.
   *
   * Without handling this event, playback can
   * eventually stop even though the original SABR
   * stream was valid.
   */
  sabr.on(
    "reloadPlayerResponse",
    async (
      reloadPlaybackContext: any
    ) => {
      try {
        console.log(
          `[YouTube SABR] Reloading player response for ${videoId}`
        );

        const reloadedResponse =
          await yt.actions.execute(
            "/player",
            {
              videoId,
              contentCheckOk: true,
              racyCheckOk: true,
              playbackContext: {
                contentPlaybackContext: {
                  signatureTimestamp:
                    yt.session.player
                      ?.signature_timestamp,
                },
                reloadPlaybackContext,
              },
            }
          );

       const reloadedInfo =
  new YT.VideoInfo(
    [reloadedResponse],
    yt.actions,
    generateCpn(16)
  );

        const newRawSabrUrl =
          reloadedInfo.streaming_data
            ?.server_abr_streaming_url;

        if (
          typeof newRawSabrUrl !== "string" ||
          !newRawSabrUrl
        ) {
          throw new Error(
            "Reloaded player response did not contain a SABR URL."
          );
        }

        if (!yt.actions.session.player) {
          throw new Error(
            "YouTube session player is not available for reload."
          );
        }

        const newSabrUrl =
          await yt.actions.session.player.decipher(newRawSabrUrl);

        if (
          typeof newSabrUrl !== "string" ||
          !newSabrUrl
        ) {
          throw new Error(
            "Unable to decipher reloaded SABR URL."
          );
        }

        sabr.setStreamingURL(
          newSabrUrl
        );

        const newUstreamerConfig =
          reloadedInfo.player_config
            ?.media_common_config
            ?.media_ustreamer_request_config
            ?.video_playback_ustreamer_config;

        if (
          typeof newUstreamerConfig ===
            "string" &&
          newUstreamerConfig.length > 0
        ) {
          sabr.setUstreamerConfig(
            newUstreamerConfig
          );
        }

        if (
          reloadedInfo.streaming_data
            ?.adaptive_formats
        ) {
          sabr.setServerAbrFormats(
            reloadedInfo.streaming_data
              .adaptive_formats.map(
                (format: any) =>
                  buildSabrFormat(format)
              )
          );
        }

        console.log(
          `[YouTube SABR] Player response reloaded successfully for ${videoId}`
        );
      } catch (error) {
        console.error(
          `[YouTube SABR] Failed to reload player response for ${videoId}:`,
          error
        );
      }
    }
  );

  const result =
    await sabr.start({
      videoFormat: selectedVideo,
      audioFormat: selectedAudio,
      enabledTrackTypes: 1,
      preferWebM: true,
      preferOpus: true,
      maxRetries: 10,
    });

  return {
    stream: result.audioStream,
    mimeType:
      selectedAudio.mimeType ||
      "audio/webm",
    duration:
      info.basic_info?.duration
        ? Number(
            info.basic_info.duration
          )
        : undefined,
    sabr,
  };
}

/* ---------------------------------------------------------
   PLAYLIST
--------------------------------------------------------- */

export async function getYouTubePlaylist(
  playlistId: string
) {
  const yt = await getYouTube();

  const playlist =
    await yt.getPlaylist(playlistId);

  const items: YouTubeTrack[] = [];

  for (
    const item of playlist.items || []
  ) {
    const mapped = mapVideo(item);

    if (mapped) {
      items.push(mapped);
    }
  }

  return {
    id: playlistId,

    title:
      playlist.info?.title ||
      "YouTube Playlist",

    items,
  };
}