"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Play, Pause, SkipForward, SkipBack, RefreshCw, Volume2, SlidersHorizontal, Heart, ListPlus, X } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import AlbumCoverflow, { CoverflowItem } from "@/components/AlbumCoverflow";

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

type SongItem = { file: File; name: string; artworkUrl?: string };
const lcdThemes = [
  "sepia", "blue", "green", "amber", "gray", "pink", "purple", "teal", "white",
  "red", "oled-red", "oled-amber", "oled-green", "oled-cyan", "oled-magenta",
  "cyberpunk", "vaporwave", "midnight", "arctic", "copper", "forest",
  "graphite", "champagne", "burgundy", "rose-gold", "sage", "alpine",
  "ocean-depths", "aurora", "cobalt", "amethyst", "ember", "jade",
  "inverted", "solarized",
] as const;
type LcdTheme = (typeof lcdThemes)[number];
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
};
type Menu = { id: string; title: string; items: MenuItem[] };

export default function MobileBulletproofPlayer() {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState("12:00");
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  // Settings
  const [lcdTheme, setLcdTheme] = useState<LcdTheme>("sepia");
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
  const eqGainsRef = useRef(eqGains);

  // References
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const audioObjectUrlRef = useRef<string | null>(null);
  const playbackRequestRef = useRef(0);
  
  const [localSongs, setLocalSongs] = useState<SongItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const [favoriteSongNames, setFavoriteSongNames] = useState<string[]>([]);
  const [queuedSongNames, setQueuedSongNames] = useState<string[]>([]);
  const [libraryPreferencesLoaded, setLibraryPreferencesLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const repeatModeRef = useRef<"off" | "one" | "all">("all");
  const shuffleOnRef = useRef(false);
  const localSongsRef = useRef<SongItem[]>([]);
  const queuedSongNamesRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);

  useEffect(() => { clock24hRef.current = clock24h; }, [clock24h]);
  useEffect(() => { sleepTimerEndAtRef.current = sleepTimerEndAt; }, [sleepTimerEndAt]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { shuffleOnRef.current = shuffleOn; }, [shuffleOn]);
  useEffect(() => { localSongsRef.current = localSongs; }, [localSongs]);
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
      for await (const [, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          const artworkUrl = await extractArtwork(file);
          loadedSongs.push({ file, name: file.name.replace(/\.[^/.]+$/, ""), artworkUrl });
        }
      }
      
      setLocalSongs(loadedSongs);
      const availableFileNames = new Set(loadedSongs.map((song) => song.file.name));
      setFavoriteSongNames((previous) => previous.filter((name) => availableFileNames.has(name)));
      const validQueue = queuedSongNamesRef.current.filter((name) => availableFileNames.has(name));
      queuedSongNamesRef.current = validQueue;
      setQueuedSongNames(validQueue);
      const lastSongName = localStorage.getItem("retro_last_song_name");
      if (lastSongName) {
        const foundIdx = loadedSongs.findIndex(s => s.name === lastSongName);
        if (foundIdx !== -1) {
          setCurrentSong(loadedSongs[foundIdx]);
          setCurrentIndex(foundIdx);
          if (audioRef.current) {
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
    }
  };

  const saveSongsToStorage = async (files: File[]) => {
    try {
      const root = await navigator.storage.getDirectory() as DirectoryHandleWithIteration;
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
      const root = await navigator.storage.getDirectory() as DirectoryHandleWithIteration;
      for await (const name of root.keys()) {
        await root.removeEntry(name).catch(() => {});
      }
    } catch (e) {
      console.log("Storage error", e);
    }
    releaseAudioSource();
    setLocalSongs([]);
    setFavoriteSongNames([]);
    queuedSongNamesRef.current = [];
    setQueuedSongNames([]);
    setIsPlaying(false);
    setCurrentSong(null);
    setCurrentIndex(0);
    setScreen("menu");
  };

  const removeSpecificSong = async (fileName: string) => {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(fileName);
    } catch (e) {
      console.log("Could not remove file", e);
    }
    setLocalSongs(prev => prev.filter(s => s.file.name !== fileName));
    setFavoriteSongNames((previous) => previous.filter((name) => name !== fileName));
    setQueuedSongNames((previous) => {
      const next = previous.filter((name) => name !== fileName);
      queuedSongNamesRef.current = next;
      return next;
    });
    if (currentSong?.file.name === fileName) {
      releaseAudioSource();
      setIsPlaying(false);
      setCurrentSong(null);
      setScreen("menu");
    } else if (currentSong) {
      const nextIndex = localSongs
        .filter((song) => song.file.name !== fileName)
        .findIndex((song) => song.file.name === currentSong.file.name);
      if (nextIndex >= 0) setCurrentIndex(nextIndex);
    }
  };

  const playSong = (song: SongItem, index: number) => {
    if (sourceNodeRef.current || eqGainsRef.current.some((gain) => gain !== 0)) {
      ensureAudioGraph();
      wakeUpAudioCtx();
    }

    const audio = audioRef.current;
    setCurrentSong(song);
    setCurrentIndex(index);
    setScreen("nowPlaying");
    const requestId = ++playbackRequestRef.current;
    if (queuedSongNamesRef.current.includes(song.file.name)) {
      const nextQueue = queuedSongNamesRef.current.filter((name) => name !== song.file.name);
      queuedSongNamesRef.current = nextQueue;
      setQueuedSongNames(nextQueue);
    }

    if (audio) {
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

  const removeQueuedSong = (fileName: string) => {
    setQueuedSongNames((previous) => {
      const next = previous.filter((name) => name !== fileName);
      queuedSongNamesRef.current = next;
      return next;
    });
  };

  const playNextQueuedSong = () => {
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
    playSong(songs[songIndex], songIndex);
    return true;
  };

  const handleNextSong = () => {
    if (playNextQueuedSong()) return;
    if (localSongs.length === 0) return;
    const nextIdx = shuffleOn ? pickRandomIndex(localSongs.length, currentIndex) : (currentIndex + 1) % localSongs.length;
    playSong(localSongs[nextIdx], nextIdx);
  };

  const handlePrevSong = () => {
    if (localSongs.length === 0) return;
    const prevIdx = (currentIndex - 1 + localSongs.length) % localSongs.length;
    playSong(localSongs[prevIdx], prevIdx);
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
        });
      }
      return;
    }

    if (localSongsRef.current.length === 0) return;

    if (playNextQueuedSong()) return;

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

  // --- INITIALIZATION EFFECTS ---
  useEffect(() => {
    const hasSeenOnboard = localStorage.getItem("retro_onboarded");
    if (!hasSeenOnboard) setShowOnboarding(true);

    const savedTheme = localStorage.getItem("retro_theme");
    if (savedTheme && lcdThemes.some((theme) => theme === savedTheme)) {
      setLcdTheme(savedTheme as LcdTheme);
    }
    
    const savedHaptics = localStorage.getItem("retro_haptics");
    if (savedHaptics !== null) setHapticsOn(savedHaptics === "true");
    
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
    } catch (error) {
      console.warn("Unable to restore favorites or queue:", error);
    }
    setLibraryPreferencesLoaded(true);

    const updateClock = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24hRef.current }));

      const endAt = sleepTimerEndAtRef.current;
      if (endAt !== null && Date.now() >= endAt) {
        setIsPlaying(false);
        audioRef.current?.pause();
        setSleepTimerEndAt(null);
      }

      if (audioRef.current && !audioRef.current.paused) {
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
    if (currentSong) {
      localStorage.setItem("retro_last_song_name", currentSong.name);
    }
  }, [currentSong]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }

    if (isPlaying) {
      if (sourceNodeRef.current || eqGainsRef.current.some((gain) => gain !== 0)) {
        latestEnsureAudioGraph.current();
        wakeUpAudioCtx();
      }
      audioRef.current?.play().catch(e => console.log("Playback prevented:", e));
    } else {
      audioRef.current?.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    if (!currentSong) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.name,
      artist: "Local Device Library",
      album: "Retro Custom Player",
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
      audioRef.current.currentTime = Math.max(0, Math.min(details.seekTime, audioRef.current.duration || details.seekTime));
    });
  }, [currentSong, localSongs, currentIndex]);

  const sortedLocalSongs = useMemo(() => {
    if (sortMode === "a-z") return [...localSongs].sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "z-a") return [...localSongs].sort((a, b) => b.name.localeCompare(a.name));
    return localSongs;
  }, [localSongs, sortMode]);

  // --- MENUS & UI LOGIC ---
  const menus = useMemo((): Record<string, Menu> => {
    const favoriteSongs = favoriteSongNames
      .map((name) => localSongs.find((song) => song.file.name === name))
      .filter((song): song is SongItem => song !== undefined);
    const queuedSongs = queuedSongNames
      .map((name) => localSongs.find((song) => song.file.name === name))
      .filter((song): song is SongItem => song !== undefined);

    return {
      root: {
        id: "root",
        title: "Main Menu",
        items: [
          ...(currentSong ? [{ label: "Now Playing", type: "action" as const, actionId: "go_now_playing" }] : []),
          { label: "Local Audio Library", type: "menu", targetId: "local" },
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
          { label: `Favorites (${favoriteSongNames.length})`, type: "menu", targetId: "favorites" },
          { label: `Play Queue (${queuedSongNames.length})`, type: "menu", targetId: "queue" },
          { label: "[ Import New Songs ]", type: "action", actionId: "scan_local" },
          ...(queuedSongNames.length > 0
            ? [{ label: "[ Clear Play Queue ]", type: "action" as const, actionId: "clear_queue" }]
            : []),
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
          { label: "Midnight", type: "action", actionId: "theme_midnight" },
          { label: "Arctic", type: "action", actionId: "theme_arctic" },
          { label: "Copper", type: "action", actionId: "theme_copper" },
          { label: "Forest", type: "action", actionId: "theme_forest" },
          { label: "Graphite", type: "action", actionId: "theme_graphite" },
          { label: "Champagne", type: "action", actionId: "theme_champagne" },
          { label: "Burgundy", type: "action", actionId: "theme_burgundy" },
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
          { label: "Solarized", type: "action", actionId: "theme_solarized" }
        ]
      }
    };
  }, [
    currentSong,
    sortedLocalSongs,
    localSongs,
    favoriteSongNames,
    queuedSongNames,
    sortMode,
    hapticsOn,
    shuffleOn,
    repeatMode,
    clock24h,
    sleepTimerEndAt,
  ]);

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
      wakeUpAudioCtx();
      if (currentSong) {
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
      if (currentSong?.file === selectedItem.song.file) {
        setScreen("nowPlaying");
      } else {
        const songIdx = localSongs.findIndex(s => s.file === selectedItem.song?.file);
        playSong(selectedItem.song, songIdx >= 0 ? songIdx : 0);
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
            if (typeof window !== "undefined" && window.confirm(`Remove ${fileName} from device?`)) {
              removeSpecificSong(fileName);
            }
          }
      }
    }
  };

  const handleGlobalPlayPause = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    wakeUpAudioCtx();

    if (currentSong) {
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
      case "arctic": return { bg: "from-[#e0f7fa] to-[#80deea]", text: "text-[#064663]", border: "border-[#064663]", selectedBg: "bg-[#064663]", selectedText: "text-[#e0f7fa]" };
      case "copper": return { bg: "from-[#f4d3b2] to-[#b87333]", text: "text-[#3d2111]", border: "border-[#3d2111]", selectedBg: "bg-[#3d2111]", selectedText: "text-[#f4d3b2]" };
      case "forest": return { bg: "from-[#b7d7a8] to-[#52734d]", text: "text-[#152b1c]", border: "border-[#152b1c]", selectedBg: "bg-[#152b1c]", selectedText: "text-[#b7d7a8]" };
      case "graphite": return { bg: "from-[#43464b] to-[#17191d]", text: "text-[#f0f1f2]", border: "border-[#aeb4bd]", selectedBg: "bg-[#d7dbe0]", selectedText: "text-[#202328]" };
      case "champagne": return { bg: "from-[#fff2d8] to-[#d5b98c]", text: "text-[#4a3824]", border: "border-[#806443]", selectedBg: "bg-[#806443]", selectedText: "text-[#fff2d8]" };
      case "burgundy": return { bg: "from-[#641e35] to-[#260d1a]", text: "text-[#ffe8e7]", border: "border-[#e7a6a6]", selectedBg: "bg-[#e7a6a6]", selectedText: "text-[#34101d]" };
      case "rose-gold": return { bg: "from-[#f5d5ca] to-[#bd8177]", text: "text-[#482b2b]", border: "border-[#704347]", selectedBg: "bg-[#704347]", selectedText: "text-[#fce8df]" };
      case "sage": return { bg: "from-[#e3eadb] to-[#a8b89d]", text: "text-[#344235]", border: "border-[#526452]", selectedBg: "bg-[#526452]", selectedText: "text-[#eef2e8]" };
      case "alpine": return { bg: "from-[#f3f6f2] to-[#a8c0bd]", text: "text-[#263c42]", border: "border-[#45656b]", selectedBg: "bg-[#45656b]", selectedText: "text-[#f3f6f2]" };
      case "ocean-depths": return { bg: "from-[#164e63] to-[#082f49]", text: "text-[#d7f3f4]", border: "border-[#67c8c4]", selectedBg: "bg-[#67c8c4]", selectedText: "text-[#073747]" };
      case "aurora": return { bg: "from-[#153a45] to-[#30254f]", text: "text-[#d5fff1]", border: "border-[#8ee8c2]", selectedBg: "bg-[#8ee8c2]", selectedText: "text-[#17353e]" };
      case "cobalt": return { bg: "from-[#244b9b] to-[#122454]", text: "text-[#e8efff]", border: "border-[#91b5ff]", selectedBg: "bg-[#91b5ff]", selectedText: "text-[#13244b]" };
      case "amethyst": return { bg: "from-[#49346f] to-[#211b3d]", text: "text-[#f0e8ff]", border: "border-[#c5a8f5]", selectedBg: "bg-[#c5a8f5]", selectedText: "text-[#2d2148]" };
      case "ember": return { bg: "from-[#5c3027] to-[#241918]", text: "text-[#ffe7d4]", border: "border-[#f2a66d]", selectedBg: "bg-[#f2a66d]", selectedText: "text-[#3c211b]" };
      case "jade": return { bg: "from-[#d7eee3] to-[#75b6a0]", text: "text-[#153c35]", border: "border-[#286557]", selectedBg: "bg-[#286557]", selectedText: "text-[#e0f5ea]" };
      case "inverted": return { bg: "from-[#f5f5f5] to-[#d6d6d6]", text: "text-[#121212]", border: "border-[#121212]", selectedBg: "bg-[#121212]", selectedText: "text-[#f5f5f5]" };
      case "solarized": return { bg: "from-[#fdf6e3] to-[#eee8d5]", text: "text-[#586e75]", border: "border-[#657b83]", selectedBg: "bg-[#268bd2]", selectedText: "text-[#fdf6e3]" };
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

  const unifiedIsPlaying = isPlaying;
  const unifiedTrackName = currentSong?.name ?? "No Track Selected";
  const unifiedCurrentTime = currentTime;
  const unifiedDuration = duration;
  const unifiedProgress = unifiedDuration > 0
    ? (unifiedCurrentTime / unifiedDuration) * 100
    : 0;

  const coverflowItems: CoverflowItem[] = localSongs.map((song) => ({
    id: song.name,
    name: song.name,
    artworkUrl: song.artworkUrl,
  }));

  const coverflowActiveIndex = currentIndex;
  const memoryUsageBytes = typeof performance !== "undefined"
    ? (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    : undefined;

  return (
<div className="fixed inset-0 w-screen h-[100dvh] bg-[#1c1c1e] text-gray-200 font-sans flex flex-col overflow-hidden select-none touch-none z-50 pt-0 pb-0">      {/* --- Secret Developer Diagnostics HUD --- */}
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
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-6 text-left text-sm text-gray-300 custom-scrollbar pb-4">
              
              <section>
                <h3 className="text-blue-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🧭</span> Navigation</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Trackpad:</b> Drag in circles to scroll through menus and lists.</li>
                  <li>• <b>Center Button:</b> Click to select items or toggle Play/Pause.</li>
                  <li>• <b>Menu Button:</b> Click to go back to the previous screen.</li>
                  <li>• <b>Direct Touch:</b> You can tap menu items directly on the screen!</li>
                  <li>• <b>Library:</b> Use the heart to save favorites and the list-plus button to queue a song. Queued songs play next.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-green-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🎵</span> Playback & Speed</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Inner Ring:</b> On the &apos;Now Playing&apos; screen, drag in circles to smoothly stretch track tempo (0.5x to 2.0x).</li>
                  <li>• <b>Double-Tap Inner:</b> Instantly reset playback speed to normal (1.0x).</li>
                </ul>
              </section>

              <section>
                <h3 className="text-amber-400 font-bold mb-2 uppercase tracking-wider text-xs flex items-center gap-2"><span className="text-base">🎛️</span> 5-Band Equalizer</h3>
                <ul className="space-y-2 text-xs leading-relaxed">
                  <li>• <b>Access:</b> Go to Main Menu &gt; Playback Tools &gt; 5-Band Equalizer.</li>
                  <li>• <b>Select Band:</b> Scroll the trackpad to highlight a frequency band.</li>
                  <li>• <b>Adjust Gain:</b> Click the Center Button to &quot;unlock&quot; the band, then scroll the trackpad to adjust the gain (+12dB to -12dB). Click Center again to lock it in.</li>
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
                      <span className="truncate min-w-0">{item.label}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.type === "song" && item.song && (
                          <>
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
                            {currentMenuId === "queue" ? (
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
                            ) : (
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
                            )}
                          </>
                        )}
                        {item.type === "menu" && <span>&gt;</span>}
                      </div>
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
    aria-valuetext={`${formatTime(unifiedCurrentTime)} of ${formatTime(unifiedDuration)}`}
    tabIndex={0}
    onKeyDown={(event) => {
      if (!audioRef.current || unifiedDuration <= 0) return;
      const seekStep = event.shiftKey ? 30 : 5;
      const targetTime = event.key === "ArrowRight"
        ? Math.min(unifiedDuration, audioRef.current.currentTime + seekStep)
        : event.key === "ArrowLeft"
        ? Math.max(0, audioRef.current.currentTime - seekStep)
        : event.key === "Home"
        ? 0
        : event.key === "End"
        ? unifiedDuration
        : null;
      if (targetTime === null) return;
      event.preventDefault();
      event.stopPropagation();
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }}
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
                    <RefreshCw size={10} strokeWidth={3} />
                    <span>{playbackSpeed}x</span>
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