import { registerPlugin } from "@capacitor/core";

interface AndroidPlaybackPlugin {
  hasTrack(options: {
    name: string;
    size: number;
    lastModified: number;
  }): Promise<{ exists: boolean }>;
  appendTrackChunk(options: {
    name: string;
    chunk: string;
    first: boolean;
    last: boolean;
    size: number;
    lastModified: number;
    title: string;
    artist: string;
    album: string;
  }): Promise<void>;
  removeTrack(options: { name: string }): Promise<void>;
  setQueue(options: {
    tracks: string;
    index: number;
    repeatStartIndex: number;
    repeatMode: "off" | "one" | "all";
    shuffle: boolean;
    speed: number;
  }): Promise<void>;
  setPlaying(options: { playing: boolean }): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seekTo(options: { position: number }): Promise<void>;
  setPlaybackSpeed(options: { speed: number }): Promise<void>;
  setRepeatMode(options: { repeatMode: "off" | "one" | "all" }): Promise<void>;
  setShuffle(options: { shuffle: boolean }): Promise<void>;
  setEqualizer(options: { gains: string }): Promise<void>;
  setSleepTimer(options: { endAt: number; fade: boolean }): Promise<void>;
  queryState(): Promise<{
    fileName: string;
    title: string;
    artist: string;
    album: string;
    playing: boolean;
    position: number;
    duration: number;
    index: number;
    sleepTimerEndAt: number;
    sleepFadeEnabled: boolean;
  }>;
  setOrientation(options: { orientation: "portrait" | "landscape" }): Promise<void>;
}

export const AndroidPlayback = registerPlugin<AndroidPlaybackPlugin>("AndroidPlayback");
