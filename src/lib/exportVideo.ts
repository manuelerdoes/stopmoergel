// Browser-only video export: JPEG frames -> canvas -> video file.
//
// Two encoding paths, tried in this order:
//  1. WebCodecs (VideoEncoder, H.264/AVC) + mediabunny MP4 muxer. Frames get exact
//     timestamps (i / fps), so this runs much faster than real time and also works
//     in background tabs. Output is always MP4.
//  2. MediaRecorder fallback: records the canvas in real time (a movie of N frames
//     at F fps takes ~N/F s). Prefers MP4, falls back to WebM (e.g. older Firefox).

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny';

export interface ExportOptions {
  fps: number;
  /** Output width in px; height follows the first frame's aspect ratio. Default: first frame's width, capped at 1280. Forced even. */
  maxWidth?: number;
  onProgress?: (fraction: number) => void; // 0..1
  signal?: AbortSignal; // abort => reject with DOMException 'AbortError'
}
export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

const MIME_PREFERENCE = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** Encoding quality for the WebCodecs path. mediabunny derives the bitrate from it and the resolution. */
const WEBCODECS_QUALITY = new Quality('high');
/** Seconds between key frames. Short, so scrubbing in players is snappy (the movies are small anyway). */
const KEY_FRAME_INTERVAL = 1;
/** How many frames to decode ahead of the one being drawn. */
const DECODE_AHEAD = 2;

export function pickVideoMimeType(): string | null {
  try {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return null;
    }
    return MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
  } catch {
    return null;
  }
}

function hasCanvasAndBitmaps(): boolean {
  return typeof createImageBitmap === 'function' && typeof HTMLCanvasElement !== 'undefined';
}

