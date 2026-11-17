// Microphone recording as raw PCM -> mono 16-bit WAV, plus audio file import -> mono WAV.
// Why raw PCM and not MediaRecorder: see docs/PLAN-audio.md ("Storage: always WAV").

import { decodeAudio, getAudioContext, resumeAudio } from './context';
import { encodeWav, mixToMono } from './wav';

export const MAX_RECORD_SECONDS = 60;
export const MAX_IMPORT_SECONDS = 300;

export interface RecordingResult {
  /** audio/wav, mono */
  blob: Blob;
  /** Seconds. */
  duration: number;
}

export interface MicRecorder {
  /** Begin capturing. Resolves with performance.now() of the first captured sample block (use for sync). */
  start(): Promise<number>;
  /** Stop and return the WAV. */
  stop(): Promise<RecordingResult>;
  /** Stop without result, release mic. */
  cancel(): void;
  /** Current input level 0..1 (smoothed, scaled so normal speech reaches ~0.5–0.8) for a kid-friendly meter. */
  level(): number;
  /** Seconds recorded so far. */
  elapsed(): number;
  /** Called once when MAX_RECORD_SECONDS is reached (recording auto-stops; caller then calls stop() to get the result). */
  onLimit?: () => void;
}

const PROCESSOR_NAME = 'stopmoergel-capture';
/** Samples per message from the worklet (~21 ms at 48 kHz): fine-grained enough for the meter. */
const WORKLET_BATCH = 1024;
/** Buffer size of the ScriptProcessor fallback (power of two, 256..16384). */
const SCRIPT_BUFFER = 2048;
/** start() gives up if the mic delivers nothing for this long (e.g. a context that never resumed). */
const START_TIMEOUT_MS = 3000;

// The worklet runs in the audio thread. It copies channel 0 of its input into batches and posts each
// full batch to the main thread, transferring the buffer (no copy). `frame` is the context frame of
// the batch's first sample (`currentFrame` is the same clock as `ctx.currentTime * sampleRate`), which
// lets the main thread cut the recording exactly at the frame where start() was called.
// The input is already mono: the node uses channelCount 1 / 'explicit', so stereo mics are down-mixed.
const PROCESSOR_SOURCE = `
class StopmoergelCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.buf = new Float32Array(${WORKLET_BATCH});
    this.fill = 0;
    this.bufFrame = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
  }
  process(inputs) {
    if (!this.alive) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        if (this.fill === 0) this.bufFrame = currentFrame + i;
        const n = Math.min(ch.length - i, this.buf.length - this.fill);
        this.buf.set(ch.subarray(i, i + n), this.fill);
        this.fill += n;
        i += n;
        if (this.fill === this.buf.length) {
          this.port.postMessage({ frame: this.bufFrame, samples: this.buf }, [this.buf.buffer]);
          this.buf = new Float32Array(${WORKLET_BATCH});
          this.fill = 0;
        }
      }
    }
    // true keeps the processor running; it only ends after the 'stop' message.
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', StopmoergelCapture);
`;

interface ChunkMessage {
  frame: number;
  samples: Float32Array;
}

// addModule() must only run once per context (registerProcessor throws on a duplicate name).
const workletLoads = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Loads the capture worklet; resolves false when AudioWorklet is unavailable or fails (-> ScriptProcessor). */
function loadWorklet(ctx: AudioContext): Promise<boolean> {
  // audioWorklet is missing in Safari < 14.1 and in insecure contexts (plain http on a LAN IP).
  if (typeof AudioWorkletNode === 'undefined' || !ctx.audioWorklet) return Promise.resolve(false);
  let load = workletLoads.get(ctx);
  if (!load) {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }));
    load = ctx.audioWorklet
      .addModule(url)
      .then(
        () => true,
        () => false,
      )
      .finally(() => URL.revokeObjectURL(url));
    workletLoads.set(ctx, load);
  }
  return load;
}

