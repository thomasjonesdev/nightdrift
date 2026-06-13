import type { SceneSummary } from "./scenes";

export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
}

function supported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function bindMediaSession(handlers: MediaSessionHandlers): () => void {
  if (!supported()) return () => {};

  navigator.mediaSession.setActionHandler("play", () => handlers.onPlay());
  navigator.mediaSession.setActionHandler("pause", () => handlers.onPause());
  navigator.mediaSession.setActionHandler("stop", () => handlers.onPause());

  return () => {
    navigator.mediaSession.setActionHandler("play", null);
    navigator.mediaSession.setActionHandler("pause", null);
    navigator.mediaSession.setActionHandler("stop", null);
  };
}

export function updateMediaSession(scene: SceneSummary | null): void {
  if (!supported()) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: scene?.name ?? "nightdrift",
    artist: "nightdrift",
    album: scene
      ? `${scene.band} · ${scene.keyName} · ${scene.bpm} bpm`
      : "programmatic lofi for sleep",
  });
  navigator.mediaSession.playbackState = "playing";
}

export function clearMediaSession(): void {
  if (!supported()) return;
  navigator.mediaSession.playbackState = "none";
  navigator.mediaSession.metadata = null;
}