function hasVideoEncoder(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

function isMediaRecorderSupported(): boolean {
  return (
    pickVideoMimeType() !== null &&
    hasCanvasAndBitmaps() &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

/**
 * Synchronous best-effort check whether any export path exists. A present
 * VideoEncoder does not guarantee AVC support (checked async at export time),
 * but then the MediaRecorder fallback is tried.
 */
export function isVideoExportSupported(): boolean {
  return (hasVideoEncoder() && hasCanvasAndBitmaps()) || isMediaRecorderSupported();
}

/**
 * Sync hint for the UI (e.g. button label): will the export most likely be an MP4?
 * Best effort only — the real result's `extension` is authoritative.
 */
export function willExportMp4(): boolean {
  return hasVideoEncoder() || (pickVideoMimeType()?.startsWith('video/mp4') ?? false);
}

/** Can this browser encode H.264 via WebCodecs at the given size? Never throws. */
export async function canExportMp4WithWebCodecs(width = 1280, height = 720): Promise<boolean> {
  if (!hasVideoEncoder() || !hasCanvasAndBitmaps()) return false;
  try {
    return await canEncodeVideo('avc', { width, height, quality: WEBCODECS_QUALITY });
  } catch {
    return false;
  }
}

function abortError(): DOMException {
  return new DOMException('Export aborted', 'AbortError');
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Sleep that rejects early on abort. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(id);
      reject(abortError());
    };
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Lazy bitmap decoder: keeps a small window of pending decodes ("a couple ahead")
 * so long movies don't hold every bitmap in memory at once.
 */
function createFrameDecoder(frames: Blob[]) {
  const pending = new Map<number, Promise<ImageBitmap>>();
  const decode = (i: number) => {
    if (i < frames.length && !pending.has(i)) {
      const p = createImageBitmap(frames[i]);
      p.catch(() => {}); // avoid unhandled rejection if we abort before awaiting
      pending.set(i, p);
    }
  };
  return {
    /** Starts decoding frame i (and the next DECODE_AHEAD) and resolves with frame i. The caller owns (and closes) it. */
    async take(i: number): Promise<ImageBitmap> {
      for (let k = i; k <= i + DECODE_AHEAD; k++) decode(k);
      const p = pending.get(i)!;
      pending.delete(i);
      return p;
    },
    /** Closes all bitmaps that were decoded but not taken. */
    dispose() {
      for (const p of pending.values()) p.then((b) => b.close(), () => {});
      pending.clear();
    },
  };
}

/** Even output dimensions (H.264 requires them), derived from the first frame. */
function outputSize(first: ImageBitmap, maxWidth: number | undefined): { width: number; height: number } {
  const targetW = maxWidth ?? Math.min(first.width, 1280);
  const width = Math.max(2, Math.round(targetW / 2) * 2);
  const height = Math.max(2, Math.round((width * first.height) / first.width / 2) * 2);
  return { width, height };
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available.');
  const draw = (bmp: ImageBitmap) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, width, height);
    // Letterbox: fit inside the canvas preserving aspect ratio.
    const scale = Math.min(width / bmp.width, height / bmp.height);
    const w = bmp.width * scale;
    const h = bmp.height * scale;
    g.drawImage(bmp, (width - w) / 2, (height - h) / 2, w, h);
  };
  return { canvas, draw };
}

/**
 * WebCodecs + mediabunny path. Resolves with `null` (without having encoded
 * anything) if the browser cannot encode AVC at the actual output size, so the
 * caller can fall back to MediaRecorder.
 */
async function exportWithWebCodecs(frames: Blob[], opts: ExportOptions): Promise<ExportResult | null> {
  const { signal, onProgress } = opts;
  const fps = Math.max(1, opts.fps || 1);
  if (signal?.aborted) throw abortError();

  const decoder = createFrameDecoder(frames);
  let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
  // Abort cancels the output right away, which also makes a pending
  // `source.add()` / `finalize()` reject, so we don't wait for the encoder.
  const onAbort = () => {
    void output?.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const first = await decoder.take(0);
    const { width, height } = outputSize(first, opts.maxWidth);
    if (!(await canExportMp4WithWebCodecs(width, height))) {
      first.close();
      return null;
    }
    if (signal?.aborted) {
      first.close();
      throw abortError();
    }

    const { canvas, draw } = createCanvas(width, height);
    const target = new BufferTarget();
    output = new Output({
      // 'in-memory' puts the moov box at the front ("fast start"), which plays
      // well everywhere (Windows, iOS Photos, streaming previews).
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    const source = new CanvasSource(canvas, {
      codec: 'avc',
      quality: WEBCODECS_QUALITY,
      keyFrameInterval: KEY_FRAME_INTERVAL,
    });
    // frameRate snaps all timestamps to the fps grid (clean, constant frame rate).
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();

    for (let i = 0; i < frames.length; i++) {
      const bmp = i === 0 ? first : await decoder.take(i);
      if (signal?.aborted) {
        bmp.close();
        throw abortError();
      }
      draw(bmp);
      bmp.close(); // the canvas holds the pixels now
      // Awaiting add() respects encoder/muxer backpressure: we never queue more
      // frames than the encoder can handle.
      await source.add(i / fps, 1 / fps);
      onProgress?.((i + 1) / frames.length);
    }

    if (signal?.aborted) throw abortError();
    await output.finalize();
    if (!target.buffer) throw new Error('MP4 encoding produced no data.');
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      mimeType: 'video/mp4',
      extension: 'mp4',
    };
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    // Errors from a canceled output are mediabunny's own; report a clean AbortError.
    if (signal?.aborted) throw abortError();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    decoder.dispose();
  }
}

/** MediaRecorder path: records the canvas in real time. */
async function exportWithMediaRecorder(frames: Blob[], opts: ExportOptions): Promise<ExportResult> {
  const mimeType = pickVideoMimeType();
  if (!mimeType || !isMediaRecorderSupported()) {
    throw new Error('Video export is not supported in this browser.');
  }
  const { signal, onProgress } = opts;
  const fps = Math.max(1, opts.fps || 1);
  const frameMs = 1000 / fps;
  if (signal?.aborted) throw abortError();

  const decoder = createFrameDecoder(frames);
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;

  const cleanup = () => {
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* ignore */
    }
    stream?.getTracks().forEach((t) => t.stop());
  };

  try {
    const first = await decoder.take(0);
    const { width, height } = outputSize(first, opts.maxWidth);
    let canvasAndDraw: ReturnType<typeof createCanvas>;
    try {
      canvasAndDraw = createCanvas(width, height);
    } catch (err) {
      first.close();
      throw err;
    }
    const { canvas, draw } = canvasAndDraw;

    // captureStream(0) = "only emit when requestFrame() is called". Not all
    // browsers expose requestFrame (older Safari/Firefox); then fall back to
    // captureStream(fps) which samples the canvas automatically.
    stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    const manual = typeof track?.requestFrame === 'function';
    if (!manual) {
      stream.getTracks().forEach((t) => t.stop());
      stream = canvas.captureStream(fps);
    }
    const requestFrame = () => {
      if (manual) track!.requestFrame!();
    };

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const rec = recorder;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      rec.onstop = () => resolve();
      rec.onerror = () => reject(new Error('Video recording failed.'));
    });
    stopped.catch(() => {}); // handled below; avoid unhandled-rejection noise on abort

    // Draw frame 0 before starting so the recording never begins with a blank frame.
    draw(first);
    rec.start(1000); // timeslice: emit chunks periodically, not only at stop

    // Hold a drawn frame until `deadline` (performance.now() based). Timer drift
    // is corrected because every deadline is computed from the start time, not
    // from "now + frameMs". During the hold we keep calling requestFrame()
    // every ~100ms: encoders may otherwise treat a canvas that never changes
    // as stalled and drop/stretch the frame at very low fps.
    const hold = async (deadline: number) => {
      requestFrame();
      for (;;) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) return;
        await sleep(Math.min(remaining, 100), signal);
        if (deadline - performance.now() > 1) requestFrame();
      }
    };

    const t0 = performance.now();
    for (let i = 0; i < frames.length; i++) {
      const bmp = i === 0 ? first : await decoder.take(i);
      if (signal?.aborted) {
        bmp.close();
        throw abortError();
      }
      draw(bmp);
      bmp.close();
      await hold(t0 + (i + 1) * frameMs);
      onProgress?.((i + 1) / frames.length);
    }
    // Extra frame duration on the last image so it is visible before the stream ends.
    await hold(t0 + (frames.length + 1) * frameMs);

    if (signal?.aborted) throw abortError();
    rec.stop(); // fires a final dataavailable, then stop
    await stopped;
    stream.getTracks().forEach((t) => t.stop());

    const type = mimeType.split(';')[0];
    return {
      blob: new Blob(chunks, { type }),
      mimeType: type,
      extension: type === 'video/mp4' ? 'mp4' : 'webm',
    };
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    // On success the recorder is already inactive and tracks stopped; this just frees bitmaps.
    decoder.dispose();
  }
}

export async function exportVideo(frames: Blob[], opts: ExportOptions): Promise<ExportResult> {
  if (frames.length === 0) throw new Error('Cannot export: the movie has no frames.');
  if (opts.signal?.aborted) throw abortError();

  let webCodecsError: unknown = null;
  if (hasVideoEncoder() && hasCanvasAndBitmaps()) {
    try {
      const result = await exportWithWebCodecs(frames, opts);
      if (result) return result;
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn('WebCodecs MP4 export failed, falling back to MediaRecorder.', err);
      webCodecsError = err;
    }
  }

  // If WebCodecs failed and there is no MediaRecorder either, the WebCodecs
  // error is the more useful one to surface.
  if (webCodecsError && !isMediaRecorderSupported()) throw webCodecsError;
  // Progress restarts from 0 here if the WebCodecs path failed midway.
  return exportWithMediaRecorder(frames, opts);
}


export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned || 'movie';
}

// Kept here for backwards compatibility; import from './download' to avoid pulling in the encoder.
export { downloadBlob } from './download';
