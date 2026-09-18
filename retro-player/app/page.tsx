"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Play, Pause, SkipForward, SkipBack, RefreshCw, Volume2, SlidersHorizontal } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import AlbumCoverflow, { CoverflowItem } from "@/components/AlbumCoverflow";
import {
  searchYouTube,
  getYouTubeStream,
  getYouTubePlaylist,
} from "@/lib/youtube-client";

// --- GLOBAL AUDIO CONTEXT & HELPERS ---
let audioCtx: AudioContext | null = null;

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

type SongItem = { file: File; name: string; artworkUrl?: string };
type YouTubeTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumbnail: string;
  source: "youtube";
};

type MenuItem = {
  label: string;
  type: "menu" | "action" | "song" | "youtube_track";
  targetId?: string;
  actionId?: string;
  song?: SongItem;
  youtubeTrack?: YouTubeTrack;
};
type Menu = { id: string; title: string; items: MenuItem[] };
type PlaybackSource = "local" | "youtube";

export default function MobileBulletproofPlayer() {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState("12:00");
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  // YouTube state
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);
  const [youtubeSearchInput, setYouTubeSearchInput] = useState("");
  const [youtubeSearchResults, setYouTubeSearchResults] = useState<YouTubeTrack[]>([]);
  const [youtubeSearchLoading, setYouTubeSearchLoading] = useState(false);
  const [youtubeError, setYouTubeError] = useState("");
  const [youtubeAccountConnected, setYouTubeAccountConnected] = useState(false);
  const [youtubePlaylists, setYouTubePlaylists] = useState<any[]>([]);
  const [youtubePlaylistsLoading, setYouTubePlaylistsLoading] = useState(false);
  const [youtubePlaylistTracks, setYouTubePlaylistTracks] = useState<Record<string, YouTubeTrack[]>>({});
  const [youtubePlaylistTracksLoading, setYouTubePlaylistTracksLoading] = useState<string | null>(null);
  const [youtubeQueue, setYouTubeQueue] = useState<YouTubeTrack[]>([]);
  const [youtubeQueueIndex, setYouTubeQueueIndex] = useState(0);
  const [youtubeCurrentTrack, setYouTubeCurrentTrack] = useState<YouTubeTrack | null>(null);

  // Settings
  const [lcdTheme, setLcdTheme] = useState<
    "sepia" | "blue" | "green" | "amber" | "gray" | "pink" | "purple" | "teal" | "white" | "red" | "oled-red" | "oled-amber" | "oled-green" | "oled-cyan" | "oled-magenta" | "cyberpunk" | "vaporwave" | "midnight"
  >("sepia");
  const [hapticsOn, setHapticsOn] = useState(true);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "one" | "all">("all");
  const [clock24h, setClock24h] = useState(true);
  const [sleepTimerEndAt, setSleepTimerEndAt] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<"default" | "a-z" | "z-a">("default");

  // PRO Features State
  const [showDiag, setShowDiag] = useState(false);
  const [volOverlay, setVolOverlay] = useState<number | null>(null);
  const [eqGains, setEqGains] = useState<number[]>([0, 0, 0, 0, 0]);
  const [eqEditMode, setEqEditMode] = useState(false);

  // --- UNIFIED PLAYBACK STATE ---
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>("local");

  // References
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  
  const [localSongs, setLocalSongs] = useState<SongItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const [menuStack, setMenuStack] = useState<string[]>(["root"]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [screen, setScreen] = useState<"menu" | "nowPlaying" | "eq">("menu");

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
  const playbackSourceRef = useRef<PlaybackSource>("local");
  const repeatModeRef = useRef<"off" | "one" | "all">("all");
  const shuffleOnRef = useRef(false);
  const localSongsRef = useRef<SongItem[]>([]);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const youtubePlaybackRequestRef = useRef(0);

  useEffect(() => { clock24hRef.current = clock24h; }, [clock24h]);
  useEffect(() => { sleepTimerEndAtRef.current = sleepTimerEndAt; }, [sleepTimerEndAt]);
  useEffect(() => { playbackSourceRef.current = playbackSource; }, [playbackSource]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { shuffleOnRef.current = shuffleOn; }, [shuffleOn]);
  useEffect(() => { localSongsRef.current = localSongs; }, [localSongs]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // --- AUDIO ENGINE INIT & EQ ROUTING ---
  const ensureAudioGraph = () => {
    if (!audioRef.current || sourceNodeRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      
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
      audioCtxRef.current.resume();
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
      const root = await navigator.storage.getDirectory();
      const loadedSongs: SongItem[] = [];
      // @ts-ignore
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const artworkUrl = await extractArtwork(file);
          loadedSongs.push({ file, name: file.name.replace(/\.[^/.]+$/, ""), artworkUrl });
        }
      }
      
      if (loadedSongs.length > 0) {
        setLocalSongs(loadedSongs);
        const lastSongName = localStorage.getItem("retro_last_song_name");
        if (lastSongName) {
          const foundIdx = loadedSongs.findIndex(s => s.name === lastSongName);
          if (foundIdx !== -1) {
            setCurrentSong(loadedSongs[foundIdx]);
            setCurrentIndex(foundIdx);
            setPlaybackSource("local");
            if (audioRef.current) {
              audioRef.current.src = URL.createObjectURL(loadedSongs[foundIdx].file);
              audioRef.current.load();
              audioRef.current.addEventListener('loadedmetadata', function restoreTime() {
                const lastTime = parseFloat(localStorage.getItem("retro_last_time") || "0");
                if (audioRef.current) audioRef.current.currentTime = lastTime;
                setCurrentTime(lastTime);
                audioRef.current?.removeEventListener('loadedmetadata', restoreTime);
              });
            }
          }
        }
      }
    } catch (e) {
      console.log("No persistent storage cache found.");
    }
  };

  const saveSongsToStorage = async (files: File[]) => {
    try {
      const root = await navigator.storage.getDirectory();
      for (const file of files) {
        const handle = await root.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
      }
    } catch (e) {
      console.log("Storage error", e);
    }
  };

  const clearLocalLibrary = async () => {
    try {
      const root = await navigator.storage.getDirectory();
      // @ts-ignore
      for await (const name of root.keys()) {
        await root.removeEntry(name).catch(() => {});
      }
    } catch (e) {
      console.log("Storage error", e);
    }
    setLocalSongs([]);
    if (playbackSource === "local") {
      setIsPlaying(false);
      setCurrentSong(null);
      setCurrentIndex(0);
      setScreen("menu");
    }
  };

  const removeSpecificSong = async (fileName: string) => {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(fileName);
    } catch (e) {
      console.log("Could not remove file", e);
    }
    setLocalSongs(prev => prev.filter(s => s.file.name !== fileName));
    if (currentSong?.file.name === fileName) {
      setIsPlaying(false);
      setCurrentSong(null);
      setScreen("menu");
    }
  };

  const playSong = (song: SongItem, index: number) => {
    ensureAudioGraph();
    wakeUpAudioCtx();

    const audio = audioRef.current;
    setPlaybackSource("local");
    setCurrentSong(song);
    setCurrentIndex(index);
    setScreen("nowPlaying");

    if (audio) {
      audio.pause();
      audio.src = URL.createObjectURL(song.file);
      audio.load();
      audio.playbackRate = playbackSpeed;
      audio.play().then(() => {
        isPlayingRef.current = true;
        setIsPlaying(true);
      }).catch((error) => {
        console.error("Local playback failed:", error);
        isPlayingRef.current = false;
        setIsPlaying(false);
      });
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
  };

  const showYouTubeError = (message: string) => {
    setYouTubeError(message);
  };

  const handleYouTubeSearch = async (query: string) => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    setYouTubeSearchLoading(true);
    setYouTubeError("");

    try {
      const results = await searchYouTube(cleanQuery);
      setYouTubeSearchResults(results as YouTubeTrack[]);
      setShowYouTubeModal(true);
    } catch (error) {
      console.error("YouTube search failed:", error);
      showYouTubeError("Couldn't search YouTube. Please try again.");
    } finally {
      setYouTubeSearchLoading(false);
    }
  };

  const playYouTubeList = async (list: YouTubeTrack[], index: number) => {
    if (!list.length || !list[index]) return;

    const track = list[index];
    const requestId = ++youtubePlaybackRequestRef.current;

    try {
      ensureAudioGraph();
      wakeUpAudioCtx();

      const audio = audioRef.current;
      if (!audio) return;

      // Stop the previous track immediately. The request id prevents an older
      // stream lookup from replacing a newer queue selection.
      audio.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);

      setCurrentSong(null);
      setPlaybackSource("youtube");
      setYouTubeQueue(list);
      setYouTubeQueueIndex(index);
      setYouTubeCurrentTrack(track);
      setScreen("nowPlaying");

      const stream = await getYouTubeStream(track.id);

      // User selected another track while this stream was resolving.
      if (requestId !== youtubePlaybackRequestRef.current) return;

      const currentAudio = audioRef.current;
      if (!currentAudio) return;

      currentAudio.pause();
      currentAudio.src = stream.url;
      currentAudio.load();
      currentAudio.playbackRate = playbackSpeed;

      await currentAudio.play();

      // Make sure a stale request cannot mark the new track as playing.
      if (requestId !== youtubePlaybackRequestRef.current) {
        currentAudio.pause();
        return;
      }

      isPlayingRef.current = true;
      setIsPlaying(true);
      triggerHaptic("select", hapticsOn);
    } catch (error) {
      if (requestId !== youtubePlaybackRequestRef.current) return;
      console.error("YouTube playback failed:", error);
      isPlayingRef.current = false;
      setIsPlaying(false);
      showYouTubeError("Couldn't play this YouTube track.");
    }
  };

  const playYouTubeTrack = (track: YouTubeTrack) => {
    const queue = youtubeSearchResults.length ? youtubeSearchResults : [track];
    const index = Math.max(0, queue.findIndex((item) => item.id === track.id));
    return playYouTubeList(queue, index);
  };

  const pickRandomIndex = (length: number, exclude: number) => {
    if (length <= 1) return 0;
    let idx = exclude;
    while (idx === exclude) idx = Math.floor(Math.random() * length);
    return idx;
  };

  const handleNextSong = () => {
    if (playbackSource === "youtube") {
      if (!youtubeQueue.length) return;

      const nextIdx = shuffleOn
        ? pickRandomIndex(youtubeQueue.length, youtubeQueueIndex)
        : (youtubeQueueIndex + 1) % youtubeQueue.length;

      playYouTubeList(youtubeQueue, nextIdx);
      return;
    }

    if (localSongs.length === 0) return;
    const nextIdx = shuffleOn ? pickRandomIndex(localSongs.length, currentIndex) : (currentIndex + 1) % localSongs.length;
    playSong(localSongs[nextIdx], nextIdx);
  };

  const handlePrevSong = () => {
    if (playbackSource === "youtube") {
      if (!youtubeQueue.length) return;

      const prevIdx =
        (youtubeQueueIndex - 1 + youtubeQueue.length) %
        youtubeQueue.length;

      playYouTubeList(youtubeQueue, prevIdx);
      return;
    }

    if (localSongs.length === 0) return;
    const prevIdx = (currentIndex - 1 + localSongs.length) % localSongs.length;
    playSong(localSongs[prevIdx], prevIdx);
  };

  const handleTrackEnded = () => {
    if (playbackSourceRef.current === "youtube") {
      if (repeatModeRef.current === "one" && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
        return;
      }

      if (!youtubeQueue.length) {
        setIsPlaying(false);
        return;
      }

      if (shuffleOnRef.current) {
        const nextIdx = pickRandomIndex(
          youtubeQueue.length,
          youtubeQueueIndex
        );
        playYouTubeList(youtubeQueue, nextIdx);
        return;
      }

      const isLast = youtubeQueueIndex === youtubeQueue.length - 1;

      if (isLast && repeatModeRef.current === "off") {
        setIsPlaying(false);
        return;
      }

      const nextIdx =
        (youtubeQueueIndex + 1) % youtubeQueue.length;

      playYouTubeList(youtubeQueue, nextIdx);
      return;
    }

    if (repeatModeRef.current === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
      return;
    }

    if (localSongsRef.current.length === 0) return;

    if (shuffleOnRef.current) {
      const nextIdx = pickRandomIndex(localSongsRef.current.length, currentIndexRef.current);
      playSong(localSongsRef.current[nextIdx], nextIdx);
      return;
    }

    const isLast = currentIndexRef.current === localSongsRef.current.length - 1;
    if (isLast && repeatModeRef.current === "off") {
      setIsPlaying(false);
      return;
    }

    const nextIdx = (currentIndexRef.current + 1) % localSongsRef.current.length;
    playSong(localSongsRef.current[nextIdx], nextIdx);
  };

  const latestTrackEnded = useRef(handleTrackEnded);
  useEffect(() => {
    latestTrackEnded.current = handleTrackEnded;
  });

  // --- INITIALIZATION EFFECTS ---
  useEffect(() => {
    import('@capacitor/status-bar').then(({ StatusBar }) => {
      StatusBar.hide().catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    }).catch(() => {});

    const hasSeenOnboard = localStorage.getItem("retro_onboarded");
    if (!hasSeenOnboard) setShowOnboarding(true);

    const savedTheme = localStorage.getItem("retro_theme");
    if (savedTheme) setLcdTheme(savedTheme as any);
    
    const savedHaptics = localStorage.getItem("retro_haptics");
    if (savedHaptics !== null) setHapticsOn(savedHaptics === "true");
    
    const savedSpeed = localStorage.getItem("retro_speed");
    if (savedSpeed) setPlaybackSpeed(parseFloat(savedSpeed));

    const savedShuffle = localStorage.getItem("retro_shuffle");
    if (savedShuffle !== null) setShuffleOn(savedShuffle === "true");

    const savedRepeat = localStorage.getItem("retro_repeat");
    if (savedRepeat) setRepeatMode(savedRepeat as any);

    const savedClock = localStorage.getItem("retro_clock24");
    if (savedClock !== null) setClock24h(savedClock === "true");

    const savedEQ = localStorage.getItem("retro_eq_gains");
    if (savedEQ) {
      try { setEqGains(JSON.parse(savedEQ)); } catch (e) {}
    }

    const updateClock = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24hRef.current }));

      const endAt = sleepTimerEndAtRef.current;
      if (endAt !== null && Date.now() >= endAt) {
        setIsPlaying(false);
        audioRef.current?.pause();
        setSleepTimerEndAt(null);
      }

      if (audioRef.current && !audioRef.current.paused && playbackSourceRef.current === "local") {
        localStorage.setItem("retro_last_time", audioRef.current.currentTime.toString());
      }
    };
    updateClock();
    const clockInterval = setInterval(updateClock, 1000);

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
      setProgress((audio.currentTime / audio.duration) * 100 || 0);
    };
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('volumechange', handleVolume);
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration || 0));
    audio.addEventListener('ended', () => latestTrackEnded.current());

    loadPersistedSongs();

    if ('getBattery' in navigator) {
      // @ts-ignore
      navigator.getBattery().then((battery: any) => {
        setBatteryLevel(battery.level * 100);
        setIsCharging(battery.charging);
        
        if (typeof battery.addEventListener === 'function') {
          battery.addEventListener('levelchange', () => setBatteryLevel(battery.level * 100));
          battery.addEventListener('chargingchange', () => setIsCharging(battery.charging));
        } else {
          battery.onlevelchange = () => setBatteryLevel(battery.level * 100);
          battery.onchargingchange = () => setIsCharging(battery.charging);
        }
      });
    } else {
      setBatteryLevel(100); 
    }

    return () => {
      clearInterval(clockInterval);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('volumechange', handleVolume);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkYouTubeAccount = async () => {
      try {
        const response = await fetch("/api/youtube/account/playlists", {
          credentials: "include",
        });

        if (!cancelled) {
          setYouTubeAccountConnected(response.ok);
        }
      } catch {
        if (!cancelled) setYouTubeAccountConnected(false);
      }
    };

    checkYouTubeAccount();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => { localStorage.setItem("retro_theme", lcdTheme); }, [lcdTheme]);
  useEffect(() => { localStorage.setItem("retro_haptics", String(hapticsOn)); }, [hapticsOn]);
  useEffect(() => { localStorage.setItem("retro_speed", String(playbackSpeed)); }, [playbackSpeed]);
  useEffect(() => { localStorage.setItem("retro_shuffle", String(shuffleOn)); }, [shuffleOn]);
  useEffect(() => { localStorage.setItem("retro_repeat", repeatMode); }, [repeatMode]);
  useEffect(() => { localStorage.setItem("retro_clock24", String(clock24h)); }, [clock24h]);
  useEffect(() => { localStorage.setItem("retro_eq_gains", JSON.stringify(eqGains)); }, [eqGains]);

  useEffect(() => {
    if (currentSong && playbackSource === "local") {
      localStorage.setItem("retro_last_song_name", currentSong.name);
    }
  }, [currentSong, playbackSource]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;

    if (isPlaying) {
      ensureAudioGraph();
      wakeUpAudioCtx();
      audioRef.current?.play().catch(e => console.log("Playback prevented:", e));
    } else {
      audioRef.current?.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const title = playbackSource === "youtube"
      ? youtubeCurrentTrack?.title
      : currentSong?.name;

    if (!title) return;

    const artist = playbackSource === "youtube"
      ? youtubeCurrentTrack?.artist || "YouTube"
      : "Local Device Library";

    const artworkUrl = playbackSource === "youtube"
      ? youtubeCurrentTrack?.thumbnail
      : currentSong?.artworkUrl;

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: playbackSource === "youtube"
        ? youtubeCurrentTrack?.album || "YouTube"
        : "Retro Custom Player",
      artwork: artworkUrl
        ? [{ src: artworkUrl, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });

    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", handlePrevSong);
    navigator.mediaSession.setActionHandler("nexttrack", handleNextSong);
  }, [currentSong, youtubeCurrentTrack, playbackSource, localSongs, currentIndex, youtubeQueueIndex]);

  const sortedLocalSongs = useMemo(() => {
    if (sortMode === "a-z") return [...localSongs].sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "z-a") return [...localSongs].sort((a, b) => b.name.localeCompare(a.name));
    return localSongs;
  }, [localSongs, sortMode]);

  // --- MENUS & UI LOGIC ---
  const menus = useMemo((): Record<string, Menu> => {
    const isReadyToPlay = currentSong || youtubeCurrentTrack;

    return {
      root: {
        id: "root",
        title: "Main Menu",
        items: [
          ...(isReadyToPlay ? [{ label: "Now Playing", type: "action" as const, actionId: "go_now_playing" }] : []),
          { label: "Local Audio Library", type: "menu", targetId: "local" },
          { label: "YouTube Music", type: "menu", targetId: "youtube" },
          { label: "Playback Tools", type: "menu", targetId: "tools" },
          { label: "System Settings", type: "menu", targetId: "settings" }
        ]
      },
      tools: {
        id: "tools",
        title: "Pro Tools",
        items: [
          { label: "[ 5-Band Equalizer ]", type: "action", actionId: "open_eq" },
        ]
      },
      local: {
        id: "local",
        title: "Local Dashboard",
        items: [
          { label: "All Songs", type: "menu", targetId: "local_songs" },
          { label: "[ Import New Songs ]", type: "action", actionId: "scan_local" },
          { label: `[ Sort: ${sortMode.toUpperCase()} ]`, type: "action", actionId: "cycle_sort" },
          { label: "[ Manage & Remove ]", type: "menu", targetId: "local_edit" }
        ]
      },
      local_songs: {
        id: "local_songs",
        title: "All Songs",
        items: sortedLocalSongs.length > 0 
          ? sortedLocalSongs.map((song) => ({
              label: song.name,
              type: "song" as const,
              song: song
            }))
          : [{ label: "(Library is empty)", type: "action", actionId: "noop" }]
      },
      local_edit: {
        id: "local_edit",
        title: "Remove Songs",
        items: sortedLocalSongs.length > 0
          ? sortedLocalSongs.map((song) => ({
              label: `🗑 ${song.name}`,
              type: "action" as const,
              actionId: `delete_song:${song.file.name}`
            }))
          : [{ label: "(Library is empty)", type: "action", actionId: "noop" }]
      },
      youtube: {
        id: "youtube",
        title: "YouTube",
        items: [
          { label: "Search YouTube", type: "action", actionId: "youtube_search" },
          youtubeAccountConnected
            ? { label: "Your Playlists", type: "menu", targetId: "youtube_playlists" }
            : { label: "Sign In & Sync Playlists", type: "action", actionId: "youtube_sign_in" },
          ...(youtubeAccountConnected
            ? [{ label: "[ Sign Out ]", type: "action" as const, actionId: "youtube_sign_out" }]
            : []),
        ],
      },
      youtube_search_results: {
        id: "youtube_search_results",
        title: "Search Results",
        items: youtubeSearchResults.length
          ? youtubeSearchResults.map((track) => ({
              label: track.title,
              type: "youtube_track" as const,
              youtubeTrack: track,
            }))
          : [{ label: "(No results)", type: "action" as const, actionId: "noop" }],
      },
      youtube_playlists: {
        id: "youtube_playlists",
        title: "Your Playlists",
        items: youtubePlaylistsLoading
          ? [{ label: "Loading...", type: "action" as const, actionId: "noop" }]
          : youtubePlaylists.length
          ? youtubePlaylists.map((playlist) => ({
              label: playlist.snippet?.title || "Untitled Playlist",
              type: "action" as const,
              actionId: `open_youtube_playlist:${playlist.id}`,
            }))
          : [{ label: "No playlists found", type: "action" as const, actionId: "noop" }],
      },
      ...Object.fromEntries(
        Object.entries(youtubePlaylistTracks).map(([playlistId, tracks]) => [
          `youtube_playlist_${playlistId}`,
          {
            id: `youtube_playlist_${playlistId}`,
            title:
              youtubePlaylists.find((p) => p.id === playlistId)?.snippet?.title ||
              "Playlist",
            items:
              youtubePlaylistTracksLoading === playlistId
                ? [{ label: "Loading...", type: "action" as const, actionId: "noop" }]
                : tracks.length
                ? tracks.map((track) => ({
                    label: track.title,
                    type: "youtube_track" as const,
                    youtubeTrack: track,
                  }))
                : [{ label: "Playlist is empty", type: "action" as const, actionId: "noop" }],
          },
        ])
      ),

      settings: {
        id: "settings",
        title: "Settings",
        items: [
          { label: "LCD Theme", type: "menu", targetId: "settings_theme" },
          { label: `Haptics: ${hapticsOn ? "ON" : "OFF"}`, type: "action", actionId: "toggle_haptics" },
          { label: `Shuffle: ${shuffleOn ? "ON" : "OFF"}`, type: "action", actionId: "toggle_shuffle" },
          { label: `Repeat: ${repeatMode === "off" ? "OFF" : repeatMode === "one" ? "ONE" : "ALL"}`, type: "action", actionId: "cycle_repeat" },
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
      settings_theme: {
        id: "settings_theme",
        title: "LCD Theme",
        items: [
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
          { label: "Cyberpunk", type: "action", actionId: "theme_cyberpunk" },
          { label: "Vaporwave", type: "action", actionId: "theme_vaporwave" },
          { label: "Midnight", type: "action", actionId: "theme_midnight" }
        ]
      }
    };
  }, [
    currentSong,
    playbackSource,
    sortedLocalSongs,
    sortMode,
    hapticsOn,
    shuffleOn,
    repeatMode,
    clock24h,
    sleepTimerEndAt,
    youtubeAccountConnected,
    youtubePlaylists,
    youtubePlaylistsLoading,
    youtubeSearchResults,
    youtubePlaylistTracks,
    youtubePlaylistTracksLoading,
    youtubeCurrentTrack,
  ]);

  useEffect(() => {
    const activeId = menuStack[menuStack.length - 1];

    if (!youtubeAccountConnected) return;

    if (
      activeId === "youtube_playlists" &&
      !youtubePlaylistsLoading &&
      youtubePlaylists.length === 0
    ) {
      setYouTubePlaylistsLoading(true);

      fetch("/api/youtube/account/playlists", {
        credentials: "include",
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Unable to load playlists");
          }
          return response.json();
        })
        .then((data) => {
          setYouTubePlaylists(data.playlists || []);
        })
        .catch(() => {
          setYouTubeAccountConnected(false);
          showYouTubeError("Couldn't load your YouTube playlists.");
        })
        .finally(() => setYouTubePlaylistsLoading(false));
    }
  }, [menuStack, youtubeAccountConnected, youtubePlaylistsLoading, youtubePlaylists.length]);

  const currentMenuId = menuStack[menuStack.length - 1];
  const currentMenu = menus[currentMenuId] || menus.root;

  useEffect(() => {
    if (screen === "menu") {
      const activeElement = document.getElementById(`menu-item-${selectedIndex}`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedIndex, screen, currentMenuId]);

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
          setSelectedIndex((prev) => {
            let next = prev + (steps * direction);
            if (next < 0) next = 0;
            if (next > 4) next = 4;
            if (next !== prev) triggerHaptic("tick", hapticsOn);
            return next;
          });
        }
      } else if (activeRingRef.current === "outer" && screen === "menu") {
        setSelectedIndex((prev) => {
          let next = prev + (steps * direction);
          if (next < 0) next = 0;
          if (next >= currentMenu.items.length) next = currentMenu.items.length - 1;
          if (next !== prev) triggerHaptic("tick", hapticsOn);
          return next;
        });
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

  const handleCenterClick = () => {
    if (screen === "nowPlaying") {
      triggerHaptic("confirm", hapticsOn);
      ensureAudioGraph();
      wakeUpAudioCtx();
      if (currentSong || youtubeCurrentTrack) {
        setIsPlaying(!isPlaying);
      }
      return;
    }
    
    if (screen === "eq") {
      triggerHaptic("confirm", hapticsOn);
      setEqEditMode(!eqEditMode);
      return;
    }

    const selectedItem = currentMenu.items[selectedIndex];

    if (selectedItem?.type === "menu" && selectedItem.targetId) {
      triggerHaptic("select", hapticsOn);
      setMenuStack([...menuStack, selectedItem.targetId]);
      setSelectedIndex(0); 
    } else if (selectedItem?.type === "song" && selectedItem.song) {
      if (currentSong?.file === selectedItem.song.file && playbackSource === "local") {
        setScreen("nowPlaying");
      } else {
        const songIdx = localSongs.findIndex(s => s.file === selectedItem.song?.file);
        playSong(selectedItem.song, songIdx >= 0 ? songIdx : 0);
      }
    } else if (selectedItem?.type === "youtube_track" && selectedItem.youtubeTrack) {
      const list = currentMenu.items
        .filter((it) => it.type === "youtube_track" && it.youtubeTrack)
        .map((it) => it.youtubeTrack!) as YouTubeTrack[];

      const idx = list.findIndex(
        (track) => track.id === selectedItem.youtubeTrack!.id
      );

      if (
        playbackSource === "youtube" &&
        youtubeQueue[youtubeQueueIndex]?.id === selectedItem.youtubeTrack.id
      ) {
        setScreen("nowPlaying");
      } else {
        playYouTubeList(list, idx >= 0 ? idx : 0);
      }
    } else if (selectedItem?.type === "action") {
      switch(selectedItem.actionId) {
        case "open_eq":
          ensureAudioGraph();
          wakeUpAudioCtx();
          setSelectedIndex(0);
          setEqEditMode(false);
          setScreen("eq");
          break;
        case "go_now_playing":
          setScreen("nowPlaying");
          break;
        case "scan_local":
          fileInputRef.current?.click();
          break;
        case "cycle_sort":
          setSortMode(prev => prev === "default" ? "a-z" : prev === "a-z" ? "z-a" : "default");
          break;
        case "toggle_haptics":
          setHapticsOn(!hapticsOn);
          break;
        case "toggle_shuffle":
          setShuffleOn(!shuffleOn);
          break;
        case "cycle_repeat":
          setRepeatMode(repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off");
          break;
        case "toggle_clock":
          setClock24h(!clock24h);
          break;
        case "sleep_off":
          setSleepTimerEndAt(null);
          break;
        case "sleep_15":
          setSleepTimerEndAt(Date.now() + 15 * 60 * 1000);
          break;
        case "sleep_30":
          setSleepTimerEndAt(Date.now() + 30 * 60 * 1000);
          break;
        case "sleep_45":
          setSleepTimerEndAt(Date.now() + 45 * 60 * 1000);
          break;
        case "sleep_60":
          setSleepTimerEndAt(Date.now() + 60 * 60 * 1000);
          break;
        case "clear_library":
          if (typeof window !== "undefined" && window.confirm("Remove all imported songs from this device? This can't be undone.")) {
            clearLocalLibrary();
          }
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
        case "youtube_search":
          setYouTubeError("");
          setYouTubeSearchInput("");
          setShowYouTubeModal(true);
          break;
        case "youtube_sign_in":
          window.location.href = "/api/youtube/auth/start";
          break;
        case "youtube_sign_out":
          fetch("/api/youtube/auth/logout", {
            method: "POST",
            credentials: "include",
          }).finally(() => {
            setYouTubeAccountConnected(false);
            setYouTubePlaylists([]);
            setYouTubePlaylistTracks({});
          });
          break;
        case "noop":
          break;
        default:
          if (selectedItem.actionId?.startsWith("delete_song:")) {
            const fileName = selectedItem.actionId.replace("delete_song:", "");
            if (typeof window !== "undefined" && window.confirm(`Remove ${fileName} from device?`)) {
              removeSpecificSong(fileName);
            }
          }
          else if (
            selectedItem.actionId?.startsWith("open_youtube_playlist:")
          ) {
            const playlistId = selectedItem.actionId.replace(
              "open_youtube_playlist:",
              ""
            );

            triggerHaptic("select", hapticsOn);
            setMenuStack([
              ...menuStack,
              `youtube_playlist_${playlistId}`,
            ]);
            setSelectedIndex(0);

            if (!youtubePlaylistTracks[playlistId]) {
              setYouTubePlaylistTracksLoading(playlistId);

              getYouTubePlaylist(playlistId)
                .then((playlist) => {
                  setYouTubePlaylistTracks((prev) => ({
                    ...prev,
                    [playlistId]: playlist.items as YouTubeTrack[],
                  }));
                })
                .catch(() => {
                  showYouTubeError(
                    "Couldn't load that YouTube playlist."
                  );
                })
                .finally(() =>
                  setYouTubePlaylistTracksLoading(null)
                );
            }
          }
      }
    }
  };

  const handleGlobalPlayPause = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    ensureAudioGraph();
    wakeUpAudioCtx();

    if (currentSong || youtubeCurrentTrack) {
      setIsPlaying(!isPlaying);
    }
  };

  const handleMenuClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation(); 
    if (screen === "eq") {
      if (eqEditMode) {
        setEqEditMode(false);
      } else {
        setScreen("menu"); 
      }
    } else if (screen === "nowPlaying") {
      setScreen("menu"); 
    } else if (menuStack.length > 1) {
      const newStack = [...menuStack];
      newStack.pop();
      setMenuStack(newStack);
      setSelectedIndex(0);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      const newSongs: SongItem[] = [];
      for (const file of newFiles) {
        const artworkUrl = await extractArtwork(file);
        newSongs.push({ file, name: file.name.replace(/\.[^/.]+$/, ""), artworkUrl });
      }
      const updatedList = [...localSongs, ...newSongs];
      setLocalSongs(updatedList);
      saveSongsToStorage(newFiles);
    }
  };

  const getLcdStyle = () => {
    switch(lcdTheme) {
      case "cyberpunk": return { bg: "bg-[#fcee0a]", text: "text-[#ff003c]", border: "border-[#ff003c]", selectedBg: "bg-[#ff003c]", selectedText: "text-[#fcee0a]" };
      case "vaporwave": return { bg: "from-[#ff71ce] to-[#01cdfe]", text: "text-[#05ffa1]", border: "border-[#b967ff]", selectedBg: "bg-[#b967ff]", selectedText: "text-[#fffb96]" };
      case "sepia": return { bg: "from-[#e4d0b8] to-[#c7a982]", text: "text-[#5e4022]", border: "border-[#5e4022]", selectedBg: "bg-[#5e4022]", selectedText: "text-[#e4d0b8]" };
      case "midnight": return { bg: "from-[#0f172a] to-[#020617]", text: "text-[#38bdf8]", border: "border-[#38bdf8]", selectedBg: "bg-[#38bdf8]", selectedText: "text-[#020617]" };
      case "oled-red": return { bg: "bg-black", text: "text-red-600", border: "border-red-900", selectedBg: "bg-red-900", selectedText: "text-black" };
      case "oled-amber": return { bg: "bg-black", text: "text-amber-500", border: "border-amber-700", selectedBg: "bg-amber-700", selectedText: "text-black" };
      case "oled-green": return { bg: "bg-black", text: "text-green-500", border: "border-green-800", selectedBg: "bg-green-800", selectedText: "text-black" };
      case "oled-cyan": return { bg: "bg-black", text: "text-cyan-400", border: "border-cyan-800", selectedBg: "bg-cyan-800", selectedText: "text-black" };
      case "oled-magenta": return { bg: "bg-black", text: "text-fuchsia-500", border: "border-fuchsia-900", selectedBg: "bg-fuchsia-900", selectedText: "text-black" };
      case "green": return { bg: "from-[#8aff8a] to-[#40b540]", text: "text-[#0a2e0a]", border: "border-[#0a2e0a]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#8aff8a]" };
      case "amber": return { bg: "from-[#ffd085] to-[#db9a35]", text: "text-[#3b2302]", border: "border-[#3b2302]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ffd085]" };
      case "gray": return { bg: "from-[#d4d4d4] to-[#a3a3a3]", text: "text-[#1f1f1f]", border: "border-[#1f1f1f]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#d4d4d4]" };
      case "pink": return { bg: "from-[#ffb3d9] to-[#f472b6]", text: "text-[#4a0d2e]", border: "border-[#4a0d2e]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ffb3d9]" };
      case "purple": return { bg: "from-[#d3b8ff] to-[#a678ec]", text: "text-[#2c0d4d]", border: "border-[#2c0d4d]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#d3b8ff]" };
      case "teal": return { bg: "from-[#8afcf0] to-[#33c9b8]", text: "text-[#04302b]", border: "border-[#04302b]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#8afcf0]" };
      case "white": return { bg: "from-[#ffffff] to-[#d9dde3]", text: "text-[#1a1d22]", border: "border-[#1a1d22]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ffffff]" };
      case "red": return { bg: "from-[#ff9d94] to-[#ef5a4c]", text: "text-[#450e08]", border: "border-[#450e08]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#ff9d94]" };
      default: return { bg: "from-[#8ab4f8] to-[#6fa1ef]", text: "text-[#0d2238]", border: "border-[#0d2238]", selectedBg: "bg-[#0a0a0a]", selectedText: "text-[#8ab4f8]" }; 
    }
  };
  const theme = getLcdStyle();

  const isYouTubeSource = playbackSource === "youtube";
  const unifiedIsPlaying = isPlaying;
  const unifiedTrackName = isYouTubeSource
    ? youtubeCurrentTrack?.title ?? "No Track Selected"
    : currentSong
    ? currentSong.name
    : "No Track Selected";
  const unifiedCurrentTime = currentTime;
  const unifiedDuration = duration;
  const unifiedProgress =
    unifiedDuration > 0
      ? (unifiedCurrentTime / unifiedDuration) * 100
      : 0;

  const coverflowItems: CoverflowItem[] = isYouTubeSource
    ? youtubeQueue.map((track) => ({
        id: track.id,
        name: track.title,
        artworkUrl: track.thumbnail,
      }))
    : localSongs.map((s) => ({
        id: s.name,
        name: s.name,
        artworkUrl: s.artworkUrl,
      }));

  const coverflowActiveIndex = isYouTubeSource
    ? youtubeQueueIndex
    : currentIndex;

  return (
    <div className="fixed inset-0 w-screen h-[100dvh] bg-[#1c1c1e] text-gray-200 font-sans flex flex-col overflow-hidden select-none touch-none z-50 pt-12 pb-4">
      
      {/* --- Secret Developer Diagnostics HUD --- */}
      {showDiag && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/90 border border-green-500 text-green-400 text-[10px] p-3 rounded-lg z-[100] font-mono shadow-[0_0_20px_rgba(0,255,0,0.2)] w-3/4 max-w-xs">
          <p className="font-bold border-b border-green-500/50 pb-1 mb-2 text-center uppercase tracking-widest">Diagnostics</p>
          <p>RAM Usage: {typeof performance !== "undefined" && (performance as any).memory ? `${Math.round((performance as any).memory.usedJSHeapSize / 1048576)} MB` : 'N/A'}</p>
          <p>Audio Context: {audioCtxRef.current?.state || 'UNINITIALIZED'}</p>
          <p>Engine Source: {playbackSource.toUpperCase()}</p>
          <button onClick={() => setShowDiag(false)} className="mt-3 w-full py-2 bg-green-500/20 hover:bg-green-500/40 rounded transition-colors text-white font-bold tracking-widest">CLOSE</button>
        </div>
      )}

      {/* --- Beautiful Scrollable Guide --- */}
      {showOnboarding && (
        <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
          <div className="bg-[#27272a] border border-[#3f3f46] p-6 rounded-3xl max-w-sm w-full shadow-2xl flex flex-col max-h-[85vh]">
            <h2 className="text-xl font-bold text-white mb-4 uppercase tracking-widest text-center border-b border-gray-600 pb-3">RetroPod Manual</h2>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-6 text-left text-sm text-gray-300 custom-scrollbar pb-4">
              
              <section>
                <h3 className="text-blue-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🧭</span> Navigation</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Trackpad:</b> Drag in circles to scroll through menus and lists.</li>
                  <li>• <b>Center Button:</b> Click to select items or toggle Play/Pause.</li>
                  <li>• <b>Menu Button:</b> Click to go back to the previous screen.</li>
                  <li>• <b>Direct Touch:</b> You can tap menu items directly on the screen!</li>
                </ul>
              </section>

              <section>
                <h3 className="text-green-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🎵</span> Playback & Speed</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Inner Ring:</b> On the 'Now Playing' screen, drag in circles to smoothly stretch track tempo (0.5x to 2.0x).</li>
                  <li>• <b>Double-Tap Inner:</b> Instantly reset playback speed to normal (1.0x).</li>
                </ul>
              </section>

              <section>
                <h3 className="text-amber-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🎛️</span> 5-Band Equalizer</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Access:</b> Go to Main Menu &gt; Playback Tools &gt; 5-Band Equalizer.</li>
                  <li>• <b>Select Band:</b> Scroll the trackpad to highlight a frequency band.</li>
                  <li>• <b>Adjust Gain:</b> Click the Center Button to "unlock" the band, then scroll the trackpad to adjust the gain (+12dB to -12dB). Click Center again to lock it in.</li>
                  <li>• <b>Direct Touch:</b> Tap a band on-screen to select/unlock it. Tap it <i>again</i> to instantly reset its gain to 0.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-fuchsia-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🛠️</span> Secret Diagnostics</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Trigger:</b> Rapidly drag the wheel <i>backwards</i> 5 full rotations to reveal the developer HUD.</li>
                </ul>
              </section>

            </div>
            
            <div className="pt-4 border-t border-gray-600 mt-2">
              <button 
                onClick={() => {
                  setShowOnboarding(false);
                  localStorage.setItem("retro_onboarded", "true");
                }}
                className="w-full py-3 bg-white text-black hover:bg-gray-200 font-bold rounded-xl text-xs uppercase tracking-widest shadow-lg transition-colors cursor-pointer"
              >
                Start Listening
              </button>
            </div>
          </div>
        </div>
      )}

      {showYouTubeModal && (
        <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div
            className={`bg-gradient-to-b ${theme.bg} ${theme.text} p-6 rounded-2xl max-w-lg w-full shadow-2xl border-2 ${theme.border} max-h-[80vh] flex flex-col`}
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest">
                YouTube Guest
              </h2>

              <button
                onClick={() => setShowYouTubeModal(false)}
                className="text-xs font-bold opacity-70 hover:opacity-100"
              >
                CLOSE
              </button>
            </div>

            <p className="text-[11px] font-semibold mb-4 leading-relaxed opacity-80">
              Search YouTube and play audio directly through RetroPod.
              No YouTube account is required for Guest mode.
            </p>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={youtubeSearchInput}
                onChange={(e) => setYouTubeSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleYouTubeSearch(youtubeSearchInput);
                  }
                }}
                placeholder="Search YouTube..."
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/10 border border-current/30 text-current placeholder:text-current/50 text-xs font-bold outline-none"
                autoFocus
              />

              <button
                onClick={() => handleYouTubeSearch(youtubeSearchInput)}
                disabled={youtubeSearchLoading}
                className="px-4 py-2 bg-black text-white font-bold rounded-lg text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {youtubeSearchLoading ? "..." : "Search"}
              </button>
            </div>

            {youtubeError && (
              <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-[11px] font-bold text-red-300">
                {youtubeError}
              </div>
            )}

            <div className="overflow-y-auto flex-1 min-h-0 space-y-1">
              {youtubeSearchResults.map((track) => (
                <button
                  key={track.id}
                  onClick={() => {
                    setShowYouTubeModal(false);
                    playYouTubeTrack(track);
                  }}
                  className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-black/10 transition-colors"
                >
                  {track.thumbnail ? (
                    <img
                      src={track.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-black/20 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate">
                      {track.title}
                    </div>
                    <div className="text-[10px] font-semibold opacity-60 truncate">
                      {track.artist}
                    </div>
                  </div>

                  <Play size={13} className="shrink-0" />
                </button>
              ))}

              {!youtubeSearchLoading &&
                youtubeSearchResults.length === 0 && (
                  <div className="py-8 text-center text-[11px] font-bold opacity-50">
                    Search for a song to get started.
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" multiple onChange={handleFileUpload} />

      <div className="w-full h-[42%] p-4 pb-2 flex flex-col">
        <div className="w-full h-full bg-[#27272a] rounded-[2rem] p-3 shadow-[0_20px_40px_rgba(0,0,0,0.5),inset_0_1px_2px_rgba(255,255,255,0.1)] border border-[#3f3f46] flex flex-col relative">
          
          <div className={`w-full h-full bg-gradient-to-b ${theme.bg} rounded-xl relative overflow-hidden shadow-[inset_0_4px_15px_rgba(0,0,0,0.5)] border border-[#1a1a1a] flex flex-col p-4 ${theme.text}`}>

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
              <span>{screen === "nowPlaying" ? "Now Playing" : screen === "eq" ? "Equalizer" : currentMenu.title}</span>
              
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
              <div className="flex-1 overflow-y-auto flex flex-col justify-start pt-1 no-scrollbar relative z-10">
                <ul className="space-y-1">
                  {currentMenu.items.map((item, index) => (
                    <li 
                      key={index}
                      id={`menu-item-${index}`} 
                      onClick={() => {
                        setSelectedIndex(index);
                        setTimeout(() => handleCenterClick(), 50);
                      }}
                      className={`px-3 py-2.5 rounded transition-none text-sm md:text-base font-bold tracking-wide flex justify-between items-center cursor-pointer ${
                        selectedIndex === index ? `${theme.selectedBg} ${theme.selectedText}` : ""
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.type === "menu" && <span>&gt;</span>}
                    </li>
                  ))}
                </ul>
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
                          triggerHaptic("tick", hapticsOn);
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
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center relative z-10 overflow-hidden">
                <div className="relative w-full flex items-center justify-center h-24 mb-2">
                  <AlbumCoverflow
                    items={coverflowItems}
                    activeIndex={coverflowActiveIndex}
                    isPlaying={unifiedIsPlaying}
                  />
                </div>

                <p className="font-bold text-base md:text-lg tracking-wide text-center leading-tight truncate w-full px-4">
                  {unifiedTrackName}
                </p>
                
              <div className="w-full mt-4 flex items-center gap-3 px-2">
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
    tabIndex={0}
    onPointerDown={(e) => {
      e.stopPropagation();

      if (!audioRef.current || unifiedDuration <= 0) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );

      const nextTime = ratio * unifiedDuration;

      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
      setProgress(ratio * 100);

      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={(e) => {
      e.stopPropagation();

      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      if (!audioRef.current || unifiedDuration <= 0) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );

      const nextTime = ratio * unifiedDuration;

      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
      setProgress(ratio * 100);
    }}
    onPointerUp={(e) => {
      e.stopPropagation();

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }}
    onPointerCancel={(e) => {
      e.stopPropagation();

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }}
  >
    <div className="w-full h-[4px] rounded-sm overflow-visible relative bg-current opacity-20">
      <div
        className="absolute top-0 left-0 h-full bg-current opacity-100"
        style={{
          width: `${Math.min(100, Math.max(0, unifiedProgress))}%`,
        }}
      />

      <div
        className="absolute top-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-current"
        style={{
          left: `calc(${Math.min(
            100,
            Math.max(0, unifiedProgress)
          )}% - 5px)`,
        }}
      />
    </div>
  </div>

  <span className="text-[10px] font-bold tracking-wider">
    -{formatTime(Math.max(0, unifiedDuration - unifiedCurrentTime))}
  </span>
</div>

                <div className="mt-3 flex gap-6 text-[9px] font-bold tracking-widest uppercase">
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 border-[1.5px] ${theme.border} rounded-sm`}>
                    {isYouTubeSource ? (
                      <span>YouTube</span>
                    ) : (
                      <>
                        <RefreshCw size={10} strokeWidth={3} />
                        <span>{playbackSpeed}x</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full flex items-center justify-center p-4">
        <div 
          ref={padRef}
          onPointerDown={(e) => handleStart(e.clientX, e.clientY)}
          onPointerMove={(e) => handleMove(e.clientX, e.clientY)}
          onPointerUp={handleEnd}
          onPointerCancel={handleEnd}
          onTouchStart={(e) => {
            if (e.touches && e.touches[0]) {
              handleStart(e.touches[0].clientX, e.touches[0].clientY);
            }
          }}
          onTouchMove={(e) => {
            if (e.touches && e.touches[0]) {
              handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }
          }}
          onTouchEnd={handleEnd}
          className="relative w-[82vw] max-w-[340px] aspect-square rounded-full border border-[#111] bg-[#0a0a0a] flex items-center justify-center cursor-grab active:cursor-grabbing shadow-[0_15px_40px_rgba(0,0,0,0.8),inset_0_1px_2px_rgba(255,255,255,0.05)]"
        >
          <div className="absolute w-[45%] aspect-square rounded-full border-[1.5px] border-black bg-[#111] flex items-center justify-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.9)] pointer-events-none">
            <motion.button 
              whileTap={{ scale: 0.96 }}
              onClick={handleCenterClick}
              className="w-[70%] aspect-square rounded-full bg-[#18181a] border border-black flex items-center justify-center cursor-pointer pointer-events-auto shadow-[0_5px_15px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all group"
            >
              {screen === "nowPlaying" ? (
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
            className="absolute bottom-[8%] text-gray-600 hover:text-white cursor-pointer pointer-events-auto z-20 transition-colors p-2"
          >
            {unifiedIsPlaying ? <Pause size={18}/> : <Play size={18} className="inline"/>}
          </button>

          <button onClick={handlePrevSong} className="absolute left-[7%] text-gray-600 hover:text-white cursor-pointer pointer-events-auto z-20 p-3">
            <SkipBack size={18}/>
          </button>
          <button onClick={handleNextSong} className="absolute right-[7%] text-gray-600 hover:text-white cursor-pointer pointer-events-auto z-20 p-3">
            <SkipForward size={18}/>
          </button>
        </div>
      </div>
    </div>
  );
}