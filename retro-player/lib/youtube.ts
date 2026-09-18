import {
  Innertube,
  UniversalCache,
  Platform,
  Types,
} from "youtubei.js";

import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import {
  buildURL,
  parseLooseJSON,
  getHeaders,
  USER_AGENT,
} from "bgutils-js/utils";

import { JSDOM } from "jsdom";

Platform.shim.eval = async (
  data: Types.BuildScriptResult
) => {
  return new Function(data.output)();
};

let youtube: Innertube | null = null;

let webPoMinter: WebPoMinter | null = null;
let webPoInitPromise: Promise<WebPoMinter> | null = null;
let webPoDom: JSDOM | null = null;

/* ---------------------------------------------------------
   YOUTUBE
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   WEB PO TOKEN
--------------------------------------------------------- */

async function initializeWebPoMinter(): Promise<WebPoMinter> {
  console.log("[YouTube PO] Initializing BotGuard/WebPO...");

  const dom = new JSDOM(
    "<!DOCTYPE html><html lang=\"en\"><head><title></title></head><body></body></html>",
    {
      url: "https://www.youtube.com",
      referrer: "https://www.youtube.com/",
      userAgent: USER_AGENT,
    }
  );

  // Keep the same browser environment alive for both WebPO creation
  // and minting. The BotGuard mint callback can execute later and
  // still expects window/document to exist.
  webPoDom = dom;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: dom.window.location,
  });
  Object.defineProperty(globalThis, "origin", {
    configurable: true,
    value: dom.window.origin,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  try {
    const pageResponse = await fetch("https://www.youtube.com", {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.7",
        "user-agent": USER_AGENT,
      },
    });

    if (!pageResponse.ok) {
      throw new Error(
        `YouTube homepage returned HTTP ${pageResponse.status}.`
      );
    }

    const pageHtml = await pageResponse.text();

    const ytConfigMatch = pageHtml.match(
      /ytcfg\.set\(({.+?})\);/s
    );

    if (!ytConfigMatch) {
      throw new Error("Could not find YouTube ytcfg.");
    }

    const ytConfig = JSON.parse(ytConfigMatch[1]);

    (dom.window as any).yt = {
      config_: ytConfig,
    };

    (globalThis as any).yt = (dom.window as any).yt;

    const initialAttestationData = pageHtml.match(
      /window\.ytAtN\(\s*({[\s\S]*?})\s*\)/
    );

    if (!initialAttestationData) {
      throw new Error(
        "Could not find YouTube BotGuard challenge."
      );
    }

    const initialAttestationDataJson = parseLooseJSON(
      initialAttestationData[1]
    ) as any;

    const challengeResponse = initialAttestationDataJson.R;

    if (!challengeResponse?.bgChallenge) {
      throw new Error(
        "YouTube did not provide a BotGuard challenge."
      );
    }

    const interpreterUrl =
      challengeResponse.bgChallenge.interpreterUrl
        ?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;

    if (!interpreterUrl) {
      throw new Error(
        "YouTube did not provide a BotGuard interpreter URL."
      );
    }

    console.log("[YouTube PO] Loading BotGuard interpreter...");

    const bgScriptResponse = await fetch(
      `https:${interpreterUrl}`,
      {
        headers: {
          "user-agent": USER_AGENT,
        },
      }
    );

    if (!bgScriptResponse.ok) {
      throw new Error(
        `BotGuard interpreter returned HTTP ${bgScriptResponse.status}.`
      );
    }

    const interpreterJavascript = await bgScriptResponse.text();

    if (!interpreterJavascript) {
      throw new Error(
        "YouTube returned an empty BotGuard interpreter."
      );
    }

    new Function(interpreterJavascript)();

    console.log("[YouTube PO] Creating BotGuard client...");

    const botGuardClient = await BotGuardClient.create({
      program: challengeResponse.bgChallenge.program,
      globalName: challengeResponse.bgChallenge.globalName,
      globalObject: globalThis,
    });

    const webPoSignalOutput: WebPoSignalOutput = [];

    console.log("[YouTube PO] Creating BotGuard snapshot...");

    const botguardResponse = await botGuardClient.snapshot({
      webPoSignalOutput,
    });

    const requestKey = "O43z0dpjhgX20SCx4KAo";

    const integrityTokenResponse = await fetch(
      buildURL("GenerateIT", true),
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify([
          requestKey,
          botguardResponse,
        ]),
      }
    );

    if (!integrityTokenResponse.ok) {
      throw new Error(
        `GenerateIT returned HTTP ${integrityTokenResponse.status}.`
      );
    }

    const integrityTokenJson =
      (await integrityTokenResponse.json()) as [
        string,
        number,
        number,
        string | undefined
      ];

    const [
      integrityToken,
      estimatedTtlSecs,
      mintRefreshThreshold,
      websafeFallbackToken,
    ] = integrityTokenJson;

    if (!integrityToken) {
      throw new Error(
        "YouTube did not return an integrity token."
      );
    }

    console.log("[YouTube PO] Creating WebPO minter...");

    const minter = await WebPoMinter.create(
      {
        integrityToken,
        estimatedTtlSecs,
        mintRefreshThreshold,
        websafeFallbackToken,
      },
      webPoSignalOutput
    );

    console.log("[YouTube PO] WebPO ready.");

    return minter;
  } catch (error) {
    if (webPoDom === dom) {
      webPoDom = null;
      try {
        dom.window.close();
      } catch {}
    }
    throw error;
  }
}