/** RMS of a block mapped to 0..1 on a dB scale: -55 dBFS -> 0, -10 dBFS -> 1. Speech (with AGC) sits around -30..-18. */
function blockLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(rms + 1e-9);
  return Math.min(1, Math.max(0, (db + 55) / 45));
}

function concat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Opens the microphone (getUserMedia audio: echoCancellation, noiseSuppression, autoGainControl true;
 * channelCount 1). Throws the getUserMedia DOMException (NotAllowedError, NotFoundError...) unchanged
 * so the UI can show friendly messages. The mic stays open until stop()/cancel() — tracks are released then.
 *
 * Call this from a user gesture: it resumes the shared AudioContext synchronously first (iOS).
 * The level meter works right after opening (for a "say something" check); samples are only kept
 * after start().
 */
export async function openMicRecorder(): Promise<MicRecorder> {
  // Everything before the first await still runs inside the caller's user gesture.
  const ctx = getAudioContext();
  const resumed = resumeAudio();
  const workletLoad = loadWorklet(ctx);

  if (!navigator.mediaDevices?.getUserMedia) {
    // No mediaDevices at all: insecure context (http on a LAN IP) or a very old browser.
    throw new DOMException('Microphone access is not available here.', 'NotSupportedError');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    video: false,
  });

  try {
    await resumed;
    const useWorklet = await workletLoad;
    return buildRecorder(ctx, stream, useWorklet);
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    throw err;
  }
}

type State = 'open' | 'recording' | 'limit' | 'closed';

function buildRecorder(ctx: AudioContext, stream: MediaStream, useWorklet: boolean): MicRecorder {
  const sampleRate = ctx.sampleRate;
  const maxSamples = Math.round(MAX_RECORD_SECONDS * sampleRate);

  let state: State = 'open';
  let startFrame = 0;
  const chunks: Float32Array[] = [];
  let kept = 0;
  let smoothLevel = 0;
  let lastChunkAt = 0;
  let pendingStart: { resolve: (t: number) => void; reject: (e: unknown) => void; timer: number } | null = null;

  const source = ctx.createMediaStreamSource(stream);
  // Muted sink: keeps the capture node in the rendered graph (required for ScriptProcessor, harmless
  // for the worklet) without any audible feedback.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);

  let workletNode: AudioWorkletNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;

  const settleStart = (fn: (p: NonNullable<typeof pendingStart>) => void) => {
    if (!pendingStart) return;
    const p = pendingStart;
    pendingStart = null;
    window.clearTimeout(p.timer);
    fn(p);
  };

  const release = () => {
    if (workletNode) {
      workletNode.port.onmessage = null;
      // Lets the processor return false from process() so the audio thread drops it.
      workletNode.port.postMessage('stop');
      workletNode.disconnect();
      workletNode = null;
    }
    if (scriptNode) {
      scriptNode.onaudioprocess = null;
      scriptNode.disconnect();
      scriptNode = null;
    }
    source.disconnect();
    mute.disconnect();
    for (const t of stream.getTracks()) t.stop();
    smoothLevel = 0;
  };

  const onChunk = (frame: number, samples: Float32Array) => {
    const now = performance.now();
    lastChunkAt = now;
    // Fast attack, slower release, so the meter jumps up with the voice and falls back smoothly.
    const target = blockLevel(samples);
    smoothLevel += (target - smoothLevel) * (target > smoothLevel ? 0.6 : 0.15);

    if (state !== 'recording') return;
    // The chunk may begin before the start frame: drop that part.
    const skip = frame < startFrame ? Math.min(samples.length, startFrame - frame) : 0;
    if (skip >= samples.length) return;
    let piece = skip > 0 ? samples.subarray(skip) : samples;
    if (piece.length > maxSamples - kept) piece = piece.subarray(0, maxSamples - kept);

    if (pendingStart) {
      // Map the context frame of the first kept sample to the performance.now() clock.
      // ctx.currentTime is "now" on the audio clock (to within one render/hardware block).
      const firstFrame = frame + skip;
      const t = now - (ctx.currentTime - firstFrame / sampleRate) * 1000;
      settleStart((p) => p.resolve(Math.min(t, now)));
    }

    chunks.push(piece);
    kept += piece.length;
    if (kept >= maxSamples) {
      state = 'limit';
      release(); // never keep the mic open longer than needed
      try {
        recorder.onLimit?.();
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (useWorklet) {
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Force mono input: a stereo mic gets down-mixed (L+R)/2 by the graph.
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    node.port.onmessage = (e: MessageEvent<ChunkMessage>) => onChunk(e.data.frame, e.data.samples);
    workletNode = node;
    source.connect(node);
    node.connect(mute);
  } else {
    // Deprecated, but the only option on old Safari / insecure contexts. Runs on the main thread.
    // ScriptProcessor's input is fixed to 'explicit' with the given channel count (1), so it's mono too.
    const node = ctx.createScriptProcessor(SCRIPT_BUFFER, 1, 1);
    // There is no frame stamp here: anchor the first block on ctx.currentTime once, then count samples
    // so consecutive blocks stay contiguous.
    let nextFrame = -1;
    node.onaudioprocess = (e: AudioProcessingEvent) => {
      // getChannelData returns a view of a buffer the browser reuses: copy it.
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      if (nextFrame < 0) nextFrame = Math.max(0, Math.round(ctx.currentTime * sampleRate) - samples.length);
      const frame = nextFrame;
      nextFrame += samples.length;
      onChunk(frame, samples);
    };
    scriptNode = node;
    source.connect(node);
    node.connect(mute);
  }

  const recorder: MicRecorder = {
    start() {
      if (state !== 'open') return Promise.reject(new Error(`Recorder can't start in state "${state}".`));
      state = 'recording';
      startFrame = Math.round(ctx.currentTime * sampleRate);
      // Just in case the context got suspended/interrupted since opening. Outside a gesture this may
      // not help on iOS — then the timeout below reports it.
      void resumeAudio();
      return new Promise<number>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          settleStart((p) => p.reject(new DOMException('The microphone delivers no sound.', 'NotReadableError')));
        }, START_TIMEOUT_MS);
        pendingStart = { resolve, reject, timer };
      });
    },

    stop() {
      // The last partial worklet batch (< 1024 samples, ~20 ms) isn't flushed — not noticeable.
      if (state !== 'closed') {
        state = 'closed';
        release();
      }
      settleStart((p) => p.reject(new DOMException('Recording was stopped.', 'AbortError')));
      const samples = concat(chunks, kept);
      return Promise.resolve({ blob: encodeWav([samples], sampleRate), duration: samples.length / sampleRate });
    },

    cancel() {
      if (state !== 'closed') {
        state = 'closed';
        release();
      }
      settleStart((p) => p.reject(new DOMException('Recording was cancelled.', 'AbortError')));
      chunks.length = 0;
      kept = 0;
    },

    level() {
      if (state === 'closed' || state === 'limit') return 0;
      // No fresh audio for a while (context suspended, mic muted): don't freeze the meter at a high value.
      if (performance.now() - lastChunkAt > 250) return 0;
      return smoothLevel;
    },

    elapsed() {
      return kept / sampleRate;
    },
  };
  return recorder;
}

/**
 * Decode an audio file (mp3/m4a/wav/ogg...) into a mono WAV at the AudioContext sample rate;
 * truncate to maxSeconds. Throws the decode error (usually an 'EncodingError' DOMException) for
 * files the browser can't read.
 */
export async function audioFileToWav(file: Blob, maxSeconds = MAX_IMPORT_SECONDS): Promise<RecordingResult> {
  const buffer = await decodeAudio(file);
  const mono = mixToMono(buffer);
  const maxSamples = Math.max(0, Math.floor(maxSeconds * buffer.sampleRate));
  const samples = mono.length > maxSamples ? mono.subarray(0, maxSamples) : mono;
  return { blob: encodeWav([samples], buffer.sampleRate), duration: samples.length / buffer.sampleRate };
}
