import { describe, expect, it } from 'vitest';
import type { AudioClip } from '../types';
import {
  MIN_CLIP_SECONDS, assignLanes, clipEndFrame, clipMiddleFrame, clipStartSeconds,
  moveClip, splitClip, trimClipEnd, trimClipStart,
} from './clips';

const FPS = 8;
const mk = (o: Partial<AudioClip> = {}): AudioClip => ({
  id: 'a', soundId: 's', startFrame: 10, offset: 1, duration: 2, ...o,
});

describe('basics', () => {
  it('end frame and start seconds', () => {
    expect(clipEndFrame(mk(), FPS)).toBe(26);
    expect(clipStartSeconds(mk(), FPS)).toBe(1.25);
  });
  it('middle frame floors', () => {
    expect(clipMiddleFrame(mk(), FPS)).toBe(18);
    expect(clipMiddleFrame(mk({ duration: 0.25 }), FPS)).toBe(11);
  });
});

describe('moveClip', () => {
  it('rounds and clamps', () => {
    const c = mk();
    expect(moveClip(c, 3.6).startFrame).toBe(4);
    expect(moveClip(c, -5).startFrame).toBe(0);
    expect(c.startFrame).toBe(10);
  });
});

describe('trimClipStart', () => {
  it('forward', () => {
    const r = trimClipStart(mk(), 4, FPS);
    expect(r).toMatchObject({ startFrame: 14, offset: 1.5, duration: 1.5 });
  });
  it('forward clamps to min duration', () => {
    const r = trimClipStart(mk(), 1000, FPS);
    expect(r.duration).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS - 1e-9);
    expect(r.startFrame + r.duration * FPS).toBeCloseTo(26);
  });
  it('backward', () => {
    const r = trimClipStart(mk(), -4, FPS);
    expect(r).toMatchObject({ startFrame: 6, offset: 0.5, duration: 2.5 });
  });
  it('backward limited by offset', () => {
    const r = trimClipStart(mk(), -100, FPS);
    expect(r.offset).toBeCloseTo(0);
    expect(r.startFrame).toBe(2);
    expect(r.duration).toBeCloseTo(3);
  });
  it('backward limited by startFrame', () => {
    const r = trimClipStart(mk({ startFrame: 3 }), -100, FPS);
    expect(r.startFrame).toBe(0);
    expect(r.offset).toBeCloseTo(1 - 3 / FPS);
  });
  it('no change possible', () => {
    const c = mk({ offset: 0 });
    expect(trimClipStart(c, -3, FPS)).toEqual(c);
    expect(trimClipStart(c, 0, FPS)).toEqual(c);
  });
});

describe('trimClipEnd', () => {
  it('sets and clamps', () => {
    const c = mk();
    expect(trimClipEnd(c, 1.5, 10).duration).toBe(1.5);
    expect(trimClipEnd(c, 0, 10).duration).toBe(MIN_CLIP_SECONDS);
    expect(trimClipEnd(c, 99, 4).duration).toBe(3);
    expect(c.duration).toBe(2);
  });
});

describe('splitClip', () => {
  it('splits in the middle', () => {
    const r = splitClip(mk(), 18, FPS, 'b')!;
    expect(r[0]).toMatchObject({ id: 'a', startFrame: 10, offset: 1, duration: 1 });
    expect(r[1]).toMatchObject({ id: 'b', startFrame: 18, offset: 2, duration: 1 });
  });
  it('rejects edges and too-short parts', () => {
    expect(splitClip(mk(), 10, FPS, 'b')).toBeNull();
    expect(splitClip(mk(), 26, FPS, 'b')).toBeNull();
    expect(splitClip(mk(), 5, FPS, 'b')).toBeNull();
    expect(splitClip(mk(), 30, FPS, 'b')).toBeNull();
    expect(splitClip(mk({ duration: 1 }), 10, FPS, 'b')).toBeNull();
    expect(splitClip(mk({ duration: 0.15 }), 11, FPS, 'b')).toBeNull();
    expect(splitClip(mk(), 25, FPS, 'b')).not.toBeNull(); // right part 0.125s is fine
  });
});

describe('assignLanes', () => {
  it('one lane when disjoint or touching', () => {
    const cs = [mk({ id: 'a', startFrame: 0, duration: 1 }), mk({ id: 'b', startFrame: 8, duration: 1 })];
    const r = assignLanes(cs, FPS);
    expect(r.laneCount).toBe(1);
    expect(r.lanes.get('b')).toBe(0);
  });
  it('overlap gets 2 lanes, reuses lowest free', () => {
    const cs = [
      mk({ id: 'a', startFrame: 0, duration: 2 }),
      mk({ id: 'b', startFrame: 8, duration: 2 }),
      mk({ id: 'c', startFrame: 17, duration: 1 }),
    ];
    const r = assignLanes(cs, FPS);
    expect(r.laneCount).toBe(2);
    expect(r.lanes.get('a')).toBe(0);
    expect(r.lanes.get('b')).toBe(1);
    expect(r.lanes.get('c')).toBe(0);
  });
  it('empty gives 1 lane and does not mutate', () => {
    expect(assignLanes([], FPS).laneCount).toBe(1);
    const cs = [mk({ id: 'b', startFrame: 5 }), mk({ id: 'a', startFrame: 0 })];
    assignLanes(cs, FPS);
    expect(cs.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('immutability', () => {
  it('does not mutate inputs', () => {
    const c = Object.freeze(mk());
    expect(() => {
      moveClip(c, 3); trimClipStart(c, 2, FPS); trimClipStart(c, -2, FPS);
      trimClipEnd(c, 1, 5); splitClip(c, 18, FPS, 'x');
    }).not.toThrow();
  });
});
