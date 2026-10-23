"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { Capacitor } from "@capacitor/core";
import { Play, Pause, SkipForward, SkipBack, RefreshCw, Volume2, SlidersHorizontal, Heart, ListPlus, X, Shuffle, Repeat, Repeat1, Search, Maximize, Minimize, Film, Subtitles, Settings2, Rewind, FastForward, Music, Pencil, ArrowUp, ArrowDown, Radio } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { AndroidPlayback } from "@/lib/androidPlayback";
import AlbumCoverflow, { CoverflowItem } from "@/components/AlbumCoverflow";

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

type SongItem = {
  file: File;
  name: string;
  artworkUrl?: string;
  artist?: string;
  album?: string;
  importedAt?: number;
  playCount?: number;
  lastPlayedAt?: number;
  customArtworkData?: string;
};
const lcdThemes = [
  "burgundy", "graphite", "champagne", "rose-gold", "sage", "alpine",
  "ocean-depths", "aurora", "cobalt", "amethyst", "ember", "jade",
  "inverted", "solarized", "cyberpunk", "vaporwave", "midnight", "arctic",
  "copper", "forest", "sepia", "blue", "green", "amber", "gray", "pink",
  "purple", "teal", "white", "red", "oled-red", "oled-amber", "oled-green",
  "oled-cyan", "oled-magenta",
] as const;
type LcdTheme = (typeof lcdThemes)[number];
type UserPlaylist = { id: string; name: string; songNames: string[] };
type MovieItem = { file: File; name: string };
type DirectoryHandleWithIteration = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  keys: () => AsyncIterableIterator<string>;
};
type BatteryManagerLike = EventTarget & { level: number; charging: boolean };
type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
};

type MenuItem = {
  label: string;
  type: "menu" | "action" | "song";
  targetId?: string;
  actionId?: string;
  song?: SongItem;
  playlistId?: string;
};
type Menu = { id: string; title: string; items: MenuItem[] };

const readRadioTasteProfile = (storageKey: string) => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const profile: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.length <= 180 && typeof value === "number" && Number.isFinite(value)) {
        profile[key] = Math.max(-5, Math.min(5, value));
      }
    }
    return profile;
  } catch (error) {
    console.warn(`Unable to restore Retro Radio preferences from ${storageKey}:`, error);
    return {};
  }
};

