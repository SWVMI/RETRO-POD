import { Capacitor } from "@capacitor/core";

export type HapticKind = "tick" | "select" | "confirm" | "warn";

let hapticsModulePromise: Promise<typeof import("@capacitor/haptics")> | null = null;
const getHapticsModule = () => {
  if (!hapticsModulePromise) {
    hapticsModulePromise = import("@capacitor/haptics");
  }
  return hapticsModulePromise;
};

let lastTickAt = 0;
const TICK_MIN_INTERVAL_MS = 28;

async function nativeHaptic(kind: HapticKind) {
  const { Haptics, ImpactStyle } = await getHapticsModule();
  switch (kind) {
    case "tick":
      await Haptics.selectionChanged();
      break;
    case "select":
      await Haptics.impact({ style: ImpactStyle.Light });
      break;
    case "confirm":
      await Haptics.impact({ style: ImpactStyle.Medium });
      break;
    case "warn":
      await Haptics.notification();
      break;
  }
}

function webVibrateFallback(kind: HapticKind) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  const pattern = kind === "tick" ? 6 : kind === "select" ? 12 : kind === "confirm" ? 18 : [10, 40, 10];
  try {
    navigator.vibrate(pattern as number | number[]);
  } catch {
  }
}

export function triggerHaptic(kind: HapticKind, enabled: boolean) {
  if (!enabled) return;

  if (kind === "tick") {
    const now = Date.now();
    if (now - lastTickAt < TICK_MIN_INTERVAL_MS) return;
    lastTickAt = now;
  }

  if (Capacitor.isNativePlatform()) {
    nativeHaptic(kind).catch(() => webVibrateFallback(kind));
  } else {
    webVibrateFallback(kind);
  }
}