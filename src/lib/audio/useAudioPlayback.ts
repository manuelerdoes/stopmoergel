import { useCallback, useEffect, useRef } from 'react';
import type { AudioClip } from '../types';
import { getAudioContext } from './context';

interface Options {
  clips: AudioClip[];
  fps: number;
  totalFrames: number;
  getBuffers: () => Map<string, AudioBuffer>;
}

/**
 * Plays the audio track in sync with the picture player. The player calls `syncFrom(index)` whenever its
 * clock (re)starts; we then (re)schedule every clip on the Web Audio clock relative to that picture.
 * Clips are cut off at the movie end, like in the exported video.
 */
export function useAudioPlayback({ clips, fps, totalFrames, getBuffers }: Options) {
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const latest = useRef({ clips, fps, totalFrames, getBuffers });
  latest.current = { clips, fps, totalFrames, getBuffers };

  const stopAll = useCallback(() => {
    for (const s of sources.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    sources.current = [];
  }, []);

  const syncFrom = useCallback(
    (index: number) => {
      stopAll();
      const { clips: list, fps: f, totalFrames: n, getBuffers: buffersOf } = latest.current;
      if (!list.length || !n) return;
      const ctx = getAudioContext();
      const buffers = buffersOf();
      const from = index / f;
      const movieEnd = n / f;
      const now = ctx.currentTime;
      for (const clip of list) {
        const buffer = buffers.get(clip.soundId);
        if (!buffer) continue;
        const start = clip.startFrame / f;
        const end = Math.min(start + clip.duration, movieEnd);
        const playFrom = Math.max(start, from);
        const dur = end - playFrom;
        if (dur <= 0.005) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(now + (playFrom - from), clip.offset + (playFrom - start), dur);
        sources.current.push(src);
      }
    },
    [stopAll],
  );

  useEffect(() => stopAll, [stopAll]);

  return { syncFrom, stopAll };
}
