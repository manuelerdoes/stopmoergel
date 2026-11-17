/** A stop motion movie. `frameIds` is the single source of truth for frame order. */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Playback speed in frames per second (1–24). */
  fps: number;
  frameIds: string[];
  /** Sound clips on the audio track. Older stored projects may lack it; db.ts normalizes to []. */
  audioClips: AudioClip[];
}

/** A single captured picture. Stored separately from the project so blobs load lazily. */
export interface Frame {
  id: string;
  projectId: string;
  /** JPEG image. */
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

/** A piece of recorded or imported audio (mono 16-bit WAV). Stored separately like frames. */
export interface Sound {
  id: string;
  projectId: string;
  /** audio/wav */
  blob: Blob;
  /** Length in seconds. */
  duration: number;
  createdAt: number;
  /** Where it came from: affects the clip color. */
  kind: 'recording' | 'music';
}

/**
 * A clip on the audio track. Non-destructive: it plays `duration` seconds of `soundId`,
 * starting `offset` seconds into the sound, beginning at picture `startFrame` of the movie.
 */
export interface AudioClip {
  id: string;
  soundId: string;
  /** Frame index (integer ≥ 0) where the clip starts — anchored to pictures, not seconds. */
  startFrame: number;
  /** Seconds into the sound. */
  offset: number;
  /** Seconds. */
  duration: number;
}

export const DEFAULT_FPS = 8;
export const MIN_FPS = 1;
export const MAX_FPS = 24;
