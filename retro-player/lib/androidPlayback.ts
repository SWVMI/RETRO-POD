import { registerPlugin } from "@capacitor/core";

interface AndroidPlaybackPlugin {
  setPlaybackActive(options: { active: boolean }): Promise<void>;
  setOrientation(options: { orientation: "portrait" | "landscape" }): Promise<void>;
}

export const AndroidPlayback = registerPlugin<AndroidPlaybackPlugin>("AndroidPlayback");