async function getWebPoMinter(): Promise<WebPoMinter> {
  if (webPoMinter) {
    return webPoMinter;
  }

  if (!webPoInitPromise) {
    webPoInitPromise = initializeWebPoMinter();
  }

  try {
    webPoMinter = await webPoInitPromise;
    return webPoMinter;
  } catch (error) {
    webPoInitPromise = null;
    webPoMinter = null;
    throw error;
  }
}

async function getWebPoToken(videoId: string): Promise<string> {
  const minter = await getWebPoMinter();

  console.log(`[YouTube PO] Minting content token for ${videoId}`);

  // Use the exact JSDOM environment that was used to initialize WebPO.
  // Do not replace or remove these globals before minting completes.
  if (!webPoDom) {
    throw new Error("WebPO browser environment is not available.");
  }

  const token = await minter.mintAsWebsafeString(videoId);

  if (!token) {
    throw new Error(`Failed to mint WebPO token for ${videoId}.`);
  }

  console.log(`[YouTube PO] Token generated for ${videoId}`);

  return token;
}

/* ---------------------------------------------------------
   TRACK TYPES
--------------------------------------------------------- */

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

  if (
    typeof item?.duration?.seconds === "number"
  ) {
    return item.duration.seconds;
  }

  if (
    typeof item?.duration?.text === "string"
  ) {
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
   AUDIO-ONLY STREAMING
--------------------------------------------------------- */

export async function createYouTubeAudioStream(
  videoId: string
) {
  const yt = await getYouTube();

  console.log(
    `[YouTube Audio] Resolving audio-only stream for ${videoId}`
  );

  /*
   * MWEB is currently the useful client for direct audio
   * extraction in this setup. The important difference is
   * that the resulting GVS URL gets a video-bound WebPO token.
   */
  try {
    console.log(
      `[YouTube Audio] Trying MWEB client for ${videoId}`
    );

    const format = await yt.getStreamingData(
      videoId,
      {
        client: "MWEB",
        type: "audio",
        quality: "best",
      } as any
    );

    const url = format.url;

    if (!url) {
      throw new Error(
        "YouTube returned no playable MWEB audio URL."
      );
    }

    console.log(
      `[YouTube Audio] MWEB selected itag=${format.itag}, mime=${format.mime_type}`
    );

    /*
     * Generate a fresh token bound specifically to this
     * video. YouTube's current WebPO implementation binds
     * the content token to the video ID.
     */
    const poToken =
      await getWebPoToken(videoId);

    const separator = url.includes("?")
      ? "&"
      : "?";

    const playableUrl =
      `${url}${separator}pot=${encodeURIComponent(poToken)}`;

    console.log(
      `[YouTube Audio] WebPO token attached to ${videoId}`
    );

    return {
      url: playableUrl,
      mimeType:
        format.mime_type ||
        "audio/mp4",
      duration:
        format.approx_duration_ms
          ? Number(format.approx_duration_ms) / 1000
          : undefined,
    };
  } catch (error) {
    console.error(
      `[YouTube Audio] MWEB + WebPO failed for ${videoId}:`,
      error
    );

    throw new Error(
      `Unable to resolve a playable YouTube audio stream for ${videoId}. ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
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