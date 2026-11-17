const HEADER = 44;

/**
 * Float sample (-1..1, clamped) to 16-bit int. Asymmetric like most encoders:
 * 1.0 -> 32767, -1.0 -> -32768.
 */
function toInt16(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  return c < 0 ? Math.round(c * 32768) : Math.round(c * 32767);
}

/** Encodes float PCM channels into raw 16-bit little-endian PCM WAV bytes (interleaved). */
export function encodeWavBytes(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = Math.max(1, channels.length);
  const frames = channels.length ? channels[0].length : 0;
  const dataSize = frames * numCh * 2;
  const bytes = new Uint8Array(HEADER + dataSize);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * 2, true);
  v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = HEADER;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      v.setInt16(o, toInt16(channels[c]?.[i] ?? 0), true);
      o += 2;
    }
  }
  return bytes;
}

/** Encodes float PCM into a 16-bit PCM WAV Blob. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  return new Blob([encodeWavBytes(channels, sampleRate) as BlobPart], { type: 'audio/wav' });
}

/** Mixes an AudioBuffer-like down to mono (average of channels). */
export function mixToMono(buffer: {
  numberOfChannels: number;
  length: number;
  getChannelData(i: number): Float32Array;
}): Float32Array {
  const out = new Float32Array(buffer.length);
  const n = buffer.numberOfChannels;
  if (n === 0) return out;
  for (let c = 0; c < n; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) out[i] += data[i];
  }
  if (n > 1) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/** Parse the header of a 16-bit PCM WAV. */
export function readWavInfo(
  bytes: Uint8Array,
): { sampleRate: number; channels: number; frames: number } | null {
  if (bytes.length < HEADER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null;
  if (v.getUint16(20, true) !== 1 || v.getUint16(34, true) !== 16) return null;
  const channels = v.getUint16(22, true);
  if (channels < 1) return null;
  return {
    sampleRate: v.getUint32(24, true),
    channels,
    frames: Math.floor(v.getUint32(40, true) / (channels * 2)),
  };
}
