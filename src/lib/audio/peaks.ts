/** Waveform peaks resolution: values per second of audio. */
export const PEAKS_PER_SECOND = 50;

/** Max absolute amplitude per block of 1/PEAKS_PER_SECOND s (channel 0 — sounds are mono). Normalized to 0..1. */
export function computePeaks(buffer: AudioBuffer): Float32Array {
  const data = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SECOND));
  const out = new Float32Array(Math.ceil(data.length / block));
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    let peak = 0;
    const end = Math.min(data.length, (i + 1) * block);
    for (let j = i * block; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  // Normalize so quiet recordings still show a visible waveform (kids like seeing their voice).
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / max);
  return out;
}
