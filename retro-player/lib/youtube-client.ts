export type YouTubeTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  thumbnail: string;
  source: "youtube";
};

export async function searchYouTube(
  query: string
): Promise<YouTubeTrack[]> {
  const response = await fetch(
    `/api/youtube/search?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error("YouTube search failed.");
  }

  const data = await response.json();

  return data.results || [];
}

/**
 * Returns a same-origin playback URL.
 *
 * The server route resolves the YouTube googlevideo URL and proxies the
 * media response back through RetroPod. This is important because the
 * player is also connected to a Web Audio MediaElementAudioSourceNode;
 * pointing that node directly at a cross-origin YouTube CDN URL can cause
 * the browser to block/mute the audio graph.
 */
export async function getYouTubeStream(videoId: string) {
  if (!videoId?.trim()) {
    throw new Error("Video ID is required.");
  }

  return {
    url: `/api/youtube/stream?id=${encodeURIComponent(videoId)}`,
  };
}

export async function getYouTubePlaylist(playlistId: string) {
  const response = await fetch(
    `/api/youtube/playlist?id=${encodeURIComponent(playlistId)}`
  );

  if (!response.ok) {
    throw new Error("Unable to load YouTube playlist.");
  }

  return response.json();
}
