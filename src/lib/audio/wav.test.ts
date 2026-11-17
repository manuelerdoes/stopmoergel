import { describe, expect, it } from 'vitest';
import { encodeWav, encodeWavBytes, mixToMono, readWavInfo } from './wav';

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe('encodeWavBytes', () => {
  it('writes a standard header', () => {
    const b = encodeWavBytes([new Float32Array(10)], 44100);
    const v = view(b);
    const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
    expect(b.length).toBe(44 + 20);
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint32(4, true)).toBe(36 + 20);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(88200);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(20);
  });
  it('converts samples (1 -> 32767, -1 -> -32768) and clamps', () => {
    const b = encodeWavBytes([Float32Array.from([1, -1, 0, 2, -3, 0.5])], 8000);
    const v = view(b);
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4)]).toEqual([32767, -32768, 0, 32767, -32768]);
    expect(s(5)).toBe(16384);
  });
  it('interleaves channels', () => {
    const b = encodeWavBytes([Float32Array.from([1, 0]), Float32Array.from([-1, 0.5])], 8000);
    const v = view(b);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(0);
    expect(v.getInt16(50, true)).toBe(16384);
  });
  it('Blob has type and size', () => {
    const blob = encodeWav([new Float32Array(5)], 8000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(54);
  });
});

describe('readWavInfo', () => {
  it('round trips', () => {
    const b = encodeWavBytes([new Float32Array(7), new Float32Array(7)], 22050);
    expect(readWavInfo(b)).toEqual({ sampleRate: 22050, channels: 2, frames: 7 });
  });
  it('rejects garbage', () => {
    expect(readWavInfo(new Uint8Array(10))).toBeNull();
    expect(readWavInfo(new Uint8Array(60))).toBeNull();
  });
});

describe('mixToMono', () => {
  it('averages channels', () => {
    const chans = [Float32Array.from([1, 0, -1]), Float32Array.from([0, 0, 1])];
    const out = mixToMono({ numberOfChannels: 2, length: 3, getChannelData: (i) => chans[i] });
    expect(Array.from(out)).toEqual([0.5, 0, 0]);
  });
  it('passes mono through', () => {
    const d = Float32Array.from([0.25, -0.5]);
    const out = mixToMono({ numberOfChannels: 1, length: 2, getChannelData: () => d });
    expect(Array.from(out)).toEqual([0.25, -0.5]);
  });
});