export default function MobileBulletproofPlayer() {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState("12:00");
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  // Settings
  const [lcdTheme, setLcdTheme] = useState<LcdTheme>("burgundy");
  const [hapticsOn, setHapticsOn] = useState(true);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "one" | "all">("all");
  const [radioModeOn, setRadioModeOn] = useState(false);
  const [radioDiscoveryMode, setRadioDiscoveryMode] = useState(false);
  const [radioRecommendationReason, setRadioRecommendationReason] = useState("");
  const [radioArtistTaste, setRadioArtistTaste] = useState<Record<string, number>>({});
  const [radioAlbumTaste, setRadioAlbumTaste] = useState<Record<string, number>>({});
  const [radioTokenTaste, setRadioTokenTaste] = useState<Record<string, number>>({});
  const [clock24h, setClock24h] = useState(true);
  const [detailedViewEnabled, setDetailedViewEnabled] = useState(true);
  const [artworkLcdBackgroundEnabled, setArtworkLcdBackgroundEnabled] = useState(false);
  const [resumePlaybackEnabled, setResumePlaybackEnabled] = useState(true);
  const [seekJumpSeconds, setSeekJumpSeconds] = useState(10);
  const [sleepFadeEnabled, setSleepFadeEnabled] = useState(true);
  const [largeTextEnabled, setLargeTextEnabled] = useState(false);
  const [highContrastEnabled, setHighContrastEnabled] = useState(false);
  const [reducedMotionEnabled, setReducedMotionEnabled] = useState(false);
  const [sleepTimerEndAt, setSleepTimerEndAt] = useState<number | null>(null);

  // PRO Features State
  const [showDiag, setShowDiag] = useState(false);
  const [volOverlay, setVolOverlay] = useState<number | null>(null);
  const [eqGains, setEqGains] = useState<number[]>([0, 0, 0, 0, 0]);
  const [eqEditMode, setEqEditMode] = useState(false);
  const eqGainsRef = useRef(eqGains);

  // References
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekPreviewRef = useRef(0);
  const seekAudioToRef = useRef<(position: number) => void>(() => {});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const audioObjectUrlRef = useRef<string | null>(null);
  const playbackRequestRef = useRef(0);
  const nativeTrackSyncsRef = useRef(new Map<string, Promise<void>>());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const movieStageRef = useRef<HTMLDivElement | null>(null);
  const movieInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const coverSwipeStartXRef = useRef<number | null>(null);
  const movieControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePlaylistIdRef = useRef<string | null>(null);
  const playlistPlaybackOrderRef = useRef<string[]>([]);
  const radioModeOnRef = useRef(false);
  const radioStationNamesRef = useRef<string[]>([]);
  const radioPositionRef = useRef(0);
  const radioSeedSongRef = useRef<SongItem | null>(null);
  const radioSkippedNamesRef = useRef<Set<string>>(new Set());
  const radioArtistTasteRef = useRef<Record<string, number>>({});
  const radioAlbumTasteRef = useRef<Record<string, number>>({});
  const radioTokenTasteRef = useRef<Record<string, number>>({});
  const radioDiscoveryModeRef = useRef(false);
  
  const [localSongs, setLocalSongs] = useState<SongItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const [favoriteSongNames, setFavoriteSongNames] = useState<string[]>([]);
  const [queuedSongNames, setQueuedSongNames] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [playlistPlaybackOrder, setPlaylistPlaybackOrder] = useState<string[]>([]);
  const [playlistShuffleSelection, setPlaylistShuffleSelection] = useState<Record<string, boolean>>({});
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [libraryPreferencesLoaded, setLibraryPreferencesLoaded] = useState(false);
  const [songsLoaded, setSongsLoaded] = useState(false);
  const [nativePlaybackStateLoaded, setNativePlaybackStateLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [menuSearch, setMenuSearch] = useState("");
  const [movieSearch, setMovieSearch] = useState("");
  const [currentMovie, setCurrentMovie] = useState<MovieItem | null>(null);
  const [moviePlaybackUrl, setMoviePlaybackUrl] = useState<string | null>(null);
  const [movieIsPlaying, setMovieIsPlaying] = useState(false);
  const [movieCurrentTime, setMovieCurrentTime] = useState(0);
  const [movieDuration, setMovieDuration] = useState(0);
  const [movieSpeed, setMovieSpeed] = useState(1);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [movieFullscreen, setMovieFullscreen] = useState(false);
  const [movieControlsVisible, setMovieControlsVisible] = useState(true);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<SongItem | null>(null);
  const [customArtworkData, setCustomArtworkData] = useState("");
  const [queueUndo, setQueueUndo] = useState<{ fileName: string; index: number } | null>(null);
  const customArtworkInputRef = useRef<HTMLInputElement>(null);
  const sleepFadeStartVolumeRef = useRef<number | null>(null);
  const queueUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [menuStack, setMenuStack] = useState<string[]>(["root"]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [screen, setScreen] = useState<"menu" | "nowPlaying" | "eq" | "movies" | "moviePlaying">("menu");
  const [isDetailedNowPlaying, setIsDetailedNowPlaying] = useState(false);
  const selectedMenuItemRef = useRef<HTMLLIElement | null>(null);
  const selectedMovieItemRef = useRef<HTMLDivElement | null>(null);

  const padRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDraggingRef = useRef(false);
  const lastAngleRef = useRef(0);
  const accumulatedAngleRef = useRef(0);
  const accumulatedBackwardsRef = useRef(0);
  const activeRingRef = useRef<"outer" | "inner" | null>(null);
  const lastInnerTapRef = useRef(0);
  
  const clock24hRef = useRef(clock24h);
  const sleepTimerEndAtRef = useRef<number | null>(null);
  const sleepFadeEnabledRef = useRef(sleepFadeEnabled);
  const resumePlaybackEnabledRef = useRef(resumePlaybackEnabled);
  const repeatModeRef = useRef<"off" | "one" | "all">("all");
  const shuffleOnRef = useRef(false);
  const shufflePlayedSongNamesRef = useRef<Set<string>>(new Set());
  const localSongsRef = useRef<SongItem[]>([]);
  const queuedSongNamesRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);

  useEffect(() => { clock24hRef.current = clock24h; }, [clock24h]);
  useEffect(() => { sleepTimerEndAtRef.current = sleepTimerEndAt; }, [sleepTimerEndAt]);
  useEffect(() => { sleepFadeEnabledRef.current = sleepFadeEnabled; }, [sleepFadeEnabled]);
  useEffect(() => { resumePlaybackEnabledRef.current = resumePlaybackEnabled; }, [resumePlaybackEnabled]);
  useEffect(() => { radioArtistTasteRef.current = radioArtistTaste; }, [radioArtistTaste]);
  useEffect(() => { radioAlbumTasteRef.current = radioAlbumTaste; }, [radioAlbumTaste]);
  useEffect(() => { radioTokenTasteRef.current = radioTokenTaste; }, [radioTokenTaste]);
  useEffect(() => { radioDiscoveryModeRef.current = radioDiscoveryMode; }, [radioDiscoveryMode]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { shuffleOnRef.current = shuffleOn; }, [shuffleOn]);
  useEffect(() => { localSongsRef.current = localSongs; }, [localSongs]);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
    playlistPlaybackOrderRef.current = playlistPlaybackOrder;
  }, [activePlaylistId, playlistPlaybackOrder]);
  useEffect(() => { queuedSongNamesRef.current = queuedSongNames; }, [queuedSongNames]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { eqGainsRef.current = eqGains; }, [eqGains]);

  // --- AUDIO ENGINE INIT & EQ ROUTING ---
  const ensureAudioGraph = () => {
    if (!audioRef.current || sourceNodeRef.current) return;
    try {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is not supported.");
      const ctx = new AudioContextConstructor();
      audioCtxRef.current = ctx;
      ctx.addEventListener("statechange", () => {
        if (ctx.state === "suspended" && isPlayingRef.current) {
          ctx.resume().catch((error) => {
            console.error("Unable to resume the equalizer audio graph:", error);
          });
        }
      });
      
      const source = ctx.createMediaElementSource(audioRef.current);
      sourceNodeRef.current = source;
      
      const freqs = [60, 230, 910, 3600, 14000];
      const filters = freqs.map((f, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = i === 0 ? "lowshelf" : i === 4 ? "highshelf" : "peaking";
        filter.frequency.value = f;
        if (filter.type === "peaking") filter.Q.value = 1.0;
        filter.gain.value = eqGains[i];
        return filter;
      });

      source.connect(filters[0]);
      filters[0].connect(filters[1]);
      filters[1].connect(filters[2]);
      filters[2].connect(filters[3]);
      filters[3].connect(filters[4]);
      filters[4].connect(ctx.destination);
      
      filtersRef.current = filters;
    } catch (e) {
      console.warn("Audio routing error:", e);
    }
  };

  const wakeUpAudioCtx = () => {
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch((error) => {
        console.warn("Unable to resume audio context:", error);
      });
    }
  };

  const syncNativeTrack = (song: SongItem): Promise<void> => {
    if (Capacitor.getPlatform() !== "android") return Promise.resolve();
    const existingSync = nativeTrackSyncsRef.current.get(song.file.name);
    if (existingSync) return existingSync;

    const sync = (async () => {
      const status = await AndroidPlayback.hasTrack({
        name: song.file.name,
        size: song.file.size,
        lastModified: song.file.lastModified,
      });
      if (status.exists) return;

      const chunkSize = 256 * 1024;
      const chunkCount = Math.ceil(song.file.size / chunkSize);
      if (chunkCount === 0) throw new Error(`"${song.file.name}" is empty.`);
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const bytes = new Uint8Array(await song.file.slice(start, start + chunkSize).arrayBuffer());
        const binaryParts: string[] = [];
        const conversionChunkSize = 32 * 1024;
        for (let offset = 0; offset < bytes.length; offset += conversionChunkSize) {
          binaryParts.push(String.fromCharCode(...bytes.subarray(offset, offset + conversionChunkSize)));
        }
        await AndroidPlayback.appendTrackChunk({
          name: song.file.name,
          chunk: btoa(binaryParts.join("")),
          first: chunkIndex === 0,
          last: chunkIndex === chunkCount - 1,
          size: song.file.size,
          lastModified: song.file.lastModified,
          title: song.name,
          artist: song.artist ?? "",
          album: song.album ?? "",
        });
      }
    })();
    nativeTrackSyncsRef.current.set(song.file.name, sync);
    void sync.finally(() => nativeTrackSyncsRef.current.delete(song.file.name)).catch(() => {});
    return sync;
  };

  const syncNativeLibrary = async (songs: SongItem[]) => {
    for (const song of songs) await syncNativeTrack(song);
  };

  const setAudioSource = (file: File) => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
    }
    audioObjectUrlRef.current = URL.createObjectURL(file);
    audio.src = audioObjectUrlRef.current;
    audio.load();
  };

  const seekAudioTo = (position: number) => {
    const isAndroidPlayback = Capacitor.getPlatform() === "android";
    const audioDuration = isAndroidPlayback ? duration : audioRef.current?.duration;
    const maximum = Number.isFinite(audioDuration) && audioDuration
      ? audioDuration
      : duration;
    const boundedPosition = Math.max(0, Math.min(position, maximum || position));
    setCurrentTime(boundedPosition);
    if (isAndroidPlayback) {
      AndroidPlayback.seekTo({ position: Math.round(boundedPosition * 1000) }).catch((error) => {
        console.error("Unable to seek Android playback:", error);
        setImportNotice("The track could not seek to that position.");
      });
    } else if (audioRef.current) {
      audioRef.current.currentTime = boundedPosition;
    }
  };
  seekAudioToRef.current = seekAudioTo;

  const releaseAudioSource = () => {
    playbackRequestRef.current += 1;
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      audio.removeAttribute("src");
      audio.load();
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  };

  // --- METADATA & PARSING ---
  const parseID3 = (bytes: Uint8Array, view: DataView, offsetStart = 0): string | undefined => {
    try {
      const majorVersion = view.getUint8(offsetStart + 3);
      const headerFlags = view.getUint8(offsetStart + 5);
      const hasExtendedHeader = (headerFlags & 0x40) !== 0;
      const tagSize = readSyncSafeUint32(view, offsetStart + 6);
      const tagEnd = Math.min(offsetStart + 10 + tagSize, bytes.length);

      let offset = offsetStart + 10;

      if (hasExtendedHeader && offset + 4 <= tagEnd) {
        const extSize = majorVersion >= 4 ? readSyncSafeUint32(view, offset) : view.getUint32(offset, false);
        offset += majorVersion >= 4 ? extSize : extSize + 4;
      }

      if (majorVersion === 2) {
        while (offset + 6 < tagEnd) {
          const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
          if (frameId === "\0\0\0") break;
          const frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
          const bodyStart = offset + 6;
          if (frameSize <= 0 || bodyStart + frameSize > bytes.length) break;

          if (frameId === "PIC") {
            const body = bytes.subarray(bodyStart, bodyStart + frameSize);
            const url = parsePicFrameBody(body, false);
            if (url) return url;
          }
          offset = bodyStart + frameSize;
        }
        return undefined;
      }

      while (offset + 10 < tagEnd) {
        const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        if (frameId === "\0\0\0\0") break;

        const frameSize = majorVersion >= 4 ? readSyncSafeUint32(view, offset + 4) : view.getUint32(offset + 4, false);
        const bodyStart = offset + 10;
        if (frameSize <= 0 || bodyStart + frameSize > bytes.length) break;

        if (frameId === "APIC") {
          const body = bytes.subarray(bodyStart, bodyStart + frameSize);
          const url = parsePicFrameBody(body, true);
          if (url) return url;
        }
        offset = bodyStart + frameSize;
      }
    } catch (e) {
      console.log("ID3 parsing error", e);
    }
    return undefined;
  };

  const extractArtwork = async (file: File): Promise<string | undefined> => {
    try {
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);

      if (bytes.length < 12) return undefined;

      if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
        let offset = 4;
        let isLast = false;
        while (!isLast && offset < bytes.length - 4) {
          const header = bytes[offset];
          isLast = (header & 0x80) !== 0;
          const blockType = header & 0x7F;
          const blockLen = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
          offset += 4;

          if (blockType === 6) { 
            let p = offset + 4;
            const mimeLen = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
            p += 4;
            const mime = new TextDecoder("ascii").decode(bytes.subarray(p, p + mimeLen));
            p += mimeLen;
            const descLen = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
            p += 4 + descLen + 16; 
            const picLen = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
            p += 4;
            const picData = bytes.subarray(p, p + picLen);
            const blob = new Blob([picData], { type: mime });
            return URL.createObjectURL(blob);
          }
          offset += blockLen;
        }
        return undefined;
      }

      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        let offset = 12;
        while (offset < bytes.length - 8) {
          const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
          const chunkSize = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
          if (chunkId.toLowerCase() === 'id3 ') {
            return parseID3(bytes, view, offset + 8);
          }
          offset += 8 + chunkSize;
          if (chunkSize % 2 !== 0) offset++; 
        }
        return undefined;
      }

      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        return parseID3(bytes, view, 0);
      }
    } catch (e) {
      console.log("Artwork parsing error", e);
    }
    return undefined;
  };

  const parsePicFrameBody = (body: Uint8Array, hasMimeString: boolean): string | undefined => {
    let p = 0;
    const textEncoding = body[p];
    p += 1;

    let mimeType = "image/jpeg";
    if (hasMimeString) {
      let mimeEnd = p;
      while (mimeEnd < body.length && body[mimeEnd] !== 0x00) mimeEnd++;
      const mimeStr = new TextDecoder("latin1").decode(body.subarray(p, mimeEnd));
      if (mimeStr.startsWith("image/")) mimeType = mimeStr;
      p = mimeEnd + 1;
    } else {
      const fmt = new TextDecoder("latin1").decode(body.subarray(p, p + 3)).toUpperCase();
      mimeType = fmt === "PNG" ? "image/png" : "image/jpeg";
      p += 3;
    }
    p += 1; 
    if (textEncoding === 1 || textEncoding === 2) {
      while (p < body.length - 1 && !(body[p] === 0x00 && body[p + 1] === 0x00)) p += 2;
      p += 2;
    } else {
      while (p < body.length && body[p] !== 0x00) p += 1;
      p += 1;
    }

    const imageBytes = body.subarray(Math.min(p, body.length));
    if (imageBytes.length === 0) return undefined;

    if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) mimeType = "image/png";
    else if (imageBytes[0] === 0xff && imageBytes[1] === 0xd8) mimeType = "image/jpeg";

    const blob = new Blob([imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) as ArrayBuffer], { type: mimeType });
    return URL.createObjectURL(blob);
  };

  function readSyncSafeUint32(view: DataView, offset: number) {
    return (
      ((view.getUint8(offset) & 0x7f) << 21) |
      ((view.getUint8(offset + 1) & 0x7f) << 14) |
      ((view.getUint8(offset + 2) & 0x7f) << 7) |
      (view.getUint8(offset + 3) & 0x7f)
    );
  }

  const loadPersistedSongs = async () => {
    try {
      const root = await navigator.storage.getDirectory() as DirectoryHandleWithIteration;
      const loadedSongs: SongItem[] = [];
      let savedMetadata: Record<string, Partial<SongItem>> = {};
      try {
        const storedMetadata = localStorage.getItem("retro_song_metadata");
        if (storedMetadata) {
          const parsed: unknown = JSON.parse(storedMetadata);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            savedMetadata = parsed as Record<string, Partial<SongItem>>;
          }
        }
      } catch (error) {
        console.warn("Unable to restore song metadata:", error);
      }
      for await (const [, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const metadata = savedMetadata[file.name];
          const artworkUrl = metadata?.customArtworkData || await extractArtwork(file);
          loadedSongs.push({
            file,
            name: typeof metadata?.name === "string" ? metadata.name : file.name.replace(/\.[^/.]+$/, ""),
            artworkUrl,
            artist: typeof metadata?.artist === "string" ? metadata.artist : "",
            album: typeof metadata?.album === "string" ? metadata.album : "",
            importedAt: typeof metadata?.importedAt === "number" ? metadata.importedAt : file.lastModified,
            playCount: typeof metadata?.playCount === "number" ? metadata.playCount : 0,
            lastPlayedAt: typeof metadata?.lastPlayedAt === "number" ? metadata.lastPlayedAt : 0,
            customArtworkData: typeof metadata?.customArtworkData === "string" ? metadata.customArtworkData : undefined,
          });
        }
      }
      
      setLocalSongs(loadedSongs);
      localSongsRef.current = loadedSongs;
      setSongsLoaded(true);
      const availableFileNames = new Set(loadedSongs.map((song) => song.file.name));
      setFavoriteSongNames((previous) => previous.filter((name) => availableFileNames.has(name)));
      setPlaylists((previous) => previous.map((playlist) => ({
        ...playlist,
        songNames: playlist.songNames.filter((name) => availableFileNames.has(name)),
      })));
      const validQueue = queuedSongNamesRef.current.filter((name) => availableFileNames.has(name));
      queuedSongNamesRef.current = validQueue;
      setQueuedSongNames(validQueue);
      if (Capacitor.getPlatform() === "android") {
        void syncNativeLibrary(loadedSongs).catch((error) => {
          console.error("Unable to prepare imported tracks for Android background playback:", error);
          setImportNotice("Android background playback could not prepare every saved track. Re-import affected songs and try again.");
        });
      }
      const lastSongName = resumePlaybackEnabledRef.current ? localStorage.getItem("retro_last_song_name") : null;
      if (lastSongName) {
        const foundIdx = loadedSongs.findIndex(s => s.name === lastSongName);
        if (foundIdx !== -1) {
          setCurrentSong(loadedSongs[foundIdx]);
          currentIndexRef.current = foundIdx;
          setCurrentIndex(foundIdx);
          if (audioRef.current && Capacitor.getPlatform() !== "android") {
            setAudioSource(loadedSongs[foundIdx].file);
            audioRef.current.addEventListener('loadedmetadata', function restoreTime() {
              const lastTime = parseFloat(localStorage.getItem("retro_last_time") || "0");
              if (audioRef.current && Number.isFinite(lastTime)) {
                audioRef.current.currentTime = Math.min(lastTime, audioRef.current.duration || lastTime);
                setCurrentTime(audioRef.current.currentTime);
              }
              audioRef.current?.removeEventListener('loadedmetadata', restoreTime);
            });
          }
        }
      }
    } catch {
      console.log("No persistent storage cache found.");
      setSongsLoaded(true);
    }
  };

  const loadPersistedMovies = async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const movieDirectory = await root.getDirectoryHandle("movies") as DirectoryHandleWithIteration;
      const loadedMovies: MovieItem[] = [];
      for await (const [, handle] of movieDirectory.entries()) {
        if (handle.kind !== "file") continue;
        const file = await handle.getFile();
        loadedMovies.push({ file, name: file.name.replace(/\.[^/.]+$/, "") });
      }
      setMovies(loadedMovies);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        setMovies([]);
        return;
      }
      console.error("Unable to load saved movies:", error);
    }
  };

  const saveSongsToStorage = async (files: File[]) => {
    const root = await navigator.storage.getDirectory() as DirectoryHandleWithIteration;
    const saved: File[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const handle = await root.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
        saved.push(file);
      } catch (error) {
        console.error(`Unable to save imported song "${file.name}":`, error);
        failures.push(file.name);
      }
    }
    return { saved, failures };
  };

  const clearLocalLibrary = async () => {
    if (Capacitor.getPlatform() === "android") {
      try {
        await Promise.all(localSongsRef.current.map((song) =>
          AndroidPlayback.removeTrack({ name: song.file.name })
        ));
      } catch (error) {
        console.error("Unable to clear Android's background music copies:", error);
        setImportNotice("Some Android background music copies could not be removed.");
      }
    }
    try {
      const root = await navigator.storage.getDirectory() as DirectoryHandleWithIteration;
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === "file") await root.removeEntry(name);
      }
    } catch (e) {
      console.log("Storage error", e);
    }
    if (radioModeOnRef.current) stopRadio();
    releaseAudioSource();
    setLocalSongs([]);
    setFavoriteSongNames([]);
    setPlaylists([]);
    queuedSongNamesRef.current = [];
    setQueuedSongNames([]);
    setIsPlaying(false);
    setCurrentSong(null);
    setCurrentIndex(0);
    setScreen("menu");
  };

  const removeSpecificSong = async (fileName: string) => {
    if (Capacitor.getPlatform() === "android") {
      try {
        await AndroidPlayback.removeTrack({ name: fileName });
      } catch (error) {
        console.error(`Unable to remove Android's background copy of "${fileName}":`, error);
        setImportNotice("The Android background copy could not be removed.");
      }
    }
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(fileName);
    } catch (e) {
      console.log("Could not remove file", e);
    }
    setLocalSongs(prev => prev.filter(s => s.file.name !== fileName));
    setFavoriteSongNames((previous) => previous.filter((name) => name !== fileName));
    setPlaylists((previous) => previous.map((playlist) => ({
      ...playlist,
      songNames: playlist.songNames.filter((name) => name !== fileName),
    })));
    setQueuedSongNames((previous) => {
      const next = previous.filter((name) => name !== fileName);
      queuedSongNamesRef.current = next;
      return next;
    });
    if (currentSong?.file.name === fileName) {
      if (radioModeOnRef.current) stopRadio();
      releaseAudioSource();
      setIsPlaying(false);
      setCurrentSong(null);
      activePlaylistIdRef.current = null;
      playlistPlaybackOrderRef.current = [];
      setActivePlaylistId(null);
      setPlaylistPlaybackOrder([]);
      setCurrentIndex(0);
      setScreen("menu");
    } else if (currentSong) {
      const nextIndex = localSongs
        .filter((song) => song.file.name !== fileName)
        .findIndex((song) => song.file.name === currentSong.file.name);
      if (nextIndex >= 0) setCurrentIndex(nextIndex);
      if (activePlaylistIdRef.current) {
        const nextOrder = playlistPlaybackOrderRef.current.filter((name) => name !== fileName);
        playlistPlaybackOrderRef.current = nextOrder;
        setPlaylistPlaybackOrder(nextOrder);
        const playlistIndex = nextOrder.indexOf(currentSong.file.name);
        if (playlistIndex >= 0) {
          currentIndexRef.current = playlistIndex;
          setCurrentIndex(playlistIndex);
        }
      }
    }
  };

  const getPlaybackSongs = () => {
    const activePlaylistId = activePlaylistIdRef.current;
    if (!activePlaylistId) return localSongsRef.current;
    const playlist = playlists.find((item) => item.id === activePlaylistId);
    if (!playlist) return localSongsRef.current;
    const orderedNames = playlistPlaybackOrderRef.current.filter((name) => playlist.songNames.includes(name));
    const names = orderedNames.length > 0 ? orderedNames : playlist.songNames;
    return names
      .map((name) => localSongsRef.current.find((song) => song.file.name === name))
      .filter((song): song is SongItem => song !== undefined);
  };

  const startNativeQueue = async (song: SongItem, songIndex: number, playlistId: string | null) => {
    const playbackSongs = getPlaybackSongs();
    const playbackIndex = playbackSongs.findIndex((item) => item.file.name === song.file.name);
    const currentPosition = playbackIndex >= 0 ? playbackIndex : songIndex;
    const queuedSongs = playlistId
      ? []
      : queuedSongNamesRef.current
        .map((name) => localSongsRef.current.find((item) => item.file.name === name))
        .filter((item): item is SongItem => item !== undefined && item.file.name !== song.file.name);
    const queuedNames = new Set(queuedSongs.map((item) => item.file.name));
    const remainingSongs = playbackSongs
      .slice(currentPosition + 1)
      .concat(repeatModeRef.current === "all" ? playbackSongs.slice(0, currentPosition) : [])
      .filter((item) => item.file.name !== song.file.name && !queuedNames.has(item.file.name));

    if (shuffleOnRef.current) {
      for (let i = remainingSongs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingSongs[i], remainingSongs[j]] = [remainingSongs[j], remainingSongs[i]];
      }
    }

    const orderedSongs = [song, ...queuedSongs, ...remainingSongs];
    await syncNativeTrack(song);
    await AndroidPlayback.setQueue({
      tracks: JSON.stringify(orderedSongs.map((item) => ({
        fileName: item.file.name,
        title: item.name,
        artist: item.artist ?? "",
        album: item.album ?? "",
      }))),
      index: 0,
      repeatStartIndex: 1 + queuedSongs.length,
      repeatMode: repeatModeRef.current,
      shuffle: shuffleOnRef.current,
      speed: playbackSpeed,
    });
    await AndroidPlayback.setEqualizer({ gains: JSON.stringify(eqGainsRef.current) });
    void syncNativeLibrary(orderedSongs.slice(1)).catch((error) => {
      console.error("Unable to prepare the rest of the Android playback queue:", error);
      setImportNotice("Some queued tracks are still preparing for background playback.");
    });
  };

  const playSong = (song: SongItem, index: number, playlistId: string | null = null, radioPlayback = false) => {
    if (!radioPlayback && radioModeOnRef.current) {
      radioModeOnRef.current = false;
      setRadioModeOn(false);
      radioStationNamesRef.current = [];
      radioPositionRef.current = 0;
      radioSeedSongRef.current = null;
    }
    if (Capacitor.getPlatform() !== "android"
      && (sourceNodeRef.current || eqGainsRef.current.some((gain) => gain !== 0))) {
      ensureAudioGraph();
      wakeUpAudioCtx();
    }

    const audio = audioRef.current;
    activePlaylistIdRef.current = playlistId;
    setActivePlaylistId(playlistId);
    setCurrentSong(song);
    const playedAt = Date.now();
    setLocalSongs((previous) => previous.map((item) => item.file.name === song.file.name
      ? { ...item, playCount: (item.playCount ?? 0) + 1, lastPlayedAt: playedAt }
      : item
    ));
    currentIndexRef.current = index;
    setCurrentIndex(index);
    setScreen("nowPlaying");
    const requestId = ++playbackRequestRef.current;
    if (shuffleOnRef.current) {
      shufflePlayedSongNamesRef.current.add(song.file.name);
    }
    if (queuedSongNamesRef.current.includes(song.file.name)) {
      const nextQueue = queuedSongNamesRef.current.filter((name) => name !== song.file.name);
      queuedSongNamesRef.current = nextQueue;
      setQueuedSongNames(nextQueue);
    }

    if (Capacitor.getPlatform() === "android") {
      void startNativeQueue(song, index, playlistId).then(() => {
        if (requestId !== playbackRequestRef.current) return;
        isPlayingRef.current = true;
        setIsPlaying(true);
      }).catch((error) => {
        if (requestId !== playbackRequestRef.current) return;
        console.error("Android native playback could not start:", error);
        isPlayingRef.current = false;
        setIsPlaying(false);
        setImportNotice(`Could not prepare "${song.name}" for Android playback. Re-import the track and try again.`);
      });
    } else if (audio) {
      setAudioSource(song.file);
      audio.playbackRate = playbackSpeed;
      audio.play().then(() => {
        if (requestId !== playbackRequestRef.current) return;
        isPlayingRef.current = true;
        setIsPlaying(true);
      }).catch((error) => {
        if (requestId !== playbackRequestRef.current) return;
        console.error("Local playback failed:", error);
        isPlayingRef.current = false;
        setIsPlaying(false);
        setImportNotice(`Could not play "${song.name}". Tap Play to try again.`);
      });
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
  };

  const pickRandomIndex = (length: number, exclude: number) => {
    if (length <= 1) return 0;
    let idx = exclude;
    while (idx === exclude) idx = Math.floor(Math.random() * length);
    return idx;
  };

  const toggleFavorite = (song: SongItem) => {
    setFavoriteSongNames((previous) =>
      previous.includes(song.file.name)
        ? previous.filter((name) => name !== song.file.name)
        : [...previous, song.file.name]
    );
    triggerHaptic("select", hapticsOn);
  };

  const enqueueSong = (song: SongItem) => {
    setQueuedSongNames((previous) => {
      if (previous.includes(song.file.name)) return previous;
      const next = [...previous, song.file.name];
      queuedSongNamesRef.current = next;
      return next;
    });
    triggerHaptic("select", hapticsOn);
  };

  const playSongNext = (song: SongItem) => {
    setQueuedSongNames((previous) => {
      const next = [song.file.name, ...previous.filter((name) => name !== song.file.name)];
      queuedSongNamesRef.current = next;
      return next;
    });
    setImportNotice(`${song.name} will play next.`);
    triggerHaptic("select", hapticsOn);
  };

  const moveQueuedSong = (fileName: string, direction: -1 | 1) => {
    setQueuedSongNames((previous) => {
      const index = previous.indexOf(fileName);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      queuedSongNamesRef.current = next;
      return next;
    });
  };

  const addSongToPlaylist = (playlistId: string, song: SongItem) => {
    setPlaylists((previous) => previous.map((playlist) => (
      playlist.id === playlistId && !playlist.songNames.includes(song.file.name)
        ? { ...playlist, songNames: [...playlist.songNames, song.file.name] }
        : playlist
    )));
    triggerHaptic("select", hapticsOn);
  };

  const removeSongFromPlaylist = (playlistId: string, fileName: string) => {
    setPlaylists((previous) => previous.map((playlist) => (
      playlist.id === playlistId
        ? { ...playlist, songNames: playlist.songNames.filter((name) => name !== fileName) }
        : playlist
    )));
    if (activePlaylistIdRef.current === playlistId) {
      const nextOrder = playlistPlaybackOrderRef.current.filter((name) => name !== fileName);
      playlistPlaybackOrderRef.current = nextOrder;
      setPlaylistPlaybackOrder(nextOrder);
      if (currentSong?.file.name === fileName) {
        const nextSongs = nextOrder
          .map((name) => localSongsRef.current.find((song) => song.file.name === name))
          .filter((song): song is SongItem => song !== undefined);
        const nextIndex = Math.min(currentIndexRef.current, nextSongs.length - 1);
        if (nextIndex >= 0) {
          playSong(nextSongs[nextIndex], nextIndex, playlistId);
        } else {
          releaseAudioSource();
          activePlaylistIdRef.current = null;
          playlistPlaybackOrderRef.current = [];
          setActivePlaylistId(null);
          setPlaylistPlaybackOrder([]);
          setCurrentSong(null);
          setCurrentIndex(0);
          setIsPlaying(false);
        }
      } else if (currentSong) {
        const nextIndex = nextOrder.indexOf(currentSong.file.name);
        if (nextIndex >= 0) {
          currentIndexRef.current = nextIndex;
          setCurrentIndex(nextIndex);
        }
      }
    }
    triggerHaptic("select", hapticsOn);
  };

  const createPlaylist = () => {
    const name = window.prompt("Name your playlist")?.trim();
    if (!name) return;
    const id = `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPlaylists((previous) => [...previous, { id, name, songNames: [] }]);
    setMenuStack((previous) => [...previous, `playlist_${id}`]);
    setSelectedIndex(0);
    triggerHaptic("confirm", hapticsOn);
  };

  const toggleMoviePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => {
        console.error("Movie playback failed:", error);
        setMovieIsPlaying(false);
        window.alert("This video format or codec could not be played on this device.");
      });
    } else {
      video.pause();
    }
  };

  const toggleShuffle = () => {
    setShuffleOn((previous) => {
      const next = !previous;
      shuffleOnRef.current = next;
      shufflePlayedSongNamesRef.current.clear();
      const activeSongName = currentSong?.file.name;
      if (next && activeSongName) shufflePlayedSongNamesRef.current.add(activeSongName);
      return next;
    });
  };

  const cycleRepeat = () => {
    setRepeatMode((previous) => {
      const next = previous === "off" ? "all" : previous === "all" ? "one" : "off";
      repeatModeRef.current = next;
      return next;
    });
  };

  const setSleepTimerMinutes = (minutes: number) => {
    if (sleepFadeStartVolumeRef.current !== null && audioRef.current) {
      audioRef.current.volume = sleepFadeStartVolumeRef.current;
      sleepFadeStartVolumeRef.current = null;
    }
    setSleepTimerEndAt(Date.now() + minutes * 60_000);
    triggerHaptic("select", hapticsOn);
  };

  const cancelSleepTimer = () => {
    if (sleepFadeStartVolumeRef.current !== null && audioRef.current) {
      audioRef.current.volume = sleepFadeStartVolumeRef.current;
      sleepFadeStartVolumeRef.current = null;
    }
    setSleepTimerEndAt(null);
    triggerHaptic("select", hapticsOn);
  };

  const removeQueuedSong = (fileName: string) => {
    const previous = queuedSongNamesRef.current;
    const index = previous.indexOf(fileName);
    if (index < 0) return;
    setQueueUndo({ fileName, index });
    if (queueUndoTimerRef.current) clearTimeout(queueUndoTimerRef.current);
    queueUndoTimerRef.current = setTimeout(() => setQueueUndo(null), 5000);
    setImportNotice("Song removed from queue. You can undo this for 5 seconds.");
    const next = previous.filter((name) => name !== fileName);
    queuedSongNamesRef.current = next;
    setQueuedSongNames(next);
  };

  const undoQueueRemoval = () => {
    if (!queueUndo) return;
    setQueuedSongNames((previous) => {
      if (previous.includes(queueUndo.fileName)) return previous;
      const next = [...previous];
      next.splice(Math.min(queueUndo.index, next.length), 0, queueUndo.fileName);
      queuedSongNamesRef.current = next;
      return next;
    });
    setQueueUndo(null);
    if (queueUndoTimerRef.current) clearTimeout(queueUndoTimerRef.current);
    setImportNotice(null);
  };

  const playNextQueuedSong = (keepRadioMode = false) => {
    const queue = [...queuedSongNamesRef.current];
    const songs = localSongsRef.current;
    const queuedIndex = queue.findIndex((name) => songs.some((song) => song.file.name === name));

    if (queuedIndex === -1) {
      if (queue.length > 0) {
        queuedSongNamesRef.current = [];
        setQueuedSongNames([]);
      }
      return false;
    }

    const [fileName] = queue.splice(queuedIndex, 1);
    queuedSongNamesRef.current = [...queue];
    setQueuedSongNames([...queue]);

    const songIndex = songs.findIndex((song) => song.file.name === fileName);
    if (keepRadioMode) {
      const history = radioStationNamesRef.current.slice(0, radioPositionRef.current + 1);
      if (history[history.length - 1] !== fileName) history.push(fileName);
      radioStationNamesRef.current = history;
      radioPositionRef.current = history.length - 1;
    }
    playSong(songs[songIndex], songIndex, null, keepRadioMode);
    return true;
  };

  const playPlaylist = (playlistId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    const names = [...playlist.songNames];
    if (names.length === 0) {
      window.alert("Add songs to this playlist before playing it.");
      return;
    }
    if (playlistShuffleSelection[playlistId]) {
      for (let index = names.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [names[index], names[swapIndex]] = [names[swapIndex], names[index]];
      }
    }
    const playlistSongs = names
      .map((name) => localSongsRef.current.find((song) => song.file.name === name))
      .filter((song): song is SongItem => song !== undefined);
    if (playlistSongs.length === 0) return;
    activePlaylistIdRef.current = playlistId;
    playlistPlaybackOrderRef.current = names;
    setActivePlaylistId(playlistId);
    setPlaylistPlaybackOrder(names);
    shufflePlayedSongNamesRef.current.clear();
    playSong(playlistSongs[0], 0, playlistId);
  };

  const playPlaylistSong = (song: SongItem, playlistId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return;
    const names = [...playlist.songNames];
    const songIndex = names.indexOf(song.file.name);
    if (songIndex < 0) return;
    activePlaylistIdRef.current = playlistId;
    playlistPlaybackOrderRef.current = names;
    setActivePlaylistId(playlistId);
    setPlaylistPlaybackOrder(names);
    shufflePlayedSongNamesRef.current.clear();
    playSong(song, songIndex, playlistId);
  };

  const radioTextTokens = (song: SongItem) => new Set(
    `${song.name} ${song.artist ?? ""} ${song.album ?? ""}`
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !["the", "and", "feat", "with", "from", "remaster"].includes(token))
  );

  const rankRadioTracks = (anchor: SongItem, excludedNames: Set<string>) => {
    const anchorArtist = anchor.artist?.trim().toLocaleLowerCase() ?? "";
    const anchorAlbum = anchor.album?.trim().toLocaleLowerCase() ?? "";
    const anchorTokens = radioTextTokens(anchor);
    const now = Date.now();
    return localSongsRef.current
      .filter((song) => song.file.name !== anchor.file.name && !excludedNames.has(song.file.name) && !radioSkippedNamesRef.current.has(song.file.name))
      .map((song) => {
        const artist = song.artist?.trim().toLocaleLowerCase() ?? "";
        const album = song.album?.trim().toLocaleLowerCase() ?? "";
        const sameArtist = Boolean(anchorArtist && artist === anchorArtist);
        const sameAlbum = Boolean(anchorAlbum && album === anchorAlbum);
        const tokens = radioTextTokens(song);
        const sharedTokens = [...tokens].filter((token) => anchorTokens.has(token)).length;
        const titleSimilarity = sharedTokens / Math.max(1, new Set([...tokens, ...anchorTokens]).size);
        const favorite = favoriteSongNames.includes(song.file.name);
        const recentPlays = song.lastPlayedAt ? Math.max(0, now - song.lastPlayedAt) : Infinity;
        const artistTaste = artist ? radioArtistTasteRef.current[artist] ?? 0 : 0;
        const albumTaste = album ? radioAlbumTasteRef.current[album] ?? 0 : 0;
        const tokenTaste = [...tokens].reduce((sum, token) => sum + (radioTokenTasteRef.current[token] ?? 0), 0) / Math.max(1, tokens.size);
        const familiarMode = !radioDiscoveryModeRef.current;
        let weight = 1 + (sameArtist ? (familiarMode ? 3 : 0.75) : 0);
        weight += sameAlbum ? (familiarMode ? 2 : 0.5) : 0;
        weight += titleSimilarity * (familiarMode ? 4 : 1.25);
        weight += artistTaste * (familiarMode ? 0.8 : 0.35) + albumTaste * (familiarMode ? 0.55 : 0.25);
        weight += tokenTaste * (familiarMode ? 0.75 : 0.4);
        weight += favorite ? (familiarMode ? 0.8 : 0.25) : 0;
        weight += Math.min(1.5, Math.log2(1 + (song.playCount ?? 0)) * (familiarMode ? 0.25 : 0.1));
        if (radioDiscoveryModeRef.current && (song.playCount ?? 0) === 0) weight += 2.5;
        if (recentPlays < 24 * 60 * 60 * 1000) weight *= 0.25;
        else if (recentPlays < 7 * 24 * 60 * 60 * 1000) weight *= 0.6;
        return {
          song,
          priority: -Math.log(Math.max(Number.EPSILON, Math.random())) / Math.max(0.1, weight),
          sameArtist,
          sameAlbum,
          titleSimilarity,
          artistTaste,
          albumTaste,
          favorite,
        };
      })
      .sort((left, right) => left.priority - right.priority);
  };

  const getRadioReason = (anchor: SongItem, song: SongItem) => {
    const artist = song.artist?.trim().toLocaleLowerCase() ?? "";
    const album = song.album?.trim().toLocaleLowerCase() ?? "";
    if (anchor.album && song.album && anchor.album.trim().toLocaleLowerCase() === album) {
      return `same album as ${anchor.name}`;
    }
    if (anchor.artist && song.artist && anchor.artist.trim().toLocaleLowerCase() === artist) {
      return `same artist as ${anchor.name}`;
    }
    if ((artist && (radioArtistTasteRef.current[artist] ?? 0) > 0) || (album && (radioAlbumTasteRef.current[album] ?? 0) > 0)) {
      return "based on your Radio feedback";
    }
    const anchorTokens = radioTextTokens(anchor);
    if ([...radioTextTokens(song)].some((token) => anchorTokens.has(token))) return "similar title or album details";
    if (favoriteSongNames.includes(song.file.name)) return "one of your favorites";
    if ((song.playCount ?? 0) === 0) return "a new-to-you discovery";
    return radioDiscoveryModeRef.current ? "a fresh discovery" : "a less-recent library track";
  };

  const startRadioFrom = (seed: SongItem) => {
    if (localSongsRef.current.filter((song) => song.file.name !== seed.file.name).length === 0) {
      setImportNotice("Retro Radio needs at least two songs in your library.");
      return;
    }
    const seedIndex = localSongsRef.current.findIndex((song) => song.file.name === seed.file.name);
    if (seedIndex < 0) return;
    radioSeedSongRef.current = seed;
    radioStationNamesRef.current = [seed.file.name];
    radioPositionRef.current = 0;
    radioSkippedNamesRef.current = new Set();
    setRadioDiscoveryMode(false);
    radioDiscoveryModeRef.current = false;
    radioModeOnRef.current = true;
    setRadioModeOn(true);
    setRadioRecommendationReason(`Station seeded from "${seed.name}". Next track will be picked as you listen.`);
    playSong(seed, seedIndex, null, true);
    setImportNotice(`Retro Radio started from "${seed.name}". Your feedback will tune future picks.`);
    triggerHaptic("confirm", hapticsOn);
  };

  const stopRadio = () => {
    radioModeOnRef.current = false;
    setRadioModeOn(false);
    radioStationNamesRef.current = [];
    radioPositionRef.current = 0;
    radioSeedSongRef.current = null;
    radioSkippedNamesRef.current = new Set();
    setRadioRecommendationReason("");
    setImportNotice("Retro Radio stopped.");
    triggerHaptic("select", hapticsOn);
  };

  const adjustRadioTaste = (song: SongItem, amount: number) => {
    const artist = song.artist?.trim().toLocaleLowerCase() ?? "";
    const album = song.album?.trim().toLocaleLowerCase() ?? "";
    let learnedFromMetadata = false;
    if (artist) {
      const next = { ...radioArtistTasteRef.current, [artist]: Math.max(-5, Math.min(5, (radioArtistTasteRef.current[artist] ?? 0) + amount)) };
      radioArtistTasteRef.current = next;
      setRadioArtistTaste(next);
      learnedFromMetadata = true;
    }
    if (album) {
      const next = { ...radioAlbumTasteRef.current, [album]: Math.max(-5, Math.min(5, (radioAlbumTasteRef.current[album] ?? 0) + amount)) };
      radioAlbumTasteRef.current = next;
      setRadioAlbumTaste(next);
      learnedFromMetadata = true;
    }
    const tokens = [...radioTextTokens(song)].slice(0, 12);
    if (tokens.length > 0) {
      const next = { ...radioTokenTasteRef.current };
      for (const token of tokens) {
        next[token] = Math.max(-5, Math.min(5, (next[token] ?? 0) + amount * 0.5));
      }
      radioTokenTasteRef.current = next;
      setRadioTokenTaste(next);
      learnedFromMetadata = true;
    }
    return learnedFromMetadata;
  };

  const advanceRadio = (direction: -1 | 1 = 1, wasSkipped = false) => {
    const station = radioStationNamesRef.current;
    const seed = radioSeedSongRef.current;
    if (!station.length || !seed) return false;
    const songs = localSongsRef.current;
    if (direction < 0) {
      if (radioPositionRef.current <= 0) return false;
      radioPositionRef.current -= 1;
      const previousSong = songs.find((song) => song.file.name === station[radioPositionRef.current]);
      if (!previousSong) return false;
      const previousIndex = songs.indexOf(previousSong);
      playSong(previousSong, previousIndex, null, true);
      setRadioRecommendationReason(`Back in this station • ${getRadioReason(seed, previousSong)}`);
      return true;
    }

    const currentName = station[radioPositionRef.current];
    const anchor = songs.find((song) => song.file.name === currentName) ?? currentSong ?? seed;
    let feedbackPrefix = "";
    if (wasSkipped) {
      radioSkippedNamesRef.current.add(anchor.file.name);
      const learned = adjustRadioTaste(anchor, -2);
      feedbackPrefix = learned
        ? `Skip learned for ${anchor.artist || anchor.album}. `
        : "Track skipped for this station. ";
    }
    const excludedNames = new Set(station);
    let candidates = rankRadioTracks(anchor, excludedNames);
    if (candidates.length === 0) {
      candidates = rankRadioTracks(anchor, new Set([anchor.file.name]));
      if (candidates.length === 0) {
        stopRadio();
        setImportNotice("No more available tracks for Retro Radio. Add songs or clear a station skip to continue.");
        return false;
      }
      radioStationNamesRef.current = [anchor.file.name];
      radioPositionRef.current = 0;
    }

    const nextPick = candidates[0];
    if (!nextPick) return false;
    const nextSong = nextPick.song;
    radioStationNamesRef.current = [...radioStationNamesRef.current.slice(0, radioPositionRef.current + 1), nextSong.file.name];
    radioPositionRef.current = radioStationNamesRef.current.length - 1;
    const songIndex = songs.findIndex((song) => song.file.name === nextSong.file.name);
    if (songIndex < 0) return false;
    playSong(nextSong, songIndex, null, true);
    setRadioRecommendationReason(`${feedbackPrefix}${radioDiscoveryModeRef.current ? "Discovery" : "Familiar"} pick • ${getRadioReason(anchor, nextSong)}`);
    return true;
  };

  const giveRadioPositiveFeedback = () => {
    if (!currentSong) return;
    const learned = adjustRadioTaste(currentSong, 2);
    setRadioRecommendationReason(learned
      ? currentSong.artist || currentSong.album
        ? `Got it — future picks will lean toward ${currentSong.artist || currentSong.album}.`
        : `Got it — future picks will follow themes in "${currentSong.name}".`
      : "No usable track details to learn from. Add title, artist, or album information.");
    triggerHaptic("confirm", hapticsOn);
  };

  const toggleRadioDiscovery = () => {
    const next = !radioDiscoveryModeRef.current;
    radioDiscoveryModeRef.current = next;
    setRadioDiscoveryMode(next);
    setRadioRecommendationReason(next
      ? "Discovery mode: prioritize unfamiliar tracks and variety."
      : "Familiar mode: lean into related artists, albums, and your feedback.");
    triggerHaptic("select", hapticsOn);
  };

  const rejectRadioTrack = () => {
    if (radioModeOnRef.current) advanceRadio(1, true);
  };

  const renderRadioControls = (compact = false) => {
    if (!radioModeOn || !currentSong) return null;
    return (
      <section className={`mx-auto mt-1.5 w-full max-w-md rounded-xl border border-white/15 bg-black/30 text-white shadow-sm ${compact ? "p-1.5" : "p-2.5"}`}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-white/80">
            <Radio size={13} className="shrink-0" />
            <span className="truncate">Retro Radio</span>
          </div>
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-white/70">
            {radioDiscoveryMode ? "Discovery" : "Familiar mix"}
          </span>
        </div>
        <p className={`mt-1.5 break-words text-[9px] leading-relaxed text-white/70 ${compact ? "line-clamp-2 text-[8px] leading-snug" : ""}`}>{radioRecommendationReason}</p>
        <div className={`mt-1.5 grid gap-1.5 ${compact ? "grid-cols-3" : "grid-cols-2 gap-2"}`}>
          <button
            type="button"
            onClick={giveRadioPositiveFeedback}
            className={`min-w-0 rounded-lg border border-white/10 bg-white/10 font-bold leading-tight transition-colors hover:bg-white/15 active:bg-white/20 ${compact ? "min-h-7 break-words px-1 py-1 text-center text-[8px]" : "min-h-9 px-2.5 py-2 text-[9px]"}`}
          >
            More like this
          </button>
          <button
            type="button"
            onClick={toggleRadioDiscovery}
            className={`min-w-0 rounded-lg border border-white/10 bg-white/10 font-bold leading-tight transition-colors hover:bg-white/15 active:bg-white/20 ${compact ? "min-h-7 break-words px-1 py-1 text-center text-[8px]" : "min-h-9 px-2.5 py-2 text-[9px]"}`}
          >
            {radioDiscoveryMode ? "Switch to Familiar" : "Surprise me"}
          </button>
          <button
            type="button"
            onClick={rejectRadioTrack}
            aria-label="Not for me; skip and teach Retro Radio"
            title="Skip this and tune future picks away from it"
            className={`min-w-0 rounded-lg border border-white/10 bg-black/20 font-semibold text-white/65 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15 ${compact ? "min-h-7 break-words px-1 py-1 text-center text-[8px]" : "col-span-2 min-h-8 px-2.5 py-1.5 text-[9px]"}`}
          >
            {compact ? "Not for me" : "Not for me · skip this track"}
          </button>
        </div>
      </section>
    );
  };

  const handleNextSong = () => {
    const playbackSongs = getPlaybackSongs();
    if (activePlaylistIdRef.current) {
      if (playbackSongs.length === 0) return;
      const nextIndex = (currentIndexRef.current + 1) % playbackSongs.length;
      playSong(playbackSongs[nextIndex], nextIndex, activePlaylistIdRef.current);
      return;
    }
    if (playNextQueuedSong(radioModeOnRef.current)) return;
    if (radioModeOnRef.current) {
      advanceRadio(1, true);
      return;
    }
    if (localSongs.length === 0) return;
    const nextIdx = shuffleOnRef.current ? pickRandomIndex(localSongs.length, currentIndex) : (currentIndex + 1) % localSongs.length;
    playSong(localSongs[nextIdx], nextIdx);
  };

  const handlePrevSong = () => {
    if (radioModeOnRef.current) {
      advanceRadio(-1);
      return;
    }
    const playbackSongs = getPlaybackSongs();
    if (playbackSongs.length === 0) return;
    const prevIdx = (currentIndexRef.current - 1 + playbackSongs.length) % playbackSongs.length;
    playSong(playbackSongs[prevIdx], prevIdx, activePlaylistIdRef.current);
  };

  const handleTrackEnded = () => {
    if (repeatModeRef.current === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        const requestId = playbackRequestRef.current;
        audioRef.current.play().catch((error) => {
          if (requestId !== playbackRequestRef.current) return;
          console.error("Unable to repeat the current track:", error);
          setIsPlaying(false);
          setImportNotice("The track could not restart. Tap Play to try again.");
        });
      }
      return;
    }

    const playbackSongs = getPlaybackSongs();
    if (playbackSongs.length === 0) return;

    if (!activePlaylistIdRef.current && playNextQueuedSong(radioModeOnRef.current)) return;
    if (radioModeOnRef.current) {
      advanceRadio();
      return;
    }

    if (shuffleOnRef.current && !activePlaylistIdRef.current) {
      const currentName = playbackSongs[currentIndexRef.current]?.file.name;
      if (currentName) shufflePlayedSongNamesRef.current.add(currentName);
      const unplayed = playbackSongs
        .map((song, index) => ({ song, index }))
        .filter(({ song }) => !shufflePlayedSongNamesRef.current.has(song.file.name));
      if (unplayed.length === 0 && repeatModeRef.current === "off") {
        setIsPlaying(false);
        return;
      }
      if (unplayed.length === 0) {
        shufflePlayedSongNamesRef.current.clear();
        const currentName = playbackSongs[currentIndexRef.current]?.file.name;
        if (currentName) shufflePlayedSongNamesRef.current.add(currentName);
        unplayed.push(...playbackSongs
          .map((song, index) => ({ song, index }))
          .filter(({ song }) => song.file.name !== currentName));
        if (unplayed.length === 0) {
          const currentSong = playbackSongs[currentIndexRef.current];
          if (currentSong) playSong(currentSong, currentIndexRef.current, activePlaylistIdRef.current);
          return;
        }
      }
      const chosen = unplayed[Math.floor(Math.random() * unplayed.length)];
      const nextIdx = chosen.index;
      playSong(playbackSongs[nextIdx], nextIdx, activePlaylistIdRef.current);
      return;
    }

    const isLast = currentIndexRef.current === playbackSongs.length - 1;
    if (isLast && repeatModeRef.current === "off") {
      setIsPlaying(false);
      return;
    }

    const nextIdx = (currentIndexRef.current + 1) % playbackSongs.length;
    playSong(playbackSongs[nextIdx], nextIdx, activePlaylistIdRef.current);
  };

  const latestNextSong = useRef(handleNextSong);
  const latestPrevSong = useRef(handlePrevSong);
  const latestTrackEnded = useRef(handleTrackEnded);
  const latestLoadPersistedSongs = useRef(loadPersistedSongs);
  const latestEnsureAudioGraph = useRef(ensureAudioGraph);
  useEffect(() => {
    latestNextSong.current = handleNextSong;
    latestPrevSong.current = handlePrevSong;
    latestTrackEnded.current = handleTrackEnded;
    latestLoadPersistedSongs.current = loadPersistedSongs;
    latestEnsureAudioGraph.current = ensureAudioGraph;
  });

  const applyNativePlaybackState = (state: {
    fileName?: string;
    playing?: boolean;
    position?: number;
    duration?: number;
    sleepTimerEndAt?: number;
    sleepFadeEnabled?: boolean;
  }) => {
    if (typeof state.playing === "boolean") {
      isPlayingRef.current = state.playing;
      setIsPlaying(state.playing);
    }
    if (typeof state.position === "number" && Number.isFinite(state.position)) {
      const position = Math.max(0, state.position / 1000);
      if (screen === "nowPlaying") setCurrentTime(position);
      localStorage.setItem("retro_last_time", String(position));
    }
    if (typeof state.duration === "number" && Number.isFinite(state.duration)) {
      setDuration(Math.max(0, state.duration / 1000));
    }
    if (typeof state.sleepTimerEndAt === "number" && Number.isFinite(state.sleepTimerEndAt)) {
      setSleepTimerEndAt(state.sleepTimerEndAt > 0 ? state.sleepTimerEndAt : null);
    }
    if (typeof state.sleepFadeEnabled === "boolean") {
      setSleepFadeEnabled(state.sleepFadeEnabled);
    }
    if (!state.fileName) return;
    const song = localSongsRef.current.find((item) => item.file.name === state.fileName);
    if (!song) return;
    setCurrentSong((current) => current?.file.name === song.file.name ? current : song);
    const currentIndex = getPlaybackSongs().findIndex((item) => item.file.name === song.file.name);
    if (currentIndex >= 0) {
      currentIndexRef.current = currentIndex;
      setCurrentIndex(currentIndex);
    }
    const queued = queuedSongNamesRef.current.filter((name) => name !== song.file.name);
    if (queued.length !== queuedSongNamesRef.current.length) {
      queuedSongNamesRef.current = queued;
      setQueuedSongNames(queued);
    }
  };
  const applyNativePlaybackStateRef = useRef(applyNativePlaybackState);
  applyNativePlaybackStateRef.current = applyNativePlaybackState;

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const handleNativePlaybackState = (event: Event) => {
      const state = (event as CustomEvent<{
        fileName?: string;
        playing?: boolean;
        position?: number;
        duration?: number;
        sleepTimerEndAt?: number;
        sleepFadeEnabled?: boolean;
      }>).detail;
      applyNativePlaybackStateRef.current(state);
    };
    window.addEventListener("native-playback-state", handleNativePlaybackState);
    return () => window.removeEventListener("native-playback-state", handleNativePlaybackState);
  }, []);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") {
      setNativePlaybackStateLoaded(true);
      return;
    }
    if (!songsLoaded) return;
    AndroidPlayback.queryState().then((state) => {
      applyNativePlaybackStateRef.current(state);
      setNativePlaybackStateLoaded(true);
    }).catch((error) => {
      console.error("Unable to restore Android playback state:", error);
    });
  }, [songsLoaded]);

  useEffect(() => {
    if (screen !== "nowPlaying" || Capacitor.getPlatform() !== "android") return;
    AndroidPlayback.queryState().then((state) => {
      applyNativePlaybackStateRef.current(state);
    }).catch((error) => {
      console.error("Unable to refresh Android playback state:", error);
    });
  }, [screen]);

  // --- INITIALIZATION EFFECTS ---
  useEffect(() => {
    setShowOnboarding(true);

    const savedTheme = localStorage.getItem("retro_theme");
    if (savedTheme && lcdThemes.some((theme) => theme === savedTheme)) {
      setLcdTheme(savedTheme as LcdTheme);
    }
    
    const savedHaptics = localStorage.getItem("retro_haptics");
    if (savedHaptics !== null) setHapticsOn(savedHaptics === "true");

    const savedRadioArtistTaste = readRadioTasteProfile("retro_radio_artist_taste");
    radioArtistTasteRef.current = savedRadioArtistTaste;
    setRadioArtistTaste(savedRadioArtistTaste);
    const savedRadioAlbumTaste = readRadioTasteProfile("retro_radio_album_taste");
    radioAlbumTasteRef.current = savedRadioAlbumTaste;
    setRadioAlbumTaste(savedRadioAlbumTaste);
    const savedRadioTokenTaste = readRadioTasteProfile("retro_radio_token_taste");
    radioTokenTasteRef.current = savedRadioTokenTaste;
    setRadioTokenTaste(savedRadioTokenTaste);
    
    const savedSpeed = localStorage.getItem("retro_speed");
    if (savedSpeed) setPlaybackSpeed(parseFloat(savedSpeed));

    const savedShuffle = localStorage.getItem("retro_shuffle");
    if (savedShuffle !== null) setShuffleOn(savedShuffle === "true");

    const savedRepeat = localStorage.getItem("retro_repeat");
    if (savedRepeat === "off" || savedRepeat === "one" || savedRepeat === "all") {
      setRepeatMode(savedRepeat);
    }

    const savedClock = localStorage.getItem("retro_clock24");
    if (savedClock !== null) setClock24h(savedClock === "true");

    const savedDetailedView = localStorage.getItem("retro_detailed_view");
    if (savedDetailedView !== null) setDetailedViewEnabled(savedDetailedView === "true");

    const savedArtworkBackground = localStorage.getItem("retro_artwork_lcd_background");
    if (savedArtworkBackground !== null) setArtworkLcdBackgroundEnabled(savedArtworkBackground === "true");

    const savedResumePlayback = localStorage.getItem("retro_resume_playback");
    if (savedResumePlayback !== null) {
      const enabled = savedResumePlayback === "true";
      setResumePlaybackEnabled(enabled);
      resumePlaybackEnabledRef.current = enabled;
    }
    const savedSeekJump = Number(localStorage.getItem("retro_seek_jump"));
    if ([5, 10, 15].includes(savedSeekJump)) setSeekJumpSeconds(savedSeekJump);
    const savedSleepFade = localStorage.getItem("retro_sleep_fade");
    if (savedSleepFade !== null) {
      const enabled = savedSleepFade === "true";
      setSleepFadeEnabled(enabled);
      sleepFadeEnabledRef.current = enabled;
    }
    setLargeTextEnabled(localStorage.getItem("retro_large_text") === "true");
    setHighContrastEnabled(localStorage.getItem("retro_high_contrast") === "true");
    setReducedMotionEnabled(localStorage.getItem("retro_reduced_motion") === "true");

    const savedEQ = localStorage.getItem("retro_eq_gains");
    if (savedEQ) {
      try {
        const gains: unknown = JSON.parse(savedEQ);
        if (
          Array.isArray(gains) &&
          gains.length === 5 &&
          gains.every((gain) => typeof gain === "number" && Number.isFinite(gain))
        ) {
          setEqGains(gains);
        }
      } catch (error) {
        console.warn("Unable to restore equalizer settings:", error);
      }
    }

    const savedFavorites = localStorage.getItem("retro_favorites");
    const savedQueue = localStorage.getItem("retro_queue");
    const savedPlaylists = localStorage.getItem("retro_playlists");
    try {
      if (savedFavorites) {
        const parsed = JSON.parse(savedFavorites);
        if (Array.isArray(parsed) && parsed.every((name) => typeof name === "string")) {
          setFavoriteSongNames(parsed);
        }
      }
      if (savedQueue) {
        const parsed = JSON.parse(savedQueue);
        if (Array.isArray(parsed) && parsed.every((name) => typeof name === "string")) {
          setQueuedSongNames(parsed);
          queuedSongNamesRef.current = parsed;
        }
      }
      if (savedPlaylists) {
        const parsed: unknown = JSON.parse(savedPlaylists);
        if (
          Array.isArray(parsed) &&
          parsed.every((playlist) =>
            typeof playlist === "object" &&
            playlist !== null &&
            "id" in playlist &&
            typeof playlist.id === "string" &&
            "name" in playlist &&
            typeof playlist.name === "string" &&
            "songNames" in playlist &&
            Array.isArray(playlist.songNames) &&
            playlist.songNames.every((name: unknown) => typeof name === "string")
          )
        ) {
          setPlaylists(parsed as UserPlaylist[]);
        }
      }
    } catch (error) {
      console.warn("Unable to restore favorites or queue:", error);
    }
    setLibraryPreferencesLoaded(true);

    const updateClock = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24hRef.current }));
    };

    let persistenceTick = 0;
    const updateSleepTimer = () => {
      const endAt = sleepTimerEndAtRef.current;
      if (endAt !== null) {
        const remaining = endAt - Date.now();
        const audio = audioRef.current;
        if (sleepFadeEnabledRef.current && remaining <= 10_000 && remaining > 0 && audio) {
          if (sleepFadeStartVolumeRef.current === null) sleepFadeStartVolumeRef.current = audio.volume;
          audio.volume = Math.max(0, sleepFadeStartVolumeRef.current * (remaining / 10_000));
        }
        if (remaining <= 0) {
          if (audio && sleepFadeStartVolumeRef.current !== null) audio.volume = sleepFadeStartVolumeRef.current;
          sleepFadeStartVolumeRef.current = null;
          setIsPlaying(false);
          audio?.pause();
          setSleepTimerEndAt(null);
        }
      }

      persistenceTick += 1;
      if (persistenceTick % 5 === 0 && resumePlaybackEnabledRef.current && audioRef.current && !audioRef.current.paused) {
        localStorage.setItem("retro_last_time", audioRef.current.currentTime.toString());
      }
    };
    updateClock();
    updateSleepTimer();
    const clockInterval = setInterval(updateClock, 60_000);
    const sleepTimerInterval = setInterval(updateSleepTimer, 1000);

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    // Keep the shared audio element compatible with the Web Audio graph.
    audioRef.current.crossOrigin = "anonymous";

    const audio = audioRef.current;
    
    const handleVolume = () => {
      setVolOverlay(audio.volume * 100);
      setTimeout(() => setVolOverlay(null), 2500);
    };
    
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (
        "mediaSession" in navigator &&
        typeof navigator.mediaSession.setPositionState === "function" &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration),
        });
      }
    };
    
    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const handleEnded = () => {
      latestTrackEnded.current();
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("volumechange", handleVolume);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    void latestLoadPersistedSongs.current();
    void loadPersistedMovies();

    let batteryManager: BatteryManagerLike | null = null;
    let cancelled = false;
    const batteryNavigator = navigator as NavigatorWithBattery;
    const handleBatteryLevelChange = () => {
      if (batteryManager) setBatteryLevel(batteryManager.level * 100);
    };
    const handleBatteryChargingChange = () => {
      if (batteryManager) setIsCharging(batteryManager.charging);
    };

    if (batteryNavigator.getBattery) {
      batteryNavigator.getBattery().then((battery) => {
        if (cancelled) return;
        batteryManager = battery;
        setBatteryLevel(battery.level * 100);
        setIsCharging(battery.charging);
        battery.addEventListener("levelchange", handleBatteryLevelChange);
        battery.addEventListener("chargingchange", handleBatteryChargingChange);
      }).catch((error) => {
        console.warn("Unable to read battery status:", error);
        setBatteryLevel(100);
      });
    } else {
      setBatteryLevel(100); 
    }

    return () => {
      cancelled = true;
      clearInterval(clockInterval);
      clearInterval(sleepTimerInterval);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("volumechange", handleVolume);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      batteryManager?.removeEventListener("levelchange", handleBatteryLevelChange);
      batteryManager?.removeEventListener("chargingchange", handleBatteryChargingChange);
    };
  }, []);

  useEffect(() => {
    const resumePlayback = () => {
      if (document.visibilityState !== "visible" || !isPlayingRef.current) return;
      wakeUpAudioCtx();
      if (audioRef.current?.paused) {
        const requestId = playbackRequestRef.current;
        audioRef.current.play().catch((error) => {
          if (requestId !== playbackRequestRef.current) return;
          console.error("Unable to resume local playback:", error);
          setIsPlaying(false);
        });
      }
    };

    document.addEventListener("visibilitychange", resumePlayback);
    return () => document.removeEventListener("visibilitychange", resumePlayback);
  }, []);

  useEffect(() => { localStorage.setItem("retro_theme", lcdTheme); }, [lcdTheme]);
  useEffect(() => { localStorage.setItem("retro_haptics", String(hapticsOn)); }, [hapticsOn]);
  useEffect(() => { localStorage.setItem("retro_speed", String(playbackSpeed)); }, [playbackSpeed]);
  useEffect(() => { localStorage.setItem("retro_shuffle", String(shuffleOn)); }, [shuffleOn]);
  useEffect(() => { localStorage.setItem("retro_repeat", repeatMode); }, [repeatMode]);
  useEffect(() => { localStorage.setItem("retro_clock24", String(clock24h)); }, [clock24h]);
  useEffect(() => { localStorage.setItem("retro_detailed_view", String(detailedViewEnabled)); }, [detailedViewEnabled]);
  useEffect(() => { localStorage.setItem("retro_artwork_lcd_background", String(artworkLcdBackgroundEnabled)); }, [artworkLcdBackgroundEnabled]);
  useEffect(() => { localStorage.setItem("retro_resume_playback", String(resumePlaybackEnabled)); }, [resumePlaybackEnabled]);
  useEffect(() => { localStorage.setItem("retro_seek_jump", String(seekJumpSeconds)); }, [seekJumpSeconds]);
  useEffect(() => { localStorage.setItem("retro_sleep_fade", String(sleepFadeEnabled)); }, [sleepFadeEnabled]);
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !nativePlaybackStateLoaded) return;
    AndroidPlayback.setSleepTimer({
      endAt: sleepTimerEndAt ?? 0,
      fade: sleepFadeEnabled,
    }).catch((error) => {
      console.error("Unable to synchronize Android sleep timer:", error);
      setImportNotice("The Android sleep timer could not be updated.");
    });
  }, [sleepTimerEndAt, sleepFadeEnabled, nativePlaybackStateLoaded]);
  useEffect(() => { localStorage.setItem("retro_large_text", String(largeTextEnabled)); }, [largeTextEnabled]);
  useEffect(() => { localStorage.setItem("retro_high_contrast", String(highContrastEnabled)); }, [highContrastEnabled]);
  useEffect(() => { localStorage.setItem("retro_reduced_motion", String(reducedMotionEnabled)); }, [reducedMotionEnabled]);
  useEffect(() => {
    if (!libraryPreferencesLoaded) return;
    try {
      localStorage.setItem("retro_radio_artist_taste", JSON.stringify(radioArtistTaste));
    } catch (error) {
      console.error("Unable to save Retro Radio artist preferences:", error);
      setImportNotice("Radio learning could not be saved. Device storage may be full.");
    }
  }, [radioArtistTaste, libraryPreferencesLoaded]);
  useEffect(() => {
    if (!libraryPreferencesLoaded) return;
    try {
      localStorage.setItem("retro_radio_album_taste", JSON.stringify(radioAlbumTaste));
    } catch (error) {
      console.error("Unable to save Retro Radio album preferences:", error);
      setImportNotice("Radio learning could not be saved. Device storage may be full.");
    }
  }, [radioAlbumTaste, libraryPreferencesLoaded]);
  useEffect(() => {
    if (!libraryPreferencesLoaded) return;
    try {
      localStorage.setItem("retro_radio_token_taste", JSON.stringify(radioTokenTaste));
    } catch (error) {
      console.error("Unable to save Retro Radio title preferences:", error);
      setImportNotice("Radio learning could not be saved. Device storage may be full.");
    }
  }, [radioTokenTaste, libraryPreferencesLoaded]);
  useEffect(() => { localStorage.setItem("retro_eq_gains", JSON.stringify(eqGains)); }, [eqGains]);
  useEffect(() => {
    if (libraryPreferencesLoaded) {
      localStorage.setItem("retro_favorites", JSON.stringify(favoriteSongNames));
    }
  }, [favoriteSongNames, libraryPreferencesLoaded]);
  useEffect(() => {
    if (libraryPreferencesLoaded) {
      localStorage.setItem("retro_queue", JSON.stringify(queuedSongNames));
    }
  }, [queuedSongNames, libraryPreferencesLoaded]);
  useEffect(() => {
    if (libraryPreferencesLoaded) {
      localStorage.setItem("retro_playlists", JSON.stringify(playlists));
    }
  }, [playlists, libraryPreferencesLoaded]);
  useEffect(() => {
    if (!songsLoaded) return;
    const metadata = Object.fromEntries(localSongs.map((song) => [
      song.file.name,
      {
        name: song.name,
        artist: song.artist ?? "",
        album: song.album ?? "",
        importedAt: song.importedAt ?? song.file.lastModified,
        playCount: song.playCount ?? 0,
        lastPlayedAt: song.lastPlayedAt ?? 0,
        customArtworkData: song.customArtworkData ?? "",
      },
    ]));
    try {
      localStorage.setItem("retro_song_metadata", JSON.stringify(metadata));
    } catch (error) {
      console.error("Unable to save song metadata:", error);
      setImportNotice("Song details could not be saved. Device storage may be full.");
    }
  }, [localSongs, songsLoaded]);

  useEffect(() => {
    if (currentSong && resumePlaybackEnabled) {
      localStorage.setItem("retro_last_song_name", currentSong.name);
    }
  }, [currentSong, resumePlaybackEnabled]);

  useEffect(() => {
    if (!importNotice || queueUndo) return;
    const timeoutId = setTimeout(() => setImportNotice(null), 6000);
    return () => clearTimeout(timeoutId);
  }, [importNotice, queueUndo]);

  useEffect(() => () => {
    if (queueUndoTimerRef.current) clearTimeout(queueUndoTimerRef.current);
  }, []);

  useEffect(() => {
    if (Capacitor.getPlatform() === "android") {
      if (!currentSong) return;
      AndroidPlayback.setPlaybackSpeed({ speed: playbackSpeed }).catch((error) => {
        console.error("Unable to update Android playback speed:", error);
      });
    } else if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, currentSong]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !currentSong) return;
    AndroidPlayback.setEqualizer({ gains: JSON.stringify(eqGains) }).catch((error) => {
      console.error("Unable to update Android equalizer:", error);
    });
  }, [currentSong, eqGains]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !currentSong) return;
    AndroidPlayback.setRepeatMode({ repeatMode }).catch((error) => {
      console.error("Unable to update Android repeat mode:", error);
    });
  }, [currentSong, repeatMode]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !currentSong) return;
    AndroidPlayback.setShuffle({ shuffle: shuffleOn }).catch((error) => {
      console.error("Unable to update Android shuffle:", error);
    });
  }, [currentSong, shuffleOn]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = movieSpeed;
  }, [movieSpeed, screen, currentMovie]);

  useEffect(() => {
    return () => {
      if (moviePlaybackUrl) URL.revokeObjectURL(moviePlaybackUrl);
    };
  }, [moviePlaybackUrl]);

  useEffect(() => {
    return () => {
      if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
    };
  }, [subtitleUrl]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const isFullscreen = document.fullscreenElement === movieStageRef.current;
      setMovieFullscreen(isFullscreen);
      if (!isFullscreen) {
        setMovieControlsVisible(true);
        if (movieControlsTimerRef.current) clearTimeout(movieControlsTimerRef.current);
        try {
          const orientation = window.screen.orientation as ScreenOrientation & { unlock?: () => void };
          orientation.unlock?.();
        } catch (error) {
          console.warn("Unable to unlock screen orientation:", error);
        }
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (screen !== "moviePlaying" || !videoRef.current) return;
    if (movieIsPlaying) {
      videoRef.current.play().catch((error) => {
        console.error("Movie playback failed:", error);
        setMovieIsPlaying(false);
      });
    } else {
      videoRef.current.pause();
    }
  }, [movieIsPlaying, screen, moviePlaybackUrl]);

  useEffect(() => {
    if (!movieFullscreen || !movieIsPlaying || !movieControlsVisible) return;
    if (movieControlsTimerRef.current) clearTimeout(movieControlsTimerRef.current);
    movieControlsTimerRef.current = setTimeout(() => setMovieControlsVisible(false), 2600);
    return () => {
      if (movieControlsTimerRef.current) clearTimeout(movieControlsTimerRef.current);
    };
  }, [movieFullscreen, movieIsPlaying, movieControlsVisible]);

  useEffect(() => () => {
    if (movieControlsTimerRef.current) clearTimeout(movieControlsTimerRef.current);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (Capacitor.getPlatform() === "android") {
      if (!currentSong) return;
      AndroidPlayback.setPlaying({ playing: isPlaying }).catch((error) => {
        console.error("Unable to update Android playback state:", error);
      });
      return;
    }
    if (isPlaying) {
      if (sourceNodeRef.current || eqGainsRef.current.some((gain) => gain !== 0)) {
        latestEnsureAudioGraph.current();
        wakeUpAudioCtx();
      }
      const requestId = playbackRequestRef.current;
      audioRef.current?.play().catch((error) => {
        if (requestId !== playbackRequestRef.current) return;
        console.error("Playback could not resume:", error);
        isPlayingRef.current = false;
        setIsPlaying(false);
        setImportNotice("Playback could not resume. Tap Play to try again.");
      });
    } else {
      audioRef.current?.pause();
    }
  }, [currentSong, isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = currentSong
      ? isPlaying ? "playing" : "paused"
      : "none";
  }, [currentSong, isPlaying]);

  useEffect(() => {
    const orientation = screen === "moviePlaying" && movieFullscreen ? "landscape" : "portrait";
    if (Capacitor.isNativePlatform()) {
      AndroidPlayback.setOrientation({ orientation }).catch((error) => {
        console.error(`Unable to lock Android orientation to ${orientation}:`, error);
      });
      return;
    }

    const screenOrientation = window.screen.orientation as ScreenOrientation & {
      lock?: (value: "landscape" | "portrait") => Promise<void>;
      unlock?: () => void;
    };
    if (orientation === "landscape") {
      screenOrientation.lock?.("landscape").catch((error) => {
        console.warn("Landscape orientation lock is unavailable on this device:", error);
      });
    } else {
      screenOrientation.unlock?.();
    }
  }, [screen, movieFullscreen]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const clearMediaSession = () => {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
    };

    if (Capacitor.getPlatform() === "android") {
      clearMediaSession();
      return clearMediaSession;
    }

    if (!currentSong || screen === "moviePlaying") {
      clearMediaSession();
      return clearMediaSession;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.name,
      artist: currentSong.artist || "Local Device Library",
      album: currentSong.album || "Retro Custom Player",
      artwork: currentSong.artworkUrl
        ? [{ src: currentSong.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });

    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => latestPrevSong.current());
    navigator.mediaSession.setActionHandler("nexttrack", () => latestNextSong.current());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (!audioRef.current || details.seekTime === undefined) return;
      seekAudioToRef.current(details.seekTime);
    });
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      const position = Capacitor.getPlatform() === "android"
        ? currentTime
        : audioRef.current?.currentTime ?? currentTime;
      seekAudioToRef.current(Math.max(0, position - (details.seekOffset ?? seekJumpSeconds)));
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      const position = Capacitor.getPlatform() === "android"
        ? currentTime
        : audioRef.current?.currentTime ?? currentTime;
      seekAudioToRef.current(Math.min(
        duration || Infinity,
        position + (details.seekOffset ?? seekJumpSeconds)
      ));
    });
    return clearMediaSession;
  }, [currentSong, localSongs, currentIndex, screen, seekJumpSeconds, currentTime, duration]);

  // --- MENUS & UI LOGIC ---
  const menus = useMemo((): Record<string, Menu> => {
    const favoriteSongs = favoriteSongNames
      .map((name) => localSongs.find((song) => song.file.name === name))
      .filter((song): song is SongItem => song !== undefined);
    const queuedSongs = queuedSongNames
      .map((name) => localSongs.find((song) => song.file.name === name))
      .filter((song): song is SongItem => song !== undefined);
    const playlistMenus: Record<string, Menu> = {};
    const browseMenus: Record<string, Menu> = {};
    const artists = [...new Set(localSongs.map((song) => song.artist?.trim()).filter((artist): artist is string => Boolean(artist)))].sort((a, b) => a.localeCompare(b));
    const albums = [...new Set(localSongs.map((song) => song.album?.trim()).filter((album): album is string => Boolean(album)))].sort((a, b) => a.localeCompare(b));
    artists.forEach((artist) => {
      const id = `browse_artist_${encodeURIComponent(artist)}`;
      browseMenus[id] = {
        id,
        title: artist,
        items: localSongs.filter((song) => song.artist?.trim() === artist)
          .map((song) => ({ label: song.name, type: "song" as const, song })),
      };
    });
    albums.forEach((album) => {
      const id = `browse_album_${encodeURIComponent(album)}`;
      browseMenus[id] = {
        id,
        title: album,
        items: localSongs.filter((song) => song.album?.trim() === album)
          .map((song) => ({ label: song.name, type: "song" as const, song })),
      };
    });
    browseMenus.browse_artists = {
      id: "browse_artists",
      title: "Artists",
      items: artists.length
        ? artists.map((artist) => ({ label: artist, type: "menu" as const, targetId: `browse_artist_${encodeURIComponent(artist)}` }))
        : [{ label: "Add artist details to songs to browse by artist.", type: "action" as const, actionId: "noop" }],
    };
    browseMenus.browse_albums = {
      id: "browse_albums",
      title: "Albums",
      items: albums.length
        ? albums.map((album) => ({ label: album, type: "menu" as const, targetId: `browse_album_${encodeURIComponent(album)}` }))
        : [{ label: "Add album details to songs to browse by album.", type: "action" as const, actionId: "noop" }],
    };
    browseMenus.browse_recently_added = {
      id: "browse_recently_added",
      title: "Recently Added",
      items: [...localSongs].sort((a, b) => (b.importedAt ?? b.file.lastModified) - (a.importedAt ?? a.file.lastModified))
        .map((song) => ({ label: song.name, type: "song" as const, song })),
    };
    browseMenus.browse_recently_played = {
      id: "browse_recently_played",
      title: "Recently Played",
      items: [...localSongs].filter((song) => (song.lastPlayedAt ?? 0) > 0)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .map((song) => ({ label: song.name, type: "song" as const, song })),
    };
    browseMenus.browse_most_played = {
      id: "browse_most_played",
      title: "Most Played",
      items: [...localSongs].filter((song) => (song.playCount ?? 0) > 0)
        .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
        .map((song) => ({ label: song.name, type: "song" as const, song })),
    };
    browseMenus.browse_library = {
      id: "browse_library",
      title: "Browse Library",
      items: [
        { label: "Artists", type: "menu", targetId: "browse_artists" },
        { label: "Albums", type: "menu", targetId: "browse_albums" },
        { label: "Recently Added", type: "menu", targetId: "browse_recently_added" },
        { label: "Recently Played", type: "menu", targetId: "browse_recently_played" },
        { label: "Most Played", type: "menu", targetId: "browse_most_played" },
        { label: "Clear Play History", type: "action", actionId: "clear_play_history" },
      ],
    };
    playlists.forEach((playlist) => {
      const playlistSongs = playlist.songNames
        .map((name) => localSongs.find((song) => song.file.name === name))
        .filter((song): song is SongItem => song !== undefined);
      const addableSongs = localSongs.filter((song) => !playlist.songNames.includes(song.file.name));
      playlistMenus[`playlist_${playlist.id}`] = {
        id: `playlist_${playlist.id}`,
        title: playlist.name,
        items: [
          { label: "Options", type: "menu", targetId: `playlist_options_${playlist.id}` },
          ...(playlistSongs.length
            ? playlistSongs.map((song) => ({
                label: song.name,
                type: "song" as const,
                song,
                playlistId: playlist.id,
              }))
            : [{ label: "(No songs yet)", type: "action" as const, actionId: "noop" }]),
        ],
      };
      playlistMenus[`playlist_add_${playlist.id}`] = {
        id: `playlist_add_${playlist.id}`,
        title: `Add to ${playlist.name}`,
        items: addableSongs.length
          ? addableSongs.map((song) => ({
              label: song.name,
              type: "action" as const,
              actionId: "playlist_add_song",
              playlistId: playlist.id,
              song,
            }))
          : [{ label: "(All library songs are added)", type: "action" as const, actionId: "noop" }],
      };
      playlistMenus[`playlist_options_${playlist.id}`] = {
        id: `playlist_options_${playlist.id}`,
        title: `${playlist.name} Options`,
        items: [
          { label: "Add Songs", type: "menu", targetId: `playlist_add_${playlist.id}` },
          { label: "Rename Playlist", type: "action", actionId: `rename_playlist:${playlist.id}` },
          { label: "Delete Playlist", type: "action", actionId: `delete_playlist:${playlist.id}` },
        ],
      };
    });

    return {
      ...playlistMenus,
      ...browseMenus,
      root: {
        id: "root",
        title: "Main Menu",
        items: [
          ...(currentSong ? [{ label: "Now Playing", type: "action" as const, actionId: "go_now_playing" }] : []),
          { label: "Local Audio Library", type: "menu", targetId: "local" },
          { label: radioModeOn ? "Retro Radio (Playing)" : "Retro Radio", type: "menu", targetId: "radio_station" },
          { label: "Movies", type: "action", actionId: "open_movies" },
          { label: "Playback Tools", type: "menu", targetId: "tools" },
          { label: "System Settings", type: "menu", targetId: "settings" }
        ]
      },
      favorites: {
        id: "favorites",
        title: "Favorites",
        items: favoriteSongs.length
          ? favoriteSongs.map((song) => ({ label: song.name, type: "song" as const, song }))
          : [{ label: "(No favorites yet)", type: "action" as const, actionId: "noop" }],
      },
      queue: {
        id: "queue",
        title: "Play Queue",
        items: queuedSongs.length
          ? queuedSongs.map((song) => ({ label: song.name, type: "song" as const, song }))
          : [{ label: "(Queue is empty)", type: "action" as const, actionId: "noop" }],
      },
      radio_station: {
        id: "radio_station",
        title: "Retro Radio",
        items: [
          ...(radioModeOn ? [{ label: "Stop Retro Radio", type: "action" as const, actionId: "stop_radio" }] : []),
          ...(localSongs.length > 1
            ? localSongs.map((song) => ({
                label: `Start station from ${song.name}`,
                type: "action" as const,
                actionId: "start_radio_song",
                song,
              }))
            : [{ label: "Import at least two songs to start a station.", type: "action" as const, actionId: "noop" }]),
        ],
      },
      tools: {
        id: "tools",
        title: "Pro Tools",
        items: [
          { label: "[ 5-Band Equalizer ]", type: "action", actionId: "open_eq" },
          {
            label: radioModeOn ? "Stop Retro Radio" : currentSong ? "Start Retro Radio from Current Song" : "Retro Radio (play a song first)",
            type: "action",
            actionId: radioModeOn ? "stop_radio" : currentSong ? "start_radio_current" : "noop",
          },
        ]
      },
      local: {
        id: "local",
        title: "Music Library",
        items: [
          { label: "All Songs", type: "menu", targetId: "local_songs" },
          { label: "[ Import New Songs ]", type: "action", actionId: "scan_local" },
          { label: "Browse Library", type: "menu", targetId: "browse_library" },
          { label: `Favorites (${favoriteSongNames.length})`, type: "menu", targetId: "favorites" },
          { label: `Playlists (${playlists.length})`, type: "menu", targetId: "playlists" },
          { label: `Play Queue (${queuedSongNames.length})`, type: "menu", targetId: "queue" },
          { label: "[ Clear Play Queue ]", type: "action", actionId: "clear_queue" },
          { label: "[ Manage & Remove ]", type: "menu", targetId: "local_edit" }
        ]
      },
      playlists: {
        id: "playlists",
        title: "Playlists",
        items: [
          { label: "[ Create Playlist ]", type: "action", actionId: "create_playlist" },
          ...(playlists.length
            ? playlists.map((playlist) => ({
                label: playlist.name,
                type: "menu" as const,
                targetId: `playlist_${playlist.id}`,
              }))
            : [{ label: "(No playlists yet)", type: "action" as const, actionId: "noop" }]),
        ],
      },
      local_songs: {
        id: "local_songs",
        title: "All Songs",
        items: localSongs.length > 0
          ? localSongs.map((song) => ({
              label: song.name,
              type: "song" as const,
              song: song
            }))
          : [{ label: "(Library is empty)", type: "action", actionId: "noop" }]
      },
      local_edit: {
        id: "local_edit",
        title: "Remove Songs",
        items: localSongs.length > 0
          ? localSongs.map((song) => ({
              label: `🗑 ${song.name}`,
              type: "action" as const,
              actionId: `delete_song:${song.file.name}`
            }))
          : [{ label: "(Library is empty)", type: "action", actionId: "noop" }]
      },
      settings: {
        id: "settings",
        title: "Settings",
        items: [
          { label: "LCD Theme", type: "menu", targetId: "settings_theme" },
          { label: `Haptics: ${hapticsOn ? "ON" : "OFF"}`, type: "action", actionId: "toggle_haptics" },
          { label: `Shuffle: ${shuffleOn ? "ON" : "OFF"}`, type: "action", actionId: "toggle_shuffle" },
          { label: `Repeat: ${repeatMode === "off" ? "OFF" : repeatMode === "one" ? "ONE" : "ALL"}`, type: "action", actionId: "cycle_repeat" },
          { label: `Detailed Now Playing: ${detailedViewEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_detailed_view" },
          { label: `Artwork LCD Background: ${artworkLcdBackgroundEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_artwork_background" },
          { label: `Resume Last Track: ${resumePlaybackEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_resume_playback" },
          { label: `Seek Jump: ${seekJumpSeconds}s`, type: "menu", targetId: "settings_seek" },
          { label: `Sleep Timer Fade: ${sleepFadeEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_sleep_fade" },
          { label: "Accessibility", type: "menu", targetId: "settings_accessibility" },
          { label: `Clock: ${clock24h ? "24H" : "12H"}`, type: "action", actionId: "toggle_clock" },
          {
            label: sleepTimerEndAt ? `Sleep Timer: ${Math.max(1, Math.ceil((sleepTimerEndAt - Date.now()) / 60000))}m` : "Sleep Timer",
            type: "menu",
            targetId: "settings_sleep",
          },
          { label: "View Onboarding Guide", type: "action", actionId: "show_onboard" },
          { label: "[ Clear Local Library ]", type: "action", actionId: "clear_library" },
        ]
      },
      settings_sleep: {
        id: "settings_sleep",
        title: "Sleep Timer",
        items: [
          { label: sleepTimerEndAt ? "Cancel Timer" : "Off", type: "action", actionId: "sleep_off" },
          { label: "15 Minutes", type: "action", actionId: "sleep_15" },
          { label: "30 Minutes", type: "action", actionId: "sleep_30" },
          { label: "45 Minutes", type: "action", actionId: "sleep_45" },
          { label: "60 Minutes", type: "action", actionId: "sleep_60" },
        ]
      },
      settings_seek: {
        id: "settings_seek",
        title: "Seek Jump",
        items: [5, 10, 15].map((seconds) => ({
          label: `${seekJumpSeconds === seconds ? "✓ " : ""}${seconds} Seconds`,
          type: "action" as const,
          actionId: `seek_jump:${seconds}`,
        })),
      },
      settings_accessibility: {
        id: "settings_accessibility",
        title: "Accessibility",
        items: [
          { label: `Larger Text: ${largeTextEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_large_text" },
          { label: `High Contrast: ${highContrastEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_high_contrast" },
          { label: `Reduced Motion: ${reducedMotionEnabled ? "ON" : "OFF"}`, type: "action", actionId: "toggle_reduced_motion" },
        ],
      },
      settings_theme: {
        id: "settings_theme",
        title: "LCD Theme",
        items: [
          { label: "Burgundy", type: "action", actionId: "theme_burgundy" },
          { label: "Graphite", type: "action", actionId: "theme_graphite" },
          { label: "Champagne", type: "action", actionId: "theme_champagne" },
          { label: "Rose Gold", type: "action", actionId: "theme_rose-gold" },
          { label: "Sage", type: "action", actionId: "theme_sage" },
          { label: "Alpine", type: "action", actionId: "theme_alpine" },
          { label: "Ocean Depths", type: "action", actionId: "theme_ocean-depths" },
          { label: "Aurora", type: "action", actionId: "theme_aurora" },
          { label: "Cobalt", type: "action", actionId: "theme_cobalt" },
          { label: "Amethyst", type: "action", actionId: "theme_amethyst" },
          { label: "Ember", type: "action", actionId: "theme_ember" },
          { label: "Jade", type: "action", actionId: "theme_jade" },
          { label: "Inverted", type: "action", actionId: "theme_inverted" },
          { label: "Solarized", type: "action", actionId: "theme_solarized" },
          { label: "Cyberpunk", type: "action", actionId: "theme_cyberpunk" },
          { label: "Vaporwave", type: "action", actionId: "theme_vaporwave" },
          { label: "Midnight", type: "action", actionId: "theme_midnight" },
          { label: "Arctic", type: "action", actionId: "theme_arctic" },
          { label: "Copper", type: "action", actionId: "theme_copper" },
          { label: "Forest", type: "action", actionId: "theme_forest" },
          { label: "Sepia", type: "action", actionId: "theme_sepia" },
          { label: "Classic Blue", type: "action", actionId: "theme_blue" },
          { label: "Matrix Green", type: "action", actionId: "theme_green" },
          { label: "Amber Warning", type: "action", actionId: "theme_amber" },
          { label: "Monochrome", type: "action", actionId: "theme_gray" },
          { label: "Bubblegum Pink", type: "action", actionId: "theme_pink" },
          { label: "Deep Purple", type: "action", actionId: "theme_purple" },
          { label: "Ocean Teal", type: "action", actionId: "theme_teal" },
          { label: "Ice White", type: "action", actionId: "theme_white" },
          { label: "Sunset Red", type: "action", actionId: "theme_red" },
          { label: "OLED Red", type: "action", actionId: "theme_oled-red" },
          { label: "OLED Amber", type: "action", actionId: "theme_oled-amber" },
          { label: "OLED Green", type: "action", actionId: "theme_oled-green" },
          { label: "OLED Cyan", type: "action", actionId: "theme_oled-cyan" },
          { label: "OLED Magenta", type: "action", actionId: "theme_oled-magenta" },
        ]
      }
    };
  }, [
    currentSong,
    playlists,
    localSongs,
    favoriteSongNames,
    queuedSongNames,
    hapticsOn,
    shuffleOn,
    repeatMode,
    radioModeOn,
    clock24h,
    sleepTimerEndAt,
    detailedViewEnabled,
    artworkLcdBackgroundEnabled,
    resumePlaybackEnabled,
    seekJumpSeconds,
    sleepFadeEnabled,
    largeTextEnabled,
    highContrastEnabled,
    reducedMotionEnabled,
  ]);

  const currentMenuId = menuStack[menuStack.length - 1];
  const currentMenu = menus[currentMenuId] || menus.root;
  const isSearchableMenu =
    currentMenuId === "local_songs" ||
    currentMenuId === "favorites" ||
    currentMenuId === "queue" ||
    currentMenuId === "radio_station" ||
    currentMenuId === "playlists" ||
    currentMenuId === "local_edit" ||
    currentMenuId.startsWith("browse_") ||
    (currentMenuId.startsWith("playlist_") && !currentMenuId.startsWith("playlist_options_"));
  const visibleMenuItems = isSearchableMenu && menuSearch.trim()
    ? currentMenu.items.filter((item) => item.label.toLocaleLowerCase().includes(menuSearch.trim().toLocaleLowerCase()))
    : currentMenu.items;
  const visibleMovies = movies.filter((movie) =>
    movie.name.toLocaleLowerCase().includes(movieSearch.trim().toLocaleLowerCase())
  );

  useEffect(() => {
    setMenuSearch("");
    setSelectedIndex(0);
  }, [currentMenuId]);

  useEffect(() => {
    if (screen !== "menu") return;
    if (selectedIndex >= visibleMenuItems.length && visibleMenuItems.length > 0) {
      setSelectedIndex(visibleMenuItems.length - 1);
    } else if (visibleMenuItems.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0);
    }
  }, [selectedIndex, screen, visibleMenuItems.length]);

  useEffect(() => {
    if (screen === "menu") selectedMenuItemRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedIndex, screen, currentMenuId]);

  useEffect(() => {
    if (screen === "movies") setSelectedIndex(0);
  }, [screen]);

  useEffect(() => {
    if (screen !== "movies") return;
    if (selectedIndex >= visibleMovies.length && visibleMovies.length > 0) {
      setSelectedIndex(visibleMovies.length - 1);
    } else if (visibleMovies.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0);
    }
  }, [selectedIndex, screen, visibleMovies.length]);

  useEffect(() => {
    if (screen === "movies") selectedMovieItemRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedIndex, screen, visibleMovies.length]);

  const calculateDragData = (clientX: number, clientY: number) => {
    if (!padRef.current) return { angle: 0, distancePercent: 0 };
    const rect = padRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const x = clientX - centerX;
    const y = clientY - centerY;
    let angle = Math.atan2(y, x) * (180 / Math.PI);
    if (angle < 0) angle += 360; 
    const distance = Math.sqrt(x * x + y * y);
    return { angle, distancePercent: distance / (rect.width / 2) };
  };

  const handleStart = (clientX: number, clientY: number) => {
    isDraggingRef.current = true;
    const { angle, distancePercent } = calculateDragData(clientX, clientY);
    lastAngleRef.current = angle;
    accumulatedAngleRef.current = 0;
    accumulatedBackwardsRef.current = 0;
    activeRingRef.current = distancePercent < 0.45 ? "inner" : "outer";

    if (distancePercent < 0.45) {
      const now = Date.now();
      if (now - lastInnerTapRef.current < 300 && screen === "nowPlaying") {
        setPlaybackSpeed(1.0);
        triggerHaptic("confirm", hapticsOn);
      }
      lastInnerTapRef.current = now;
    }
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const { angle } = calculateDragData(clientX, clientY);
    let delta = angle - lastAngleRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (delta < 0) {
      accumulatedBackwardsRef.current += Math.abs(delta);
      if (accumulatedBackwardsRef.current > 1800) {
        setShowDiag(true);
        triggerHaptic("confirm", hapticsOn);
        accumulatedBackwardsRef.current = 0;
      }
    } else {
      accumulatedBackwardsRef.current = 0;
    }

    accumulatedAngleRef.current += delta;
    lastAngleRef.current = angle;
    const threshold = activeRingRef.current === "outer" ? 15 : 10; 

    if (Math.abs(accumulatedAngleRef.current) > threshold) {
      const steps = Math.floor(Math.abs(accumulatedAngleRef.current) / threshold);
      const direction = accumulatedAngleRef.current > 0 ? 1 : -1;

      if (screen === "eq") {
        if (eqEditMode) {
          setEqGains((prev) => {
            const newGains = [...prev];
            let newGain = newGains[selectedIndex] + (steps * direction * 0.5);
            newGain = Math.max(-12, Math.min(newGain, 12));
            newGains[selectedIndex] = Number(newGain.toFixed(1));
            if (filtersRef.current[selectedIndex]) {
              filtersRef.current[selectedIndex].gain.value = newGains[selectedIndex];
            }
            if (newGain !== prev[selectedIndex]) triggerHaptic("tick", hapticsOn);
            return newGains;
          });
        } else {
          const next = Math.max(0, Math.min(4, selectedIndex + steps * direction));
          if (next !== selectedIndex) {
            setSelectedIndex(next);
            triggerHaptic("tick", hapticsOn);
          }
        }
      } else if (activeRingRef.current === "outer" && screen === "menu") {
        const next = Math.max(0, Math.min(visibleMenuItems.length - 1, selectedIndex + steps * direction));
        if (next !== selectedIndex) {
          setSelectedIndex(next);
          triggerHaptic("tick", hapticsOn);
        }
      } else if (activeRingRef.current === "outer" && screen === "movies") {
        const next = Math.max(0, Math.min(visibleMovies.length - 1, selectedIndex + steps * direction));
        if (next !== selectedIndex) {
          setSelectedIndex(next);
          triggerHaptic("tick", hapticsOn);
        }
      } else if (activeRingRef.current === "inner" && screen === "nowPlaying") {
        setPlaybackSpeed((prev) => {
          let newSpeed = prev + (steps * direction * 0.05);
          newSpeed = Math.max(0.5, Math.min(newSpeed, 2.0));
          if (newSpeed !== prev) triggerHaptic("tick", hapticsOn);
          return Number(newSpeed.toFixed(2));
        });
      }
      accumulatedAngleRef.current = accumulatedAngleRef.current % threshold; 
    }
  };

  const handleEnd = () => {
    isDraggingRef.current = false;
    activeRingRef.current = null;
  };

  const activateMenuItem = (selectedItem: MenuItem | undefined) => {
    if (!selectedItem) return;
    triggerHaptic("select", hapticsOn);

    if (selectedItem.type === "menu" && selectedItem.targetId) {
      setMenuStack((previous) => [...previous, selectedItem.targetId!]);
      setSelectedIndex(0);
      return;
    }

    if (selectedItem.type === "song" && selectedItem.song) {
      if (selectedItem.playlistId) {
        playPlaylistSong(selectedItem.song, selectedItem.playlistId);
        return;
      }
      if (currentSong?.file === selectedItem.song.file) {
        setScreen("nowPlaying");
      } else {
        const songIdx = localSongs.findIndex((song) => song.file === selectedItem.song?.file);
        playSong(selectedItem.song, songIdx >= 0 ? songIdx : 0);
      }
      return;
    }

    if (selectedItem.type !== "action") return;
    if (selectedItem.actionId === "start_radio_song" && selectedItem.song) {
      startRadioFrom(selectedItem.song);
      return;
    }
    if (selectedItem.actionId === "edit_song_metadata" && selectedItem.song) {
      setEditingSong(selectedItem.song);
      setCustomArtworkData(selectedItem.song.customArtworkData ?? "");
      return;
    }
    if (selectedItem.actionId?.startsWith("seek_jump:")) {
      const seconds = Number(selectedItem.actionId.slice("seek_jump:".length));
      if ([5, 10, 15].includes(seconds)) setSeekJumpSeconds(seconds);
      return;
    }
    if (selectedItem.actionId === "playlist_add_song" && selectedItem.playlistId && selectedItem.song) {
      addSongToPlaylist(selectedItem.playlistId, selectedItem.song);
      return;
    }
    if (selectedItem.actionId?.startsWith("rename_playlist:")) {
      const playlistId = selectedItem.actionId.slice("rename_playlist:".length);
      const playlist = playlists.find((item) => item.id === playlistId);
      const name = playlist && window.prompt("Rename playlist", playlist.name)?.trim();
      if (name) setPlaylists((previous) => previous.map((item) => item.id === playlistId ? { ...item, name } : item));
      return;
    }
    if (selectedItem.actionId?.startsWith("delete_playlist:")) {
      const playlistId = selectedItem.actionId.slice("delete_playlist:".length);
      const playlist = playlists.find((item) => item.id === playlistId);
      if (playlist && window.confirm(`Delete playlist "${playlist.name}"?`)) {
        if (activePlaylistIdRef.current === playlistId) {
          releaseAudioSource();
          activePlaylistIdRef.current = null;
          playlistPlaybackOrderRef.current = [];
          setActivePlaylistId(null);
          setPlaylistPlaybackOrder([]);
          setCurrentSong(null);
          setCurrentIndex(0);
          setIsPlaying(false);
        }
        setPlaylists((previous) => previous.filter((item) => item.id !== playlistId));
        setMenuStack((previous) => previous.slice(0, -2));
        setSelectedIndex(0);
      }
      return;
    }

    switch(selectedItem.actionId) {
        case "create_playlist":
          createPlaylist();
          break;
        case "open_eq":
          ensureAudioGraph();
          wakeUpAudioCtx();
          setSelectedIndex(0);
          setEqEditMode(false);
          setScreen("eq");
          break;
        case "start_radio_current":
          if (currentSong) startRadioFrom(currentSong);
          break;
        case "stop_radio":
          stopRadio();
          break;
        case "go_now_playing":
          setScreen("nowPlaying");
          break;
        case "open_movies":
          setMovieSearch("");
          setScreen("movies");
          setSelectedIndex(0);
          break;
        case "scan_local":
          fileInputRef.current?.click();
          break;
        case "toggle_haptics":
          setHapticsOn((previous) => !previous);
          break;
        case "toggle_shuffle":
          toggleShuffle();
          break;
        case "cycle_repeat":
          cycleRepeat();
          break;
        case "toggle_detailed_view":
          setDetailedViewEnabled((previous) => {
            const next = !previous;
            if (!next) setIsDetailedNowPlaying(false);
            return next;
          });
          break;
        case "toggle_artwork_background":
          setArtworkLcdBackgroundEnabled((previous) => !previous);
          break;
        case "toggle_resume_playback":
          setResumePlaybackEnabled((previous) => !previous);
          resumePlaybackEnabledRef.current = !resumePlaybackEnabled;
          if (resumePlaybackEnabled) {
            localStorage.removeItem("retro_last_song_name");
            localStorage.removeItem("retro_last_time");
          }
          break;
        case "toggle_sleep_fade":
          setSleepFadeEnabled((previous) => !previous);
          break;
        case "toggle_large_text":
          setLargeTextEnabled((previous) => !previous);
          break;
        case "toggle_high_contrast":
          setHighContrastEnabled((previous) => !previous);
          break;
        case "toggle_reduced_motion":
          setReducedMotionEnabled((previous) => !previous);
          break;
        case "clear_play_history":
          if (window.confirm("Clear recently played and most played history?")) {
            setLocalSongs((previous) => previous.map((song) => ({ ...song, playCount: 0, lastPlayedAt: 0 })));
            localStorage.removeItem("retro_last_song_name");
            localStorage.removeItem("retro_last_time");
          }
          break;
        case "toggle_clock":
          setClock24h((previous) => !previous);
          break;
        case "sleep_off":
          cancelSleepTimer();
          break;
        case "sleep_15":
          setSleepTimerMinutes(15);
          break;
        case "sleep_30":
          setSleepTimerMinutes(30);
          break;
        case "sleep_45":
          setSleepTimerMinutes(45);
          break;
        case "sleep_60":
          setSleepTimerMinutes(60);
          break;
        case "clear_library":
          if (window.confirm("Remove all imported songs from this device? This can't be undone.")) {
            clearLocalLibrary();
          }
          break;
        case "clear_queue":
          queuedSongNamesRef.current = [];
          setQueuedSongNames([]);
          break;
        case "show_onboard":
          setShowOnboarding(true);
          break;
        case "theme_sepia": setLcdTheme("sepia"); break;
        case "theme_blue": setLcdTheme("blue"); break;
        case "theme_green": setLcdTheme("green"); break;
        case "theme_amber": setLcdTheme("amber"); break;
        case "theme_gray": setLcdTheme("gray"); break;
        case "theme_pink": setLcdTheme("pink"); break;
        case "theme_purple": setLcdTheme("purple"); break;
        case "theme_teal": setLcdTheme("teal"); break;
        case "theme_white": setLcdTheme("white"); break;
        case "theme_red": setLcdTheme("red"); break;
        case "theme_oled-red": setLcdTheme("oled-red"); break;
        case "theme_oled-amber": setLcdTheme("oled-amber"); break;
        case "theme_oled-green": setLcdTheme("oled-green"); break;
        case "theme_oled-cyan": setLcdTheme("oled-cyan"); break;
        case "theme_oled-magenta": setLcdTheme("oled-magenta"); break;
        case "theme_cyberpunk": setLcdTheme("cyberpunk"); break;
        case "theme_vaporwave": setLcdTheme("vaporwave"); break;
        case "theme_midnight": setLcdTheme("midnight"); break;
        case "theme_arctic": setLcdTheme("arctic"); break;
        case "theme_copper": setLcdTheme("copper"); break;
        case "theme_forest": setLcdTheme("forest"); break;
        case "theme_graphite": setLcdTheme("graphite"); break;
        case "theme_champagne": setLcdTheme("champagne"); break;
        case "theme_burgundy": setLcdTheme("burgundy"); break;
        case "theme_rose-gold": setLcdTheme("rose-gold"); break;
        case "theme_sage": setLcdTheme("sage"); break;
        case "theme_alpine": setLcdTheme("alpine"); break;
        case "theme_ocean-depths": setLcdTheme("ocean-depths"); break;
        case "theme_aurora": setLcdTheme("aurora"); break;
        case "theme_cobalt": setLcdTheme("cobalt"); break;
        case "theme_amethyst": setLcdTheme("amethyst"); break;
        case "theme_ember": setLcdTheme("ember"); break;
        case "theme_jade": setLcdTheme("jade"); break;
        case "theme_inverted": setLcdTheme("inverted"); break;
        case "theme_solarized": setLcdTheme("solarized"); break;
        case "noop":
          break;
        default:
          if (selectedItem.actionId?.startsWith("delete_song:")) {
            const fileName = selectedItem.actionId.replace("delete_song:", "");
            if (window.confirm(`Remove ${fileName} from device?`)) {
              removeSpecificSong(fileName);
            }
          }
    }
  };

  const handleCenterClick = () => {
    if (screen === "movies") {
      const movie = visibleMovies[selectedIndex];
      if (movie) playMovie(movie);
      else movieInputRef.current?.click();
      return;
    }

    if (screen === "moviePlaying") {
      toggleMoviePlayback();
      triggerHaptic("confirm", hapticsOn);
      return;
    }

    if (screen === "nowPlaying") {
      triggerHaptic("confirm", hapticsOn);
      if (detailedViewEnabled && currentSong && !isDetailedNowPlaying) {
        setIsDetailedNowPlaying(true);
      } else if (currentSong) {
        wakeUpAudioCtx();
        setIsPlaying((previous) => !previous);
      }
      return;
    }

    if (screen === "eq") {
      triggerHaptic("confirm", hapticsOn);
      setEqEditMode(!eqEditMode);
      return;
    }

    activateMenuItem(visibleMenuItems[selectedIndex]);
  };

  const handleGlobalPlayPause = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (screen === "moviePlaying") {
      toggleMoviePlayback();
      return;
    }
    wakeUpAudioCtx();

    if (currentSong) {
      setIsPlaying((previous) => !previous);
    }
  };

  const handleCoverSwipeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    coverSwipeStartXRef.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCoverSwipeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = coverSwipeStartXRef.current;
    coverSwipeStartXRef.current = null;
    if (startX === null) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) < 48) return;
    if (distance < 0) handleNextSong();
    else handlePrevSong();
    triggerHaptic("select", hapticsOn);
  };

  const handleMenuClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation(); 
    if (screen === "moviePlaying") {
      if (document.fullscreenElement === movieStageRef.current) {
        void document.exitFullscreen().catch((error) => {
          console.warn("Unable to exit movie fullscreen:", error);
        });
      }
      videoRef.current?.pause();
      setMovieIsPlaying(false);
      setScreen("movies");
    } else if (screen === "movies") {
      setScreen("menu");
    } else if (screen === "eq") {
      if (eqEditMode) {
        setEqEditMode(false);
      } else {
        setScreen("menu"); 
      }
    } else if (screen === "nowPlaying") {
      setIsDetailedNowPlaying(false);
      if (isDetailedNowPlaying) return;
      setScreen("menu"); 
    } else if (menuStack.length > 1) {
      const newStack = [...menuStack];
      newStack.pop();
      setMenuStack(newStack);
      setSelectedIndex(0);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selectedFiles.length === 0) return;

    const knownNames = new Set(localSongsRef.current.map((song) => song.file.name));
    const seenNames = new Set(knownNames);
    const candidates: File[] = [];
    let duplicateCount = 0;
    let unsupportedCount = 0;
    selectedFiles.forEach((file) => {
      const supported = file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aif|aiff|wma)$/i.test(file.name);
      if (!supported) {
        unsupportedCount += 1;
        console.warn(`Skipping unsupported audio file "${file.name}" (${file.type || "unknown type"}).`);
      } else if (seenNames.has(file.name)) {
        duplicateCount += 1;
      } else {
        seenNames.add(file.name);
        candidates.push(file);
      }
    });
    if (candidates.length === 0) {
      const notes = [
        duplicateCount ? `${duplicateCount} duplicate file(s) were skipped.` : "",
        unsupportedCount ? `${unsupportedCount} unsupported file(s) were skipped.` : "",
      ].filter(Boolean).join(" ");
      setImportNotice(notes || "No new songs to import.");
      return;
    }

    const importedSongs: SongItem[] = [];
    const failedNames: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const file = candidates[index];
      setImportProgress({ current: index + 1, total: candidates.length, fileName: file.name });
      try {
        const artworkUrl = await extractArtwork(file);
        const { saved, failures } = await saveSongsToStorage([file]);
        if (saved.length === 0 || failures.length > 0) {
          failedNames.push(file.name);
          continue;
        }
        const importedSong: SongItem = {
          file,
          name: file.name.replace(/\.[^/.]+$/, ""),
          artworkUrl,
          artist: "",
          album: "",
          importedAt: Date.now(),
          playCount: 0,
          lastPlayedAt: 0,
        };
        importedSongs.push(importedSong);
      } catch (error) {
        console.error(`Unable to import audio file "${file.name}":`, error);
        failedNames.push(file.name);
      }
    }
    setImportProgress(null);
    if (importedSongs.length > 0) {
      setLocalSongs((previous) => [...previous, ...importedSongs]);
      localSongsRef.current = [...localSongsRef.current, ...importedSongs];
      if (Capacitor.getPlatform() === "android") {
        void syncNativeLibrary(importedSongs).catch((error) => {
          console.error("Unable to prepare imported tracks for Android playback:", error);
          setImportNotice("Songs imported, but Android is still preparing background copies.");
        });
      }
    }
    const noticeParts = [
      importedSongs.length ? `Imported ${importedSongs.length} song(s).` : "",
      duplicateCount ? `Skipped ${duplicateCount} duplicate file(s).` : "",
      failedNames.length ? `Could not save ${failedNames.length} file(s): ${failedNames.join(", ")}.` : "",
      unsupportedCount ? `Skipped ${unsupportedCount} unsupported file(s).` : "",
    ].filter(Boolean);
    setImportNotice(noticeParts.join(" ") || "No new songs were imported.");
  };

  const handleCustomArtworkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editingSong) return;
    if (!file.type.startsWith("image/")) {
      setImportNotice("Choose an image file for the artwork.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const maxSize = 256;
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image editing canvas is not available.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      setCustomArtworkData(canvas.toDataURL("image/jpeg", 0.75));
    } catch (error) {
      console.error("Unable to prepare custom song artwork:", error);
      setImportNotice("Could not use that image. Try another image file.");
    }
  };

  const saveSongDetails = async () => {
    if (!editingSong) return;
    let artworkUrl: string | undefined = customArtworkData || undefined;
    let artworkError = false;
    if (!artworkUrl) {
      try {
        artworkUrl = await extractArtwork(editingSong.file);
      } catch (error) {
        console.error(`Unable to extract artwork for "${editingSong.file.name}":`, error);
        artworkError = true;
      }
    }
    const updatedSong: SongItem = {
      ...editingSong,
      name: editingSong.name.trim() || editingSong.file.name.replace(/\.[^/.]+$/, ""),
      artist: editingSong.artist?.trim() ?? "",
      album: editingSong.album?.trim() ?? "",
      artworkUrl,
      customArtworkData: customArtworkData || undefined,
    };
    setLocalSongs((previous) => previous.map((song) => song.file.name === updatedSong.file.name ? updatedSong : song));
    if (currentSong?.file.name === updatedSong.file.name) setCurrentSong(updatedSong);
    setEditingSong(null);
    setImportNotice(artworkError
      ? "Text details saved, but embedded artwork could not be loaded."
      : "Song details saved.");
  };

  const handleMovieUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    try {
      const root = await navigator.storage.getDirectory();
      const movieDirectory = await root.getDirectoryHandle("movies", { create: true });
      const addedMovies: MovieItem[] = [];
      for (const file of files) {
        if (!file.type.startsWith("video/") && !/\.(mp4|m4v|webm|mov|ogv|mkv)$/i.test(file.name)) {
          console.warn(`Skipping unsupported movie file: ${file.name}`);
          continue;
        }
        const fileHandle = await movieDirectory.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
        addedMovies.push({ file, name: file.name.replace(/\.[^/.]+$/, "") });
      }
      if (addedMovies.length > 0) {
        setMovies((previous) => [
          ...previous.filter((movie) => !addedMovies.some((added) => added.file.name === movie.file.name)),
          ...addedMovies,
        ]);
      }
      if (addedMovies.length !== files.length) {
        window.alert("Some files were skipped. Choose a supported video file (such as MP4) to import.");
      }
    } catch (error) {
      console.error("Unable to import movies into local storage:", error);
      window.alert("Could not save the selected movie. Check available device storage and try again.");
    }
  };

  const playMovie = (movie: MovieItem) => {
    setMoviePlaybackUrl(URL.createObjectURL(movie.file));
    setCurrentMovie(movie);
    setSubtitleUrl(null);
    setMovieCurrentTime(0);
    setMovieDuration(0);
    setScreen("moviePlaying");
    setMovieIsPlaying(true);
    if (isPlayingRef.current) setIsPlaying(false);
    triggerHaptic("confirm", hapticsOn);
  };

  const deleteMovie = async (movie: MovieItem) => {
    if (!window.confirm(`Delete "${movie.name}" from this device?`)) return;
    try {
      const root = await navigator.storage.getDirectory();
      const movieDirectory = await root.getDirectoryHandle("movies");
      await movieDirectory.removeEntry(movie.file.name);
      setMovies((previous) => previous.filter((item) => item.file.name !== movie.file.name));
      if (currentMovie?.file.name === movie.file.name) {
        videoRef.current?.pause();
        setMovieIsPlaying(false);
        setCurrentMovie(null);
        setMoviePlaybackUrl(null);
        setScreen("movies");
      }
    } catch (error) {
      console.error(`Unable to delete movie ${movie.file.name}:`, error);
      window.alert("Could not delete this movie from device storage.");
    }
  };

  const skipMovie = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const nextTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    video.currentTime = nextTime;
    setMovieCurrentTime(nextTime);
  };

  const cycleMovieSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentSpeedIndex = speeds.indexOf(movieSpeed);
    setMovieSpeed(speeds[(currentSpeedIndex + 1) % speeds.length]);
    triggerHaptic("select", hapticsOn);
  };

  const cyclePlaybackSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentSpeedIndex = speeds.indexOf(playbackSpeed);
    setPlaybackSpeed(speeds[(currentSpeedIndex + 1) % speeds.length]);
    triggerHaptic("select", hapticsOn);
  };

  const revealMovieControls = () => {
    setMovieControlsVisible(true);
    if (movieControlsTimerRef.current) clearTimeout(movieControlsTimerRef.current);
    if (movieFullscreen && movieIsPlaying) {
      movieControlsTimerRef.current = setTimeout(() => setMovieControlsVisible(false), 2600);
    }
  };

  const toggleMovieFullscreen = async () => {
    const stage = movieStageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
        return;
      }
      await stage.requestFullscreen();
      setMovieFullscreen(true);
      setMovieControlsVisible(true);
    } catch (error) {
      console.error("Unable to enter movie fullscreen:", error);
      window.alert("Fullscreen playback is not supported by this device.");
    }
  };

  const handleSubtitleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      let subtitleText = await file.text();
      if (/\.srt$/i.test(file.name)) {
        subtitleText = `WEBVTT\n\n${subtitleText
          .replace(/^\uFEFF/, "")
          .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
      } else if (!subtitleText.trimStart().startsWith("WEBVTT")) {
        throw new Error("Subtitle file must be WebVTT (.vtt) or SubRip (.srt).");
      }
      const url = URL.createObjectURL(new Blob([subtitleText], { type: "text/vtt" }));
      setSubtitleUrl(url);
    } catch (error) {
      console.error("Unable to load subtitles:", error);
      window.alert(error instanceof Error ? error.message : "Unable to load this subtitle file.");
    }
  };

  const getLcdStyle = () => {
    switch(lcdTheme) {
      case "cyberpunk": return { bg: "bg-[#fcee0a]", text: "text-[#ff003c]", border: "border-[#ff003c]", selectedBg: "bg-[#ff003c]", selectedText: "text-[#fcee0a]" };
      case "vaporwave": return { bg: "from-[#ff71ce] to-[#01cdfe]", text: "text-[#05ffa1]", border: "border-[#b967ff]", selectedBg: "bg-[#b967ff]", selectedText: "text-[#fffb96]" };
      case "sepia": return { bg: "from-[#e4d0b8] to-[#c7a982]", text: "text-[#5e4022]", border: "border-[#5e4022]", selectedBg: "bg-[#5e4022]", selectedText: "text-[#e4d0b8]" };
      case "midnight": return { bg: "from-[#0f172a] to-[#020617]", text: "text-[#38bdf8]", border: "border-[#38bdf8]", selectedBg: "bg-[#38bdf8]", selectedText: "text-[#020617]" };
      case "arctic": return { bg: "from-[#dfe8f2] to-[#a8b8cb]", text: "text-[#252f3d]", border: "border-[#525f70]", selectedBg: "bg-[#252f3d]", selectedText: "text-[#edf2f8]" };
      case "copper": return { bg: "from-[#30343b] to-[#17191d]", text: "text-[#f1b77a]", border: "border-[#c67c43]", selectedBg: "bg-[#c67c43]", selectedText: "text-[#17191d]" };
      case "forest": return { bg: "from-[#b7d7a8] to-[#52734d]", text: "text-[#152b1c]", border: "border-[#152b1c]", selectedBg: "bg-[#152b1c]", selectedText: "text-[#b7d7a8]" };
      case "graphite": return { bg: "from-[#43464b] to-[#17191d]", text: "text-[#f0f1f2]", border: "border-[#aeb4bd]", selectedBg: "bg-[#d7dbe0]", selectedText: "text-[#202328]" };
      case "champagne": return { bg: "from-[#263238] to-[#101619]", text: "text-[#f4e4bd]", border: "border-[#d6b873]", selectedBg: "bg-[#d6b873]", selectedText: "text-[#22282b]" };
      case "burgundy": return { bg: "from-[#641e35] to-[#260d1a]", text: "text-[#ffe8e7]", border: "border-[#e7a6a6]", selectedBg: "bg-[#e7a6a6]", selectedText: "text-[#34101d]" };
      case "rose-gold": return { bg: "from-[#512d37] to-[#271821]", text: "text-[#ffe6df]", border: "border-[#e7a99b]", selectedBg: "bg-[#e7a99b]", selectedText: "text-[#38212a]" };
      case "sage": return { bg: "from-[#697366] to-[#363d35]", text: "text-[#eff0db]", border: "border-[#c5c7a3]", selectedBg: "bg-[#c5c7a3]", selectedText: "text-[#30382f]" };
      case "alpine": return { bg: "from-[#f4fbff] to-[#a8d7e8]", text: "text-[#143b53]", border: "border-[#287b9c]", selectedBg: "bg-[#287b9c]", selectedText: "text-[#f4fbff]" };
      case "ocean-depths": return { bg: "from-[#102a43] to-[#071521]", text: "text-[#b6e3ed]", border: "border-[#328aa0]", selectedBg: "bg-[#328aa0]", selectedText: "text-[#071521]" };
      case "aurora": return { bg: "from-[#21113d] to-[#071d2b]", text: "text-[#f0e5ff]", border: "border-[#b6f36b]", selectedBg: "bg-[#b6f36b]", selectedText: "text-[#18231d]" };
      case "cobalt": return { bg: "from-[#1239a5] to-[#07194e]", text: "text-[#f0f5ff]", border: "border-[#64a5ff]", selectedBg: "bg-[#64a5ff]", selectedText: "text-[#07194e]" };
      case "amethyst": return { bg: "from-[#49346f] to-[#211b3d]", text: "text-[#f0e8ff]", border: "border-[#c5a8f5]", selectedBg: "bg-[#c5a8f5]", selectedText: "text-[#2d2148]" };
      case "ember": return { bg: "from-[#5c3027] to-[#241918]", text: "text-[#ffe7d4]", border: "border-[#f2a66d]", selectedBg: "bg-[#f2a66d]", selectedText: "text-[#3c211b]" };
      case "jade": return { bg: "from-[#075b45] to-[#032b26]", text: "text-[#e0ffe6]", border: "border-[#7af0a1]", selectedBg: "bg-[#7af0a1]", selectedText: "text-[#073629]" };
      case "inverted": return { bg: "from-[#ffffff] to-[#ffffff]", text: "text-black", border: "border-black", selectedBg: "bg-black", selectedText: "text-white" };
      case "solarized": return { bg: "from-[#fdf6e3] to-[#eee8d5]", text: "text-[#586e75]", border: "border-[#657b83]", selectedBg: "bg-[#268bd2]", selectedText: "text-[#fdf6e3]" };
      case "oled-red": return { bg: "bg-black", text: "text-red-600", border: "border-red-900", selectedBg: "bg-red-900", selectedText: "text-black" };
      case "oled-amber": return { bg: "bg-black", text: "text-amber-500", border: "border-amber-700", selectedBg: "bg-amber-700", selectedText: "text-black" };
      case "oled-green": return { bg: "bg-black", text: "text-green-500", border: "border-green-800", selectedBg: "bg-green-800", selectedText: "text-black" };
      case "oled-cyan": return { bg: "bg-black", text: "text-cyan-400", border: "border-cyan-800", selectedBg: "bg-cyan-800", selectedText: "text-black" };
      case "oled-magenta": return { bg: "bg-black", text: "text-fuchsia-500", border: "border-fuchsia-900", selectedBg: "bg-fuchsia-900", selectedText: "text-black" };
      case "green": return { bg: "from-[#8aff8a] to-[#40b540]", text: "text-[#0a2e0a]", border: "border-[#0a2e0a]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#8aff8a]" };
      case "amber": return { bg: "from-[#ffd085] to-[#db9a35]", text: "text-[#3b2302]", border: "border-[#3b2302]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ffd085]" };
      case "gray": return { bg: "from-[#d4d4d4] to-[#a3a3a3]", text: "text-[#1f1f1f]", border: "border-[#1f1f1f]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#d4d4d4]" };
      case "pink": return { bg: "from-[#ffb3d9] to-[#f472b6]", text: "text-[#4a0d2e]", border: "border-[#4a0d2e]", selectedBg: "bg-[#9d174d]", selectedText: "text-[#fff1f7]" };
      case "purple": return { bg: "from-[#d3b8ff] to-[#a678ec]", text: "text-[#2c0d4d]", border: "border-[#2c0d4d]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#d3b8ff]" };
      case "teal": return { bg: "from-[#8afcf0] to-[#33c9b8]", text: "text-[#04302b]", border: "border-[#04302b]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#8afcf0]" };
      case "white": return { bg: "from-[#ffffff] to-[#d9dde3]", text: "text-[#1a1d22]", border: "border-[#1a1d22]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ffffff]" };
      case "red": return { bg: "from-[#ff9d94] to-[#ef5a4c]", text: "text-[#450e08]", border: "border-[#450e08]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ff9d94]" };
      default: return { bg: "from-[#8ab4f8] to-[#6fa1ef]", text: "text-[#0d2238]", border: "border-[#0d2238]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#8ab4f8]" }; 
    }
  };
  const theme = getLcdStyle();

  const unifiedIsPlaying = isPlaying;
  const unifiedTrackName = currentSong?.name ?? "No Track Selected";
  const unifiedCurrentTime = currentTime;
  const unifiedDuration = duration;
  const unifiedProgress = unifiedDuration > 0
    ? (unifiedCurrentTime / unifiedDuration) * 100
    : 0;

  const activePlaylist = activePlaylistId
    ? playlists.find((playlist) => playlist.id === activePlaylistId) ?? null
    : null;
  const activePlaybackSongs = activePlaylist
    ? (playlistPlaybackOrder.length > 0 ? playlistPlaybackOrder : activePlaylist.songNames)
        .map((name) => localSongs.find((song) => song.file.name === name))
        .filter((song): song is SongItem => song !== undefined)
    : localSongs;
  const activeCoverflowItems: CoverflowItem[] = activePlaybackSongs.map((song) => ({
    id: song.file.name,
    name: song.name,
    artworkUrl: song.artworkUrl,
  }));

  const coverflowActiveIndex = currentIndex;
  const isSubtitleFileSelected = Boolean(subtitleUrl);
  const detailedNowPlayingActive = screen === "nowPlaying" && isDetailedNowPlaying;
  const artworkLcdBackgroundActive = Boolean(
    currentSong?.artworkUrl &&
    (detailedNowPlayingActive || (artworkLcdBackgroundEnabled && isPlaying))
  );
  const memoryUsageBytes = typeof performance !== "undefined"
    ? (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    : undefined;

  const renderDetailedNowPlaying = () => (
    <div className="relative isolate flex-1 min-h-0 overflow-hidden -m-4 text-white">
      <div className="relative z-10 flex h-full min-h-0 flex-col justify-between gap-2 overflow-y-auto px-3 pt-2 pb-8">
        <div className="flex min-h-0 flex-1 items-center gap-3">
          <div className="relative aspect-square w-[34%] max-w-[118px] shrink-0 overflow-hidden rounded-xl border border-white/25 bg-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {currentSong?.artworkUrl ? (
              <Image
                src={currentSong.artworkUrl}
                alt={`${currentSong.name} artwork`}
                fill
                sizes="118px"
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/70"><Music size={36} /></div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold leading-tight sm:text-base">{currentSong?.name ?? "No Track Selected"}</p>
            <p className="mt-1 truncate text-[9px] font-medium uppercase tracking-[0.15em] text-white/65">{currentSong?.artist || "Local music library"}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[9px] tabular-nums text-white/75">{formatTime(unifiedCurrentTime)}</span>
              <input
                type="range"
                min={0}
                max={unifiedDuration || 0}
                step={0.1}
                value={Math.min(unifiedCurrentTime, unifiedDuration || 0)}
                onChange={(event) => {
                  const nextTime = Number(event.target.value);
                  seekAudioTo(nextTime);
                }}
                aria-label="Song progress"
                className="min-w-0 flex-1 accent-white"
              />
              <span className="text-[9px] tabular-nums text-white/75">-{formatTime(Math.max(0, unifiedDuration - unifiedCurrentTime))}</span>
            </div>
          </div>
        </div>

        {renderRadioControls()}

        <div className="mb-3 flex shrink-0 items-center justify-center gap-3 border-t border-white/15 pt-2">
          <button
            type="button"
            aria-label={`Shuffle ${shuffleOn ? "on" : "off"}`}
            onClick={() => {
              toggleShuffle();
              triggerHaptic("select", hapticsOn);
            }}
            className={`rounded-full p-2 ${shuffleOn ? "bg-white/20 text-white" : "text-white/65"}`}
          >
            <Shuffle size={16} />
          </button>
          <button type="button" onClick={handlePrevSong} aria-label="Previous song" className="rounded-full p-2 text-white/85">
            <SkipBack size={19} />
          </button>
          <button
            type="button"
            onClick={() => {
              wakeUpAudioCtx();
              setIsPlaying((previous) => !previous);
            }}
            aria-label={unifiedIsPlaying ? "Pause song" : "Play song"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg"
          >
            {unifiedIsPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" className="ml-0.5" />}
          </button>
          <button type="button" onClick={handleNextSong} aria-label="Next song" className="rounded-full p-2 text-white/85">
            <SkipForward size={19} />
          </button>
          <button
            type="button"
            aria-label={`Repeat ${repeatMode}`}
            onClick={() => {
              cycleRepeat();
              triggerHaptic("select", hapticsOn);
            }}
            className={`flex items-center gap-1 rounded-full p-2 text-[8px] font-bold ${repeatMode !== "off" ? "bg-white/20 text-white" : "text-white/65"}`}
          >
            {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
            <span>{repeatMode.toUpperCase()}</span>
          </button>
          {currentSong && (
            <button
              type="button"
              onClick={() => toggleFavorite(currentSong)}
              aria-label={favoriteSongNames.includes(currentSong.file.name) ? "Remove from favorites" : "Add to favorites"}
              className={`rounded-full p-2 ${favoriteSongNames.includes(currentSong.file.name) ? "text-rose-300" : "text-white/65"}`}
            >
              <Heart size={16} className={favoriteSongNames.includes(currentSong.file.name) ? "fill-current" : ""} />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
<div className={`fixed inset-0 w-screen h-[100dvh] bg-[#1c1c1e] text-gray-200 font-sans flex flex-col overflow-hidden select-none touch-none z-50 p-3 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] ${largeTextEnabled ? "retro-large-text" : ""} ${highContrastEnabled ? "retro-high-contrast" : ""} ${reducedMotionEnabled ? "retro-reduced-motion" : ""}`}>
      <input type="file" ref={customArtworkInputRef} className="hidden" accept="image/*" onChange={handleCustomArtworkUpload} />
      {editingSong && (
        <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" onClick={() => setEditingSong(null)}>
          <form
            className="w-full max-w-sm space-y-3 rounded-2xl border border-white/20 bg-zinc-900 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => { event.preventDefault(); void saveSongDetails(); }}
          >
            <h2 className="text-lg font-bold">Edit song details</h2>
            <div className="flex items-center gap-3">
              {customArtworkData || editingSong.artworkUrl
                ? <Image src={customArtworkData || editingSong.artworkUrl || ""} alt="" width={64} height={64} unoptimized className="h-16 w-16 rounded-lg object-cover" />
                : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-white/10"><Music size={24} /></div>}
              <button type="button" onClick={() => customArtworkInputRef.current?.click()} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Choose artwork</button>
            </div>
            <label className="block text-xs font-semibold">Title
              <input value={editingSong.name} onChange={(event) => setEditingSong({ ...editingSong, name: event.target.value })} className="mt-1 w-full rounded-lg bg-black/40 px-3 py-2 text-base outline-none ring-white/30 focus:ring-2" maxLength={180} />
            </label>
            <label className="block text-xs font-semibold">Artist
              <input value={editingSong.artist ?? ""} onChange={(event) => setEditingSong({ ...editingSong, artist: event.target.value })} className="mt-1 w-full rounded-lg bg-black/40 px-3 py-2 text-base outline-none ring-white/30 focus:ring-2" maxLength={120} />
            </label>
            <label className="block text-xs font-semibold">Album
              <input value={editingSong.album ?? ""} onChange={(event) => setEditingSong({ ...editingSong, album: event.target.value })} className="mt-1 w-full rounded-lg bg-black/40 px-3 py-2 text-base outline-none ring-white/30 focus:ring-2" maxLength={120} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditingSong(null)} className="rounded-lg px-3 py-2 text-sm opacity-75">Cancel</button>
              <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-black">Save</button>
            </div>
          </form>
        </div>
      )}
      {(importProgress || importNotice) && (
        <div role="status" className="absolute left-1/2 top-[max(3.5rem,env(safe-area-inset-top))] z-[120] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border border-white/20 bg-zinc-950/95 p-3 text-sm shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate">
              {importProgress ? `Importing ${importProgress.current}/${importProgress.total}: ${importProgress.fileName}` : importNotice}
            </span>
            {queueUndo && <button type="button" onClick={undoQueueRemoval} className="font-bold underline">Undo</button>}
            {!importProgress && <button type="button" aria-label="Dismiss notification" onClick={() => setImportNotice(null)}><X size={16} /></button>}
          </div>
          {importProgress && <progress className="mt-2 h-1.5 w-full accent-white" value={importProgress.current} max={importProgress.total} />}
        </div>
      )}
      {/* --- Secret Developer Diagnostics HUD --- */}
      {showDiag && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/90 border border-green-500 text-green-400 text-[10px] p-3 rounded-lg z-[100] font-mono shadow-[0_0_20px_rgba(0,255,0,0.2)] w-3/4 max-w-xs">
          <p className="font-bold border-b border-green-500/50 pb-1 mb-2 text-center uppercase tracking-widest">Diagnostics</p>
          <p>RAM Usage: {memoryUsageBytes === undefined ? "N/A" : `${Math.round(memoryUsageBytes / 1048576)} MB`}</p>
          <p>Audio Context: {audioCtxRef.current?.state || 'UNINITIALIZED'}</p>
          <p>Engine Source: Local Library</p>
          <button onClick={() => setShowDiag(false)} className="mt-3 w-full py-2 bg-green-500/20 hover:bg-green-500/40 rounded transition-colors text-white font-bold tracking-widest">CLOSE</button>
        </div>
      )}

      {/* --- Beautiful Scrollable Guide --- */}
      {showOnboarding && (
        <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
          <div className="bg-[#27272a] border border-[#3f3f46] p-6 rounded-3xl max-w-sm w-full shadow-2xl flex flex-col max-h-[85vh]">
            <h2 className="text-xl font-bold text-white mb-4 uppercase tracking-widest text-center border-b border-gray-600 pb-3">RetroPod Manual</h2>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-2 text-left text-sm text-gray-300 custom-scrollbar pb-4">
              <p className="mb-2 text-xs leading-relaxed text-gray-400">Open a section to see its controls. RetroPod plays files stored in your local library; it does not stream songs.</p>

              <details className="group rounded-xl border border-white/10 bg-black/20 px-3">
                <summary className="cursor-pointer list-none py-3 text-xs font-bold uppercase tracking-wider text-blue-300 [&::-webkit-details-marker]:hidden">🧭 Navigation &amp; Library</summary>
                <ul className="space-y-2 pb-3 text-xs leading-relaxed">
                  <li>• <b>Trackpad:</b> Drag in circles to move through menus and lists. You can also tap list items directly.</li>
                  <li>• <b>Center button:</b> Select an item. In Now Playing, it opens the detailed player when enabled; there it toggles play/pause.</li>
                  <li>• <b>MENU:</b> Return to the previous screen. In detailed Now Playing, it returns to the standard player first.</li>
                  <li>• <b>Import:</b> Music Library → Import New Songs. Audio stays on this device.</li>
                  <li>• <b>Favorites:</b> Tap the heart beside a song. Find saved songs under Music Library → Favorites.</li>
                  <li>• <b>Queue:</b> Use the list button to add a song to the queue, or the skip button to make it play next. In Play Queue, move tracks up/down or remove them; removed tracks can be restored briefly with Undo.</li>
                  <li>• <b>Artist &amp; album details:</b> RetroPod reads embedded tags when available. To add or correct them, open Music Library → All Songs (or Browse Library → Recently Added), tap the pencil beside a song, fill in Artist and Album, then Save. These details organize the Artists/Albums views and help Retro Radio make better picks.</li>
                  <li>• <b>Edit track info:</b> Use the same pencil to update the title or choose custom artwork.</li>
                </ul>
              </details>

              <details className="group rounded-xl border border-white/10 bg-black/20 px-3">
                <summary className="cursor-pointer list-none py-3 text-xs font-bold uppercase tracking-wider text-fuchsia-300 [&::-webkit-details-marker]:hidden">📻 Retro Radio — offline recommendations</summary>
                <ul className="space-y-2 pb-3 text-xs leading-relaxed">
                  <li>• <b>Start:</b> Choose Retro Radio from the Main Menu and pick a starting song, or tap the radio icon next to a library song. You need at least two imported songs.</li>
                  <li>• <b>A live DJ, not a playlist:</b> Radio chooses the next song only when it is needed, using the song currently playing as the new reference. It doesn&apos;t prepare a fixed shuffle list.</li>
                  <li>• <b>Teach your station:</b> Tap <i>More like this</i> to teach it artist, album, and title-word preferences. <i>Not for me</i> skips the track for this station and lowers similar picks. Learning is saved on this device.</li>
                  <li>• <b>Change the mood:</b> <i>Surprise me</i> favors unheard tracks and variety; Familiar mix leans harder on related metadata and your feedback. Radio explains why it picked each recommendation.</li>
                  <li>• <b>No internet or account:</b> Recommendations are generated from your imported library and saved listening history on-device. Better artist/album metadata helps it make closer matches.</li>
                  <li>• <b>Controls:</b> Next skips to another station track; Previous returns to an earlier station pick. Queued songs play next and then Radio continues.</li>
                  <li>• <b>Exit:</b> Choose another song from the library to stop the station, or open Main Menu → Retro Radio → Stop Retro Radio.</li>
                </ul>
              </details>

              <details className="group rounded-xl border border-white/10 bg-black/20 px-3">
                <summary className="cursor-pointer list-none py-3 text-xs font-bold uppercase tracking-wider text-green-300 [&::-webkit-details-marker]:hidden">🎵 Playback, seeking &amp; sleep timer</summary>
                <ul className="space-y-2 pb-3 text-xs leading-relaxed">
                  <li>• <b>Seek:</b> Drag the progress bar to jump to a time. The configured seek jump is also used by supported keyboard and media-session seek controls.</li>
                  <li>• <b>Playback speed:</b> Drag the inner ring to adjust speed from 0.5x to 2x. Tap the on-screen speed badge to cycle presets; double-tap the inner ring to reset to 1x.</li>
                  <li>• <b>Shuffle &amp; repeat:</b> Use the buttons in Now Playing or change them in System Settings. Repeat can be off, repeat all, or repeat one.</li>
                  <li>• <b>Sleep timer:</b> System Settings → Sleep Timer. Choose a timer; the optional fade gradually lowers audio near the end. Cancel it from the same menu.</li>
                  <li>• <b>Resume:</b> Resume Last Track remembers your previous song and position on this device when enabled.</li>
                </ul>
              </details>

              <details className="group rounded-xl border border-white/10 bg-black/20 px-3">
                <summary className="cursor-pointer list-none py-3 text-xs font-bold uppercase tracking-wider text-amber-300 [&::-webkit-details-marker]:hidden">🎛️ 5-Band Equalizer</summary>
                <ul className="space-y-2 pb-3 text-xs leading-relaxed">
                  <li>• <b>Access:</b> Main Menu → Playback Tools → 5-Band Equalizer.</li>
                  <li>• <b>Select and adjust:</b> Highlight a band with the trackpad, press Center to unlock, then rotate the trackpad to adjust from -12 dB to +12 dB. Press Center again to lock.</li>
                  <li>• <b>Touch:</b> Tap a band to select/unlock it. Tap the selected band again to reset its gain to zero. Reset All clears every band.</li>
                </ul>
              </details>

              <details className="group rounded-xl border border-white/10 bg-black/20 px-3">
                <summary className="cursor-pointer list-none py-3 text-xs font-bold uppercase tracking-wider text-cyan-300 [&::-webkit-details-marker]:hidden">🎬 Movies &amp; subtitles</summary>
                <ul className="space-y-2 pb-3 text-xs leading-relaxed">
                  <li>• Import downloaded video files from Movies. Playback format support depends on the device.</li>
                  <li>• Load VTT or SRT subtitles from the movie player controls.</li>
                  <li>• Use the seek bar to move through a movie; the side controls skip backward or forward.</li>
                </ul>
              </details>

              <details className="group rounded-xl border border-white/10 bg-black/20 px-3">
                <summary className="cursor-pointer list-none py-3 text-xs font-bold uppercase tracking-wider text-violet-300 [&::-webkit-details-marker]:hidden">⚙️ Settings &amp; accessibility</summary>
                <ul className="space-y-2 pb-3 text-xs leading-relaxed">
                  <li>• System Settings contains LCD themes, haptics, clock format, resume behavior, seek-jump length, and player-view options.</li>
                  <li>• Accessibility lets you enable larger text, high contrast, or reduced motion.</li>
                  <li>• Your library, playlists, favorites, and preferences are stored locally on this device.</li>
                </ul>
              </details>
            </div>
            
            <div className="pt-4 border-t border-gray-600 mt-2">
              <button 
                onClick={() => {
                  setShowOnboarding(false);
                }}
                className="w-full py-3 bg-white text-black hover:bg-gray-200 font-bold rounded-xl text-xs uppercase tracking-widest shadow-lg transition-colors cursor-pointer"
              >
                Start Listening
              </button>
            </div>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" multiple onChange={handleFileUpload} />
      <input type="file" ref={movieInputRef} className="hidden" accept="video/*,.mp4,.m4v,.webm,.mov,.ogv,.mkv" multiple onChange={handleMovieUpload} />
      <input type="file" ref={subtitleInputRef} className="hidden" accept=".vtt,.srt,text/vtt,application/x-subrip" onChange={handleSubtitleUpload} />

      <div className="w-full h-[42%] p-1 pb-2 flex flex-col shrink-0">
        <div className="w-full h-full bg-[#27272a] rounded-[2rem] p-3 shadow-[0_20px_40px_rgba(0,0,0,0.5),inset_0_1px_2px_rgba(255,255,255,0.1)] border border-[#3f3f46] flex flex-col relative">
          
          <div className={`w-full h-full ${artworkLcdBackgroundActive ? "bg-black text-white" : `bg-gradient-to-b ${theme.bg} ${theme.text}`} rounded-xl relative overflow-hidden shadow-[inset_0_4px_15px_rgba(0,0,0,0.5)] border border-[#1a1a1a] flex flex-col p-4`}>
            {artworkLcdBackgroundActive && currentSong?.artworkUrl && (
              <>
                <div
                  aria-hidden="true"
                  className="absolute -inset-8 z-0 scale-110 bg-cover bg-center blur-xl opacity-90"
                  style={{ backgroundImage: `url("${currentSong.artworkUrl}")` }}
                />
                <div aria-hidden="true" className="absolute inset-0 z-0 bg-gradient-to-br from-black/25 via-black/45 to-black/70" />
              </>
            )}

            {/* --- VOLUME HUD OVERLAY --- */}
            <AnimatePresence>
              {volOverlay !== null && (
                <motion.div 
                  initial={{ y: -50, opacity: 0 }} 
                  animate={{ y: 0, opacity: 1 }} 
                  exit={{ y: -50, opacity: 0 }}
                  className={`absolute top-0 left-0 right-0 h-10 bg-black/30 backdrop-blur-md z-[100] border-b ${theme.border}/50 flex items-center px-4 gap-3 shadow-xl`}
                >
                  <Volume2 size={16} className="opacity-80" />
                  <div className="flex-1 h-3 bg-black/40 rounded overflow-hidden border border-current/20 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                    <div className="h-full bg-current transition-all duration-100" style={{ width: `${volOverlay}%` }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className={`flex justify-between items-center text-[11px] font-bold tracking-[0.15em] border-b ${theme.border}/30 pb-2 mb-3 uppercase relative z-10`}>
              <span>{screen === "nowPlaying" ? radioModeOn ? "Retro Radio" : "Now Playing" : screen === "eq" ? "Equalizer" : screen === "movies" ? "Movies" : screen === "moviePlaying" ? currentMovie?.name ?? "Movie" : currentMenu.title}</span>
              
              <div className="flex items-center gap-1.5">
                <span className="tracking-normal normal-case">{currentTimeStr}</span>
                {isCharging && <span className="text-[11px] animate-pulse leading-none">⚡</span>}
                <div className={`w-6 h-3 rounded-[2px] border-[1.5px] ${theme.border} p-[1px] flex relative`}>
                  <div className={`h-full transition-all duration-1000`} style={{ width: `${batteryLevel || 100}%`, backgroundColor: "currentColor" }}></div>
                  <div className={`absolute right-[-4px] top-[25%] w-[2px] h-[50%]`} style={{backgroundColor: "currentColor"}}></div>
                </div>
              </div>
            </div>
            
            {screen === "menu" ? (
              <div className="flex-1 min-h-0 flex flex-col justify-start pt-1 no-scrollbar relative z-10">
                {isSearchableMenu && (
                  <label className={`shrink-0 z-20 flex items-center gap-2 px-3 py-2 mb-2 rounded border ${theme.border}/50 bg-black/20 backdrop-blur touch-auto`}>
                    <Search size={15} className="shrink-0 opacity-70" />
                    <input
                      type="search"
                      value={menuSearch}
                      onChange={(event) => {
                        setMenuSearch(event.target.value);
                        setSelectedIndex(0);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      placeholder="Search"
                      aria-label={`Search ${currentMenu.title}`}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:opacity-60 select-text"
                    />
                    {menuSearch && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => setMenuSearch("")}
                        className="p-1 opacity-70"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                )}
                {currentMenuId.startsWith("playlist_") &&
                  !currentMenuId.startsWith("playlist_options_") &&
                  !currentMenuId.startsWith("playlist_add_") && (
                    <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-2 shadow-lg backdrop-blur-md">
                      <button
                        type="button"
                        onClick={() => playPlaylist(currentMenuId.slice("playlist_".length))}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-extrabold uppercase tracking-wider text-black shadow-md transition-transform active:scale-[0.98]"
                      >
                        <Play size={16} fill="currentColor" /> Play
                      </button>
                      <button
                        type="button"
                        aria-label={playlistShuffleSelection[currentMenuId.slice("playlist_".length)] ? "Shuffle playlist enabled" : "Shuffle playlist disabled"}
                        aria-pressed={Boolean(playlistShuffleSelection[currentMenuId.slice("playlist_".length)])}
                        onClick={() => {
                          const playlistId = currentMenuId.slice("playlist_".length);
                          setPlaylistShuffleSelection((previous) => ({
                            ...previous,
                            [playlistId]: !previous[playlistId],
                          }));
                          triggerHaptic("select", hapticsOn);
                        }}
                        className={`flex h-10 w-11 items-center justify-center rounded-lg border border-white/15 transition-colors ${
                          playlistShuffleSelection[currentMenuId.slice("playlist_".length)]
                            ? "bg-emerald-300 text-black"
                            : "bg-white/5 text-white"
                        }`}
                      >
                        <Shuffle size={18} />
                      </button>
                    </div>
                  )}
                <ul className="min-h-0 flex-1 overflow-y-auto space-y-1 no-scrollbar">
                  {visibleMenuItems.map((item, index) => (
                    <li 
                      key={index}
                      ref={selectedIndex === index ? selectedMenuItemRef : null}
                      onClick={() => activateMenuItem(item)}
                      className={`px-3 py-2.5 rounded transition-none text-sm md:text-base font-bold tracking-wide flex justify-between items-center cursor-pointer ${
                        selectedIndex === index ? `${theme.selectedBg} ${theme.selectedText}` : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.type === "song" && item.song && (
                          <>
                            {currentMenuId === "browse_most_played" && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[9px] font-bold tabular-nums ${
                                  selectedIndex === index ? "bg-white/15" : "bg-black/15"
                                }`}
                                aria-label={`${item.song.playCount ?? 0} plays`}
                                title={`${item.song.playCount ?? 0} plays`}
                              >
                                {item.song.playCount ?? 0} plays
                              </span>
                            )}
                            {currentMenuId !== "queue" && (
                              <button
                                type="button"
                                aria-label={`Start Retro Radio from ${item.song.name}`}
                                title="Start offline Retro Radio from this song"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startRadioFrom(item.song!);
                                }}
                                className="p-1 rounded hover:bg-black/20"
                              >
                                <Radio size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={favoriteSongNames.includes(item.song.file.name) ? `Remove ${item.song.name} from favorites` : `Add ${item.song.name} to favorites`}
                              title={favoriteSongNames.includes(item.song.file.name) ? "Remove favorite" : "Add to favorites"}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleFavorite(item.song!);
                              }}
                              className="p-1 rounded hover:bg-black/20"
                            >
                              <Heart
                                size={14}
                                className={favoriteSongNames.includes(item.song.file.name) ? "fill-current" : ""}
                              />
                            </button>
                            {item.playlistId ? (
                              <button
                                type="button"
                                aria-label={`Remove ${item.song.name} from playlist`}
                                title="Remove from playlist"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeSongFromPlaylist(item.playlistId!, item.song!.file.name);
                                }}
                                className="p-1 rounded hover:bg-black/20"
                              >
                                <X size={14} />
                              </button>
                            ) : currentMenuId === "queue" ? (
                              <>
                                <button type="button" aria-label={`Move ${item.song.name} earlier`} title="Move earlier" disabled={queuedSongNames.indexOf(item.song.file.name) <= 0} onClick={(event) => { event.stopPropagation(); moveQueuedSong(item.song!.file.name, -1); }} className="p-1 rounded hover:bg-black/20 disabled:opacity-30"><ArrowUp size={14} /></button>
                                <button type="button" aria-label={`Move ${item.song.name} later`} title="Move later" disabled={queuedSongNames.indexOf(item.song.file.name) >= queuedSongNames.length - 1} onClick={(event) => { event.stopPropagation(); moveQueuedSong(item.song!.file.name, 1); }} className="p-1 rounded hover:bg-black/20 disabled:opacity-30"><ArrowDown size={14} /></button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${item.song.name} from queue`}
                                  title="Remove from queue"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeQueuedSong(item.song!.file.name);
                                  }}
                                  className="p-1 rounded hover:bg-black/20"
                                >
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" aria-label={`Play ${item.song.name} next`} title="Play next" onClick={(event) => { event.stopPropagation(); playSongNext(item.song!); }} className="p-1 rounded hover:bg-black/20"><SkipForward size={14} /></button>
                                <button
                                  type="button"
                                  aria-label={`Add ${item.song.name} to queue`}
                                  title={queuedSongNames.includes(item.song.file.name) ? "Already queued" : "Add to queue"}
                                  disabled={queuedSongNames.includes(item.song.file.name)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    enqueueSong(item.song!);
                                  }}
                                  className="p-1 rounded hover:bg-black/20 disabled:opacity-40"
                                >
                                  <ListPlus size={14} />
                                </button>
                                {(currentMenuId === "local_songs" || currentMenuId.startsWith("browse_")) && (
                                  <button type="button" aria-label={`Edit ${item.song.name}`} title="Edit song details" onClick={(event) => { event.stopPropagation(); setEditingSong(item.song!); setCustomArtworkData(item.song!.customArtworkData ?? ""); }} className="p-1 rounded hover:bg-black/20"><Pencil size={14} /></button>
                                )}
                              </>
                            )}
                          </>
                        )}
                        {item.actionId === "start_radio_song" && item.song && (
                          <button
                            type="button"
                            aria-label={`Start Retro Radio from ${item.song.name}`}
                            title="Start station from this song"
                            onClick={(event) => {
                              event.stopPropagation();
                              startRadioFrom(item.song!);
                            }}
                            className="p-1 rounded hover:bg-black/20"
                          >
                            <Radio size={14} />
                          </button>
                        )}
                        {item.type === "menu" && <span>&gt;</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {isSearchableMenu && visibleMenuItems.length === 0 && (
                  <p className="px-3 py-3 text-sm opacity-70">No matches found.</p>
                )}
              </div>
            ) : screen === "movies" ? (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2 relative z-10">
                <label className={`shrink-0 z-20 flex items-center gap-2 px-3 py-2 rounded border ${theme.border}/50 bg-black/20 backdrop-blur touch-auto`}>
                  <Search size={15} className="shrink-0 opacity-70" />
                  <input
                    type="search"
                    value={movieSearch}
                    onChange={(event) => {
                      setMovieSearch(event.target.value);
                      setSelectedIndex(0);
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    placeholder="Find a movie"
                    aria-label="Search movies"
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:opacity-60 select-text"
                  />
                  {movieSearch && (
                    <button type="button" aria-label="Clear movie search" onClick={() => setMovieSearch("")} className="p-1 opacity-70">
                      <X size={14} />
                    </button>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => movieInputRef.current?.click()}
                  className={`flex items-center justify-center gap-2 rounded border ${theme.border}/60 px-3 py-2 text-sm font-bold`}
                >
                  <Film size={16} /> Import Movies
                </button>
                <p className="px-1 text-[9px] opacity-70">MP4 (H.264/AAC) is most compatible. 4K playback depends on your device&apos;s video decoder and storage speed.</p>
                <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
                  {movies.length > 0 && (
                    <div className="mb-2 rounded-xl border border-white/10 bg-gradient-to-r from-white/10 to-transparent p-3">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]">
                        <Film size={15} /> Offline Cinema
                      </div>
                      <p className="mt-1 text-[10px] opacity-70">{movies.length} {movies.length === 1 ? "movie" : "movies"} stored on this device</p>
                    </div>
                  )}
                  {visibleMovies.map((movie, index) => (
                    <div
                      key={movie.file.name}
                      ref={selectedIndex === index ? selectedMovieItemRef : null}
                      className={`mb-1 flex items-center gap-2 rounded-xl border border-white/5 bg-gradient-to-r from-white/[0.07] to-transparent px-3 py-2 text-sm font-bold shadow-sm ${
                        selectedIndex === index ? `${theme.selectedBg} ${theme.selectedText}` : ""
                      }`}
                    >
                      <button type="button" onClick={() => playMovie(movie)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md bg-black/30"><Film size={17} /></span>
                        <span className="min-w-0">
                          <span className="block truncate">{movie.name}</span>
                          <span className="block text-[9px] font-medium opacity-60">Offline video</span>
                        </span>
                      </button>
                      <button type="button" aria-label={`Delete ${movie.name}`} onClick={() => deleteMovie(movie)} className="p-1">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {visibleMovies.length === 0 && (
                    <p className="px-3 py-3 text-sm opacity-70">
                      {movieSearch ? "No movies match your search." : "Import an offline video to start your movie library."}
                    </p>
                  )}
                </div>
              </div>
            ) : screen === "moviePlaying" && currentMovie ? (
              <div
                ref={movieStageRef}
                className={`flex-1 min-h-0 flex flex-col items-center justify-center gap-2 relative z-10 bg-black/90 rounded-lg p-2 ${
                  movieFullscreen ? "fixed inset-0 z-[1000] h-[100dvh] w-screen rounded-none p-3" : ""
                }`}
                onPointerMove={() => {
                  if (movieFullscreen) revealMovieControls();
                }}
                onPointerDown={() => {
                  if (movieFullscreen) revealMovieControls();
                }}
              >
                <video
                  ref={videoRef}
                  src={moviePlaybackUrl ?? undefined}
                  autoPlay
                  playsInline
                  onPlay={() => setMovieIsPlaying(true)}
                  onPause={() => setMovieIsPlaying(false)}
                  onTimeUpdate={(event) => setMovieCurrentTime(event.currentTarget.currentTime)}
                  onLoadedMetadata={(event) => {
                    setMovieDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                    event.currentTarget.playbackRate = movieSpeed;
                  }}
                  onError={() => {
                    setMovieIsPlaying(false);
                    console.error("The selected movie could not be decoded by this device. MP4 with H.264 video and AAC audio has the broadest support.");
                    window.alert("This video format or codec is not supported by this device. Try an MP4 with H.264 video and AAC audio.");
                  }}
                  onClick={() => {
                    if (movieFullscreen && !movieControlsVisible) revealMovieControls();
                  }}
                  className="min-h-0 w-full flex-1 object-contain"
                >
                  {subtitleUrl && <track key={subtitleUrl} kind="subtitles" srcLang="en" label="Subtitles" src={subtitleUrl} default />}
                </video>
                <div className={`w-full max-w-2xl shrink-0 flex flex-col gap-1 rounded-xl text-[10px] font-semibold transition-opacity duration-200 ${
                  movieFullscreen
                    ? `absolute inset-x-0 bottom-0 max-w-none bg-gradient-to-t from-black via-black/90 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 ${
                        movieControlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
                      }`
                    : "px-1 pb-1"
                }`}>
                  <input
                    type="range"
                    min={0}
                    max={movieDuration || 0}
                    step={0.1}
                    value={Math.min(movieCurrentTime, movieDuration || 0)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (videoRef.current) videoRef.current.currentTime = next;
                      setMovieCurrentTime(next);
                    }}
                    aria-label="Movie progress"
                    className="w-full accent-white touch-auto"
                  />
                  <div className="flex items-center justify-between">
                    <span>{formatTime(movieCurrentTime)} / {formatTime(movieDuration)}</span>
                    <span>{movieSpeed}x</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => skipMovie(-10)} aria-label="Back 10 seconds" className="p-2"><Rewind size={17} /></button>
                    <button type="button" onClick={toggleMoviePlayback} aria-label={movieIsPlaying ? "Pause movie" : "Play movie"} className="p-2">
                      {movieIsPlaying ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <button type="button" onClick={() => skipMovie(10)} aria-label="Forward 10 seconds" className="p-2"><FastForward size={17} /></button>
                    <button type="button" onClick={cycleMovieSpeed} aria-label="Change movie speed" className="flex items-center gap-1 p-2">
                      <Settings2 size={15} /> {movieSpeed}x
                    </button>
                    <button type="button" onClick={() => subtitleInputRef.current?.click()} aria-label="Load subtitles" className={`p-2 ${isSubtitleFileSelected ? "text-emerald-300" : ""}`}>
                      <Subtitles size={17} />
                    </button>
                    {subtitleUrl && (
                      <button type="button" onClick={() => setSubtitleUrl(null)} aria-label="Remove subtitles" className="p-2"><X size={15} /></button>
                    )}
                    <button type="button" onClick={toggleMovieFullscreen} aria-label={movieFullscreen ? "Exit fullscreen" : "Enter fullscreen"} className="ml-auto p-2">
                      {movieFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
                    </button>
                  </div>
                </div>
              </div>
            ) : screen === "eq" ? (
              <div className="flex-1 flex flex-col items-center justify-center relative z-10 w-full px-2">
                
                {/* Reset EQ Button */}
                <button 
                  onClick={() => {
                    setEqGains([0, 0, 0, 0, 0]);
                    filtersRef.current.forEach(f => {
                      if (f) f.gain.value = 0;
                    });
                    triggerHaptic("confirm", hapticsOn);
                  }}
                  className={`absolute top-0 right-1 border ${theme.border}/50 px-2 py-0.5 rounded text-[8px] uppercase tracking-widest active:${theme.selectedBg} active:${theme.selectedText}`}
                >
                  Reset All
                </button>

                <div className="flex gap-3 items-end h-[60%] w-full justify-between max-w-[200px] mt-4">
                  {eqGains.map((gain, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => {
                        if (selectedIndex === idx) {
                          setEqGains(prev => {
                            const newGains = [...prev];
                            newGains[idx] = 0;
                            if (filtersRef.current[idx]) filtersRef.current[idx].gain.value = 0;
                            return newGains;
                          });
                          triggerHaptic("confirm", hapticsOn);
                        } else {
                          setSelectedIndex(idx);
                          setEqEditMode(true);
                        }
                      }}
                      className={`flex flex-col items-center gap-2 flex-1 transition-opacity cursor-pointer ${selectedIndex === idx ? 'opacity-100' : 'opacity-40'}`}
                    >
                      <div className={`w-full max-w-[12px] h-full min-h-[70px] rounded-full overflow-hidden relative border ${theme.border}/40 ${eqEditMode && selectedIndex === idx ? 'bg-current/20 shadow-[0_0_8px_currentColor]' : 'bg-black/10 shadow-[inset_0_2px_5px_rgba(0,0,0,0.5)]'}`}>
                        <div 
                          className="absolute bottom-0 w-full bg-current transition-all"
                          style={{ height: `${((gain + 12) / 24) * 100}%` }}
                        />
                        <div className="absolute top-1/2 w-full h-[1px] bg-current/40" />
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[7px] font-bold tracking-widest">{["60", "230", "910", "3.6k", "14k"][idx]}</span>
                        <span className="text-[8px] font-bold">{gain > 0 ? `+${gain}` : gain}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 text-[9px] font-bold tracking-widest uppercase opacity-70">
                  <SlidersHorizontal size={12} />
                  <span>{eqEditMode ? "Adjusting Gain..." : "Select Band"}</span>
                </div>
              </div>
            ) : screen === "nowPlaying" && isDetailedNowPlaying ? (
              renderDetailedNowPlaying()
            ) : (
              <div className={`flex-1 flex flex-col items-center relative z-10 overflow-hidden ${radioModeOn ? "justify-start pt-1" : "justify-center"}`}>
                <div
                  className={`relative w-full flex shrink-0 items-center justify-center touch-pan-y ${radioModeOn ? "h-16 mb-1" : "h-24 mb-2"}`}
                  onPointerDown={handleCoverSwipeStart}
                  onPointerUp={handleCoverSwipeEnd}
                  onPointerCancel={() => { coverSwipeStartXRef.current = null; }}
                >
                  {radioModeOn && currentSong ? (
                    <div className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-lg border border-white/30 bg-black/25 shadow-[0_6px_18px_rgba(0,0,0,0.4)]">
                      {currentSong.artworkUrl ? (
                        <Image
                          src={currentSong.artworkUrl}
                          alt={`${currentSong.name} artwork`}
                          fill
                          sizes="60px"
                          unoptimized
                          className="object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/60"><Music size={32} /></div>
                      )}
                    </div>
                  ) : (
                    <AlbumCoverflow
                      items={activeCoverflowItems}
                      activeIndex={coverflowActiveIndex}
                      isPlaying={unifiedIsPlaying}
                    />
                  )}
                </div>

                <p className={`w-full shrink-0 truncate px-4 text-center font-bold tracking-wide leading-tight ${radioModeOn ? "text-sm" : "text-base md:text-lg"}`}>
                  {unifiedTrackName}
                </p>
                {renderRadioControls(true)}
                
                <div className={`w-full shrink-0 flex items-center gap-3 px-2 ${radioModeOn ? "mt-1" : "mt-4"}`}>
                  <span className="text-[10px] font-bold tracking-wider">
                    {formatTime(unifiedCurrentTime)}
                  </span>
                  <div
                    className="flex-1 h-[14px] flex items-center cursor-pointer touch-none"
                    role="slider"
                    aria-label="Song progress"
                    aria-valuemin={0}
                    aria-valuemax={unifiedDuration}
                    aria-valuenow={unifiedCurrentTime}
                    aria-valuetext={`${formatTime(unifiedCurrentTime)} of ${formatTime(unifiedDuration)}`}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (unifiedDuration <= 0) return;
                      const seekStep = seekJumpSeconds * (event.shiftKey ? 3 : 1);
                      const position = Capacitor.getPlatform() === "android"
                        ? unifiedCurrentTime
                        : audioRef.current?.currentTime ?? unifiedCurrentTime;
                      const targetTime = event.key === "ArrowRight"
                        ? Math.min(unifiedDuration, position + seekStep)
                        : event.key === "ArrowLeft"
                        ? Math.max(0, position - seekStep)
                        : event.key === "Home"
                        ? 0
                        : event.key === "End"
                        ? unifiedDuration
                        : null;
                      if (targetTime === null) return;
                      event.preventDefault();
                      event.stopPropagation();
                      seekAudioTo(targetTime);
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (unifiedDuration <= 0) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                      const nextTime = ratio * unifiedDuration;
                      seekPreviewRef.current = nextTime;
                      if (Capacitor.getPlatform() === "android") setCurrentTime(nextTime);
                      else seekAudioTo(nextTime);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      event.stopPropagation();
                      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      if (unifiedDuration <= 0) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                      const nextTime = ratio * unifiedDuration;
                      seekPreviewRef.current = nextTime;
                      if (Capacitor.getPlatform() === "android") setCurrentTime(nextTime);
                      else if (audioRef.current) audioRef.current.currentTime = nextTime;
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        if (Capacitor.getPlatform() === "android") {
                          seekAudioTo(seekPreviewRef.current);
                        }
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    onPointerCancel={(event) => {
                      event.stopPropagation();
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                  >
                    <div className="w-full h-[4px] rounded-sm overflow-visible relative bg-current opacity-20">
                      <div
                        className="absolute top-0 left-0 h-full bg-current opacity-100"
                        style={{ width: `${Math.min(100, Math.max(0, unifiedProgress))}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-current"
                        style={{ left: `calc(${Math.min(100, Math.max(0, unifiedProgress))}% - 5px)` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold tracking-wider">
                    -{formatTime(Math.max(0, unifiedDuration - unifiedCurrentTime))}
                  </span>
                </div>

                <div className={`${radioModeOn ? "mt-1" : "mt-3"} flex shrink-0 items-center gap-3 text-[9px] font-bold tracking-widest uppercase`}>
                  <button
                    type="button"
                    aria-label={`Playback speed ${playbackSpeed}x. Tap to change speed`}
                    title="Tap to change playback speed"
                    onClick={(event) => {
                      event.stopPropagation();
                      cyclePlaybackSpeed();
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 border-[1.5px] ${theme.border} rounded-sm touch-manipulation active:scale-95`}
                  >
                    <RefreshCw size={10} strokeWidth={3} />
                    <span>{playbackSpeed}x</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Shuffle ${shuffleOn ? "on" : "off"}`}
                    title={`Shuffle ${shuffleOn ? "on" : "off"}`}
                    onClick={() => {
                      toggleShuffle();
                      triggerHaptic("select", hapticsOn);
                    }}
                    className={`p-1 rounded ${shuffleOn ? "bg-current/20" : "opacity-50"}`}
                  >
                    <Shuffle size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Repeat ${repeatMode}`}
                    title={`Repeat ${repeatMode}`}
                    onClick={() => {
                      cycleRepeat();
                      triggerHaptic("select", hapticsOn);
                    }}
                    className={`flex items-center gap-1 p-1 rounded ${repeatMode !== "off" ? "bg-current/20" : "opacity-50"}`}
                  >
                    {repeatMode === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
                    <span>{repeatMode === "off" ? "OFF" : repeatMode === "one" ? "ONE" : "ALL"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full flex items-center justify-center p-4">
        <div 
          ref={padRef}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.setPointerCapture(e.pointerId);
            handleStart(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => handleMove(e.clientX, e.clientY)}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            handleEnd();
          }}
          onPointerCancel={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            handleEnd();
          }}
          className="relative w-[82vw] max-w-[340px] aspect-square rounded-full border border-[#111] bg-[#0a0a0a] flex items-center justify-center cursor-grab active:cursor-grabbing shadow-[0_15px_40px_rgba(0,0,0,0.8),inset_0_1px_2px_rgba(255,255,255,0.05)]"
        >
          <div className="absolute w-[45%] aspect-square rounded-full border-[1.5px] border-black bg-[#111] flex items-center justify-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.9)] pointer-events-none">
            <motion.button 
              whileTap={{ scale: 0.96 }}
              onClick={handleCenterClick}
              className="w-[70%] aspect-square rounded-full bg-[#18181a] border border-black flex items-center justify-center cursor-pointer pointer-events-auto shadow-[0_5px_15px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group"
            >
              {screen === "nowPlaying" && detailedViewEnabled && currentSong && !isDetailedNowPlaying ? (
                <Music size={20} className="text-gray-500 group-active:text-white" />
              ) : screen === "nowPlaying" ? (
                unifiedIsPlaying ? <Pause size={20} className="text-gray-500 group-active:text-white"/> : <Play size={20} className="ml-1 text-gray-500 group-active:text-white"/>
              ) : (
                <div className="w-3 h-3 rounded-full bg-gray-600/30 group-active:bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)] transition-colors"></div>
              )}
            </motion.button>
          </div>

          <button 
            onClick={handleMenuClick}
            className="absolute top-[8%] text-gray-600 hover:text-white text-[11px] font-bold tracking-[0.2em] uppercase cursor-pointer pointer-events-auto z-20 transition-colors p-2"
          >
            MENU
          </button>
          
          <button 
            onClick={handleGlobalPlayPause}
            aria-label={unifiedIsPlaying ? "Pause playback" : "Resume playback"}
            className="absolute bottom-[8%] text-gray-600 hover:text-white cursor-pointer pointer-events-auto z-20 transition-colors p-2"
          >
            {unifiedIsPlaying ? <Pause size={18}/> : <Play size={18} className="inline"/>}
          </button>

          <button onClick={() => screen === "moviePlaying" ? skipMovie(-10) : handlePrevSong()} aria-label={screen === "moviePlaying" ? "Back 10 seconds" : "Previous song"} className="absolute left-[7%] text-gray-600 hover:text-white cursor-pointer pointer-events-auto z-20 p-3">
            {screen === "moviePlaying" ? <Rewind size={18}/> : <SkipBack size={18}/>}
          </button>
          <button onClick={() => screen === "moviePlaying" ? skipMovie(10) : handleNextSong()} aria-label={screen === "moviePlaying" ? "Forward 10 seconds" : "Next song"} className="absolute right-[7%] text-gray-600 hover:text-white cursor-pointer pointer-events-auto z-20 p-3">
            {screen === "moviePlaying" ? <FastForward size={18}/> : <SkipForward size={18}/>}
          </button>
        </div>
      </div>
    </div>
  );
}