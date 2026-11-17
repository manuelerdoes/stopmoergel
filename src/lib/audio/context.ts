// One shared AudioContext for the whole app (playback, mic recording, decoding).
// Browsers limit the number of live contexts (iOS especially), and nodes from different contexts
// can't be connected, so everything goes through getAudioContext().

type AudioCtxCtor = new (options?: AudioContextOptions) => AudioContext;

let shared: AudioContext | null = null;

function getAudioContextCtor(): AudioCtxCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  // webkitAudioContext: Safari < 14.1.
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** One shared AudioContext for playback, recording and decoding (created lazily; resumed on demand). */
export function getAudioContext(): AudioContext {
  if (shared && shared.state !== 'closed') return shared;
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new Error('Web Audio is not available in this browser.');
  // No forced sampleRate: the hardware rate avoids resampling, and Firefox refuses to connect a
  // MediaStreamSource (mic) to a context whose rate differs from the device's.
  shared = new Ctor({ latencyHint: 'interactive' });
  return shared;
}

/**
 * Resume the shared context. Call it directly from a user gesture (tap/click/keydown): iOS Safari
 * and Chrome's autoplay policy only let a context start inside one. `ctx.resume()` is invoked
 * synchronously (before the first `await`), so the gesture is still "active" when it runs, even if
 * the caller doesn't await this.
 */
export async function resumeAudio(): Promise<void> {
  const ctx = getAudioContext();
  // 'interrupted' (iOS, e.g. a phone call) isn't in the TS union, so compare against 'running'.
  if (ctx.state === 'running') return;
  const resumed = ctx.resume();
  // Older iOS versions only really unlock audio output once something is played inside the gesture:
  // play one silent sample.
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
    src.onended = () => src.disconnect();
  } catch {
    /* not essential */
  }
  try {
    await resumed;
  } catch {
    /* resume() can reject outside a gesture — the next gesture will try again */
  }
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  // Blob.arrayBuffer() is missing in Safari < 14; Response works there.
  return typeof blob.arrayBuffer === 'function' ? blob.arrayBuffer() : new Response(blob).arrayBuffer();
}

/**
 * Decode any audio Blob to an AudioBuffer using the shared context. The result is resampled to the
 * context's sample rate (decodeAudioData always does that).
 */
export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  // decodeAudioData detaches (neuters) the buffer it gets. blobToArrayBuffer() returns a fresh copy
  // that nobody else holds, so that's harmless.
  const data = await blobToArrayBuffer(blob);
  return new Promise<AudioBuffer>((resolve, reject) => {
    const fail = (err: unknown) =>
      // Old Safari calls the error callback with null.
      reject(err instanceof Error ? err : new DOMException('Could not decode audio data.', 'EncodingError'));
    try {
      // Pass the callbacks as well: old Safari only supports the callback form and returns undefined
      // instead of a Promise. Modern browsers call both the callback and the promise; settling a
      // Promise twice is a no-op.
      const maybe = ctx.decodeAudioData(data, resolve, fail) as Promise<AudioBuffer> | undefined;
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, fail);
    } catch (err) {
      fail(err);
    }
  });
}
