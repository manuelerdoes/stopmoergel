/** A stop motion movie. `frameIds` is the single source of truth for frame order. */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Playback speed in frames per second (1–24). */
  fps: number;
  frameIds: string[];
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

export const DEFAULT_FPS = 8;
export const MIN_FPS = 1;
export const MAX_FPS = 24;
