import { Capacitor } from "@capacitor/core";

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export const SPOTIFY_REDIRECT_URI = "https://swvmi.github.io/RETRO-POD/callback/";
export const SPOTIFY_APP_SCHEME_REDIRECT = "retropod://callback";
export const SPOTIFY_WEB_REDIRECT_URI = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";

export const SPOTIFY_SCOPES = [
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
].join(" ");

const LS_CLIENT_ID = "retro_spotify_client_id";
const LS_VERIFIER = "retro_spotify_pkce_verifier";
const LS_TOKENS = "retro_spotify_tokens";

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; 
};

export type SpotifyTrack = {
  uri: string;
  id: string;
  name: string;
  artist: string;
  artworkUrl?: string;
  durationMs: number;
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  artworkUrl?: string;
};

export function getSavedClientId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LS_CLIENT_ID) || "";
}

export function saveClientId(clientId: string) {
  localStorage.setItem(LS_CLIENT_ID, clientId.trim());
}

export function clearClientId() {
  localStorage.removeItem(LS_CLIENT_ID);
}

export function getSavedTokens(): SpotifyTokens | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LS_TOKENS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SpotifyTokens;
  } catch {
    return null;
  }
}

function saveTokens(tokens: SpotifyTokens) {
  localStorage.setItem(LS_TOKENS, JSON.stringify(tokens));
}

export function clearSpotifySession() {
  localStorage.removeItem(LS_TOKENS);
  localStorage.removeItem(LS_VERIFIER);
}

export function isSpotifyConnected(): boolean {
  return !!getSavedTokens();
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  const randomBytes = new Uint8Array(64);
  crypto.getRandomValues(randomBytes);
  return base64UrlEncode(randomBytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  if (!crypto || !crypto.subtle) {
    throw new Error("Crypto API missing.");
  }
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

export const startSpotifyLogin = async (clientId: string) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem(LS_VERIFIER, codeVerifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    scope: SPOTIFY_SCOPES,
  });

  const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

  if (Capacitor.isNativePlatform()) {
    // Force external system browser invocation so Android doesn't swallow or instantly kill the WebView context
    window.open(authUrl, "_system");
  } else {
    window.location.href = authUrl;
  }
};

export async function completeSpotifyLogin(code: string): Promise<SpotifyTokens> {
  const clientId = getSavedClientId();
  const verifier = localStorage.getItem(LS_VERIFIER) || "";

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Spotify token exchange failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const tokens: SpotifyTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
  };
  saveTokens(tokens);
  localStorage.removeItem(LS_VERIFIER);
  return tokens;
}

async function refreshTokens(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const clientId = getSavedClientId();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) throw new Error("Spotify token refresh failed");

  const json = await res.json();
  const updated: SpotifyTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
  };
  saveTokens(updated);
  return updated;
}

async function getValidAccessToken(): Promise<string | null> {
  let tokens = getSavedTokens();
  if (!tokens) return null;
  if (Date.now() >= tokens.expiresAt) {
    try {
      tokens = await refreshTokens(tokens);
    } catch {
      clearSpotifySession();
      return null;
    }
  }
  return tokens.accessToken;
}

async function spotifyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Spotify");
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function fetchPlaylists(): Promise<SpotifyPlaylist[]> {
  const res = await spotifyFetch("/me/playlists?limit=50");
  if (!res.ok) throw new Error("Failed to load playlists");
  const json = await res.json();
  return (json.items || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    trackCount: p.tracks?.total ?? 0,
    artworkUrl: p.images?.[0]?.url,
  }));
}

export async function fetchSavedTracks(): Promise<SpotifyTrack[]> {
  const res = await spotifyFetch("/me/tracks?limit=50");
  if (!res.ok) throw new Error("Failed to load saved tracks");
  const json = await res.json();
  return (json.items || [])
    .map((it: any) => it.track)
    .filter(Boolean)
    .map(trackToSpotifyTrack);
}

export async function fetchPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const res = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=100`);
  if (!res.ok) throw new Error("Failed to load playlist tracks");
  const json = await res.json();
  return (json.items || [])
    .map((it: any) => it.track)
    .filter(Boolean)
    .map(trackToSpotifyTrack);
}

function trackToSpotifyTrack(t: any): SpotifyTrack {
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    artist: (t.artists || []).map((a: any) => a.name).join(", "),
    artworkUrl: t.album?.images?.[0]?.url,
    durationMs: t.duration_ms,
  };
}

export class NoActiveDeviceError extends Error {
  constructor() {
    super("No active Spotify device. Open the Spotify app once, then try again.");
  }
}

async function handlePlaybackResponse(res: Response) {
  if (res.status === 404) throw new NoActiveDeviceError();
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spotify playback command failed (${res.status}) ${text}`);
  }
}

export async function playTrackUri(uri: string, contextUris?: string[]) {
  const uris = contextUris && contextUris.length ? contextUris : [uri];
  const offset = contextUris ? { uri } : undefined;
  const res = await spotifyFetch("/me/player/play", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris, ...(offset ? { offset } : {}) }),
  });
  await handlePlaybackResponse(res);
}

export async function resumePlayback() {
  const res = await spotifyFetch("/me/player/play", { method: "PUT" });
  await handlePlaybackResponse(res);
}

export async function pausePlayback() {
  const res = await spotifyFetch("/me/player/pause", { method: "PUT" });
  await handlePlaybackResponse(res);
}

export async function nextTrack() {
  const res = await spotifyFetch("/me/player/next", { method: "POST" });
  await handlePlaybackResponse(res);
}

export async function previousTrack() {
  const res = await spotifyFetch("/me/player/previous", { method: "POST" });
  await handlePlaybackResponse(res);
}

export type SpotifyPlaybackState = {
  isPlaying: boolean;
  progressMs: number;
  track: SpotifyTrack | null;
};

export async function getCurrentPlayback(): Promise<SpotifyPlaybackState | null> {
  const res = await spotifyFetch("/me/player/currently-playing");
  if (res.status === 204) return null;
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || !json.item) return null;
  return {
    isPlaying: !!json.is_playing,
    progressMs: json.progress_ms || 0,
    track: trackToSpotifyTrack(json.item),
  };
}