// Mixdown of the audio track for the video export: all clips -> one AudioBuffer
// exactly as long as the movie, rendered faster than real time with an OfflineAudioContext.

import type { AudioClip } from '../types';

/** Default output sample rate (what AAC/Opus encoders like best). */
export const MIX_SAMPLE_RATE = 48000;

/** Minimal shape shared by OfflineAudioContext and the old prefixed webkitOfflineAudioContext. */
type OfflineCtxCtor = new (numberOfChannels: number, length: number, sampleRate: number) => OfflineAudioContext;

function getOfflineAudioContext(): OfflineCtxCtor | null {
  const w = globalThis as unknown as {
    OfflineAudioContext?: OfflineCtxCtor;
    webkitOfflineAudioContext?: OfflineCtxCtor;
  };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

interface ScheduledClip {
  buffer: AudioBuffer;
  /** Seconds in the movie. */
  when: number;
  /** Seconds into the sound. */
  offset: number;
  /** Seconds to play (already cut to the movie end and the sound end). */
  duration: number;
}

/** Works out which part of each clip is audible within [0, totalSeconds). Pure. */
function scheduleClips(
  clips: AudioClip[],
  buffers: ReadonlyMap<string, AudioBuffer>,
  fps: number,
  totalSeconds: number,
): ScheduledClip[] {
  const out: ScheduledClip[] = [];
  for (const clip of clips) {
    const buffer = buffers.get(clip.soundId);
    if (!buffer) continue;
    const when = Math.max(0, clip.startFrame) / fps;
    if (!(when < totalSeconds)) continue;
    const offset = Math.min(Math.max(0, clip.offset || 0), buffer.duration);
    const duration = Math.min(clip.duration, buffer.duration - offset, totalSeconds - when);
    if (!(duration > 0)) continue;
    out.push({ buffer, when, offset, duration });
  }
  return out;
}

/**
 * Renders all clips into one buffer exactly `totalSeconds` long (the movie length) using OfflineAudioContext.
 * Clip i starts at clip.startFrame / fps seconds, plays `duration` s of its sound from `offset`. Parts past totalSeconds are cut.
 * Returns null if there are no clips that are audible within the movie or a sound buffer is missing for all of them.
 * Output: stereo (2 ch, same signal) at `sampleRate` (default 48000). Apply a gentle limiter (DynamicsCompressorNode) so overlapping clips don't clip.
 */
export async function renderMix(
  clips: AudioClip[],
  buffers: ReadonlyMap<string, AudioBuffer>,
  fps: number,
  totalSeconds: number,
  sampleRate: number = MIX_SAMPLE_RATE,
): Promise<AudioBuffer | null> {
  if (!(totalSeconds > 0) || !(fps > 0)) return null;
  const scheduled = scheduleClips(clips, buffers, fps, totalSeconds);
  if (scheduled.length === 0) return null;

  const Ctor = getOfflineAudioContext();
  if (!Ctor) throw new Error('Web Audio (OfflineAudioContext) is not available.');

  const length = Math.max(1, Math.round(totalSeconds * sampleRate));
  // Positional constructor args: the only form the old webkit-prefixed version accepts.
  const ctx = new Ctor(2, length, sampleRate);

  // Sum everything to mono first (explicit 1-channel node downmixes stereo sources),
  // so both output channels end up carrying the same signal: the destination
  // upmixes mono to L = R.
  const bus = ctx.createGain();
  bus.channelCount = 1;
  bus.channelCountMode = 'explicit';
  bus.channelInterpretation = 'speakers';

  // Gentle limiter: transparent for a single normal clip, tames peaks where clips
  // overlap. Note: browsers add a little automatic makeup gain and ~6 ms lookahead
  // delay — both irrelevant at stop motion frame rates.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  bus.connect(limiter);
  limiter.connect(ctx.destination);

  for (const s of scheduled) {
    const node = ctx.createBufferSource();
    node.buffer = s.buffer; // AudioBuffers are context-independent; resampled if rates differ
    node.connect(bus);
    node.start(s.when, s.offset, s.duration);
  }

  // Old WebKit's startRendering() returns undefined and only fires `oncomplete`.
  return new Promise<AudioBuffer>((resolve, reject) => {
    ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    try {
      const p = ctx.startRendering() as Promise<AudioBuffer> | undefined;
      p?.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}
