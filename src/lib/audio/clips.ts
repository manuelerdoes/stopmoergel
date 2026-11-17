import type { AudioClip } from '../types';

export const MIN_CLIP_SECONDS = 0.1;
const EPS = 1e-9;

/** End position in (fractional) frames. */
export function clipEndFrame(clip: AudioClip, fps: number): number {
  return clip.startFrame + clip.duration * fps;
}

/** Start time in seconds. */
export function clipStartSeconds(clip: AudioClip, fps: number): number {
  return clip.startFrame / fps;
}

/** Move to a new start frame (rounded, clamped >= 0). */
export function moveClip(clip: AudioClip, startFrame: number): AudioClip {
  return { ...clip, startFrame: Math.max(0, Math.round(startFrame)) };
}

/**
 * Cut away `deltaFrames` whole frames from the start (negative = extend back into the sound).
 * Keeps the clip end where it was in time.
 */
export function trimClipStart(clip: AudioClip, deltaFrames: number, fps: number): AudioClip {
  let n = Math.round(deltaFrames);
  if (n > 0) {
    // duration - n/fps >= MIN
    const maxN = Math.floor((clip.duration - MIN_CLIP_SECONDS) * fps + EPS);
    n = Math.min(n, Math.max(0, maxN));
  } else if (n < 0) {
    // offset + n/fps >= 0 and startFrame + n >= 0
    const maxBack = Math.floor(clip.offset * fps + EPS);
    n = -Math.min(-n, Math.max(0, maxBack), clip.startFrame);
  }
  if (n === 0) return { ...clip };
  const dt = n / fps;
  return {
    ...clip,
    startFrame: clip.startFrame + n,
    offset: Math.max(0, clip.offset + dt),
    duration: clip.duration - dt,
  };
}

/** Set a new duration (seconds), clamped to [MIN_CLIP_SECONDS, soundDuration - offset]. */
export function trimClipEnd(clip: AudioClip, duration: number, soundDuration: number): AudioClip {
  const max = Math.max(MIN_CLIP_SECONDS, soundDuration - clip.offset);
  return { ...clip, duration: Math.min(max, Math.max(MIN_CLIP_SECONDS, duration)) };
}

/** Split at a frame position. Null unless both parts are >= MIN_CLIP_SECONDS. */
export function splitClip(
  clip: AudioClip,
  atFrame: number,
  fps: number,
  newId: string,
): [AudioClip, AudioClip] | null {
  const leftDur = (atFrame - clip.startFrame) / fps;
  const rightDur = clip.duration - leftDur;
  if (leftDur < MIN_CLIP_SECONDS - EPS || rightDur < MIN_CLIP_SECONDS - EPS) return null;
  return [
    { ...clip, duration: leftDur },
    { ...clip, id: newId, startFrame: atFrame, offset: clip.offset + leftDur, duration: rightDur },
  ];
}

/** Greedy lane assignment so overlapping clips get different rows. */
export function assignLanes(
  clips: AudioClip[],
  fps: number,
): { lanes: Map<string, number>; laneCount: number } {
  const sorted = [...clips].sort(
    (a, b) => a.startFrame - b.startFrame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const clip of sorted) {
    let lane = laneEnds.findIndex((end) => end <= clip.startFrame + EPS);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = clipEndFrame(clip, fps);
    lanes.set(clip.id, lane);
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

/** Middle frame of a clip (floored). */
export function clipMiddleFrame(clip: AudioClip, fps: number): number {
  return Math.floor(clip.startFrame + (clip.duration * fps) / 2);
}
