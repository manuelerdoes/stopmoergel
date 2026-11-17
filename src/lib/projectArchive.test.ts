import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTests, getProject, getSounds } from './db';
import {
  ArchiveError,
  buildArchive,
  importProjectArchive,
  looksLikeArchive,
  parseArchive,
} from './projectArchive';

const meta = { name: 'Mein Film', fps: 12, createdAt: 1, updatedAt: 2 };
const frames = [
  { id: 'a', width: 640, height: 480, bytes: new Uint8Array([1, 2, 3]) },
  { id: 'b', width: 800, height: 600, bytes: new Uint8Array([4, 5]) },
];
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const zipWith = (project: unknown, extra: Record<string, Uint8Array> = {}) =>
  zipSync({ 'project.json': enc(project), ...extra });
const base = { app: 'stopmoergel', formatVersion: 1, project: { name: 'x', fps: 8 }, frameInfo: {} };

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ArchiveError);
    expect((e as ArchiveError).code).toBe(code);
    return;
  }
  throw new Error('did not throw');
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

describe('buildArchive/parseArchive', () => {
  it('round trips order, duplicates, fps, name, sizes, bytes', () => {
    const parsed = parseArchive(buildArchive(meta, frames, ['a', 'b', 'a']));
    expect(parsed.name).toBe('Mein Film');
    expect(parsed.fps).toBe(12);
    expect(parsed.createdAt).toBe(1);
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.frames[0]).toBe(parsed.frames[2]);
    expect(Array.from(parsed.frames[0].bytes)).toEqual([1, 2, 3]);
    expect(Array.from(parsed.frames[1].bytes)).toEqual([4, 5]);
    expect([parsed.frames[1].width, parsed.frames[1].height]).toEqual([800, 600]);
  });

  it('stores a repeated frame once', () => {
    const entries = unzipSync(buildArchive(meta, frames, ['a', 'b', 'a']));
    expect(Object.keys(entries).sort()).toEqual(['frames/0001.jpg', 'frames/0002.jpg', 'project.json']);
  });

  it('rejects random bytes and zips without project.json', () => {
    expectCode(() => parseArchive(new Uint8Array([9, 8, 7, 6, 5])), 'notArchive');
    expectCode(() => parseArchive(zipSync({ 'a.txt': enc('x') })), 'notArchive');
    expectCode(() => parseArchive(zipWith({ ...base, app: 'other' })), 'notArchive');
  });

  it('rejects newer versions', () => {
    expectCode(() => parseArchive(zipWith({ ...base, formatVersion: 3, frames: [] })), 'newerVersion');
  });

  it('rejects missing or empty frames', () => {
    expectCode(() => parseArchive(zipWith({ ...base, frames: ['frames/0001.jpg'] })), 'brokenFrames');
    expectCode(
      () =>
        parseArchive(
          zipWith({ ...base, frames: ['frames/0001.jpg'] }, { 'frames/0001.jpg': new Uint8Array(0) }),
        ),
      'brokenFrames',
    );
  });

  it('rejects path tricks', () => {
    const evil = { '../evil.jpg': new Uint8Array([1]) };
    expectCode(() => parseArchive(zipWith({ ...base, frames: ['../evil.jpg'] }, evil)), 'brokenFrames');
    expectCode(() => parseArchive(zipWith({ ...base, frames: ['frames/../x.jpg'] })), 'brokenFrames');
  });

  it('clamps fps and defaults name', () => {
    const p = parseArchive(zipWith({ ...base, project: { name: '  ', fps: 99 }, frames: [] }));
    expect(p.fps).toBe(24);
    expect(p.name).toBe('Film');
  });
});

describe('importProjectArchive', () => {
  it('creates a new project with ordered frameIds', async () => {
    const zip = buildArchive(meta, frames, ['a', 'b', 'a']);
    const project = await importProjectArchive(new Blob([zip as BlobPart]));
    expect(project.name).toBe('Mein Film');
    expect(project.fps).toBe(12);
    expect(project.frameIds).toHaveLength(3);
    expect(project.frameIds[0]).toBe(project.frameIds[2]);
    expect(project.frameIds[0]).not.toBe(project.frameIds[1]);
    expect((await getProject(project.id))?.frameIds).toEqual(project.frameIds);
  });
});

const sounds = [{ id: 's1', duration: 1.5, kind: 'recording' as const, bytes: new Uint8Array([7, 7, 7]) }];
const clip = (id: string, startFrame: number) => ({ id, soundId: 's1', startFrame, offset: 0, duration: 1.5 });
const v2 = { ...base, formatVersion: 2, frames: [] };

describe('audio (format v2)', () => {
  it('round trips clips and stores a shared sound once', () => {
    const zip = buildArchive(meta, frames, ['a'], { sounds, clips: [clip('c1', 3), clip('c2', 20)] });
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['frames/0001.jpg', 'project.json', 'sounds/0001.wav']);
    const parsed = parseArchive(zip);
    expect(parsed.sounds).toHaveLength(1);
    expect(Array.from(parsed.sounds[0].bytes)).toEqual([7, 7, 7]);
    expect(parsed.sounds[0].duration).toBe(1.5);
    expect(parsed.audioClips.map((c) => [c.soundPath, c.startFrame])).toEqual([
      ['sounds/0001.wav', 3],
      ['sounds/0001.wav', 20],
    ]);
  });

  it('skips unreferenced sounds', () => {
    const zip = buildArchive(meta, frames, ['a'], { sounds, clips: [] });
    expect(Object.keys(unzipSync(zip))).not.toContain('sounds/0001.wav');
  });

  it('imports a v1 file without audio', () => {
    const parsed = parseArchive(zipWith({ ...base, frames: [] }));
    expect(parsed.sounds).toEqual([]);
    expect(parsed.audioClips).toEqual([]);
  });

  it('rejects broken clip references and bad numbers', () => {
    const good = { 'sounds/0001.wav': new Uint8Array([1]) };
    const info = { 'sounds/0001.wav': { duration: 1, kind: 'music' } };
    const c = { sound: 'sounds/0001.wav', startFrame: 1, offset: 0, duration: 1 };
    expect(parseArchive(zipWith({ ...v2, sounds: info, audioClips: [c] }, good)).audioClips).toHaveLength(1);
    expectCode(() => parseArchive(zipWith({ ...v2, sounds: info, audioClips: [c] })), 'brokenFrames');
    expectCode(() => parseArchive(zipWith({ ...v2, sounds: {}, audioClips: [c] }, good)), 'brokenFrames');
    for (const bad of [{ offset: -1 }, { duration: 0 }, { startFrame: NaN }, { duration: 'x' }]) {
      expectCode(
        () => parseArchive(zipWith({ ...v2, sounds: info, audioClips: [{ ...c, ...bad }] }, good)),
        'brokenFrames',
      );
    }
  });

  it('rounds and clamps startFrame', () => {
    const good = { 'sounds/0001.wav': new Uint8Array([1]) };
    const info = { 'sounds/0001.wav': { duration: 1, kind: 'music' } };
    const c = { sound: 'sounds/0001.wav', offset: 0, duration: 1 };
    const p = parseArchive(
      zipWith({ ...v2, sounds: info, audioClips: [{ ...c, startFrame: -4 }, { ...c, startFrame: 2.6 }] }, good),
    );
    expect(p.audioClips.map((x) => x.startFrame)).toEqual([0, 3]);
  });

  it('guards sound paths', () => {
    const evil = { '../evil.wav': new Uint8Array([1]) };
    for (const sound of ['../evil.wav', 'sounds/../x.wav', 'sounds/a.mp3']) {
      const c = { sound, startFrame: 0, offset: 0, duration: 1 };
      expectCode(
        () => parseArchive(zipWith({ ...v2, sounds: { [sound]: { duration: 1 } }, audioClips: [c] }, evil)),
        'brokenFrames',
      );
    }
  });

  it('imports sounds and remaps clips', async () => {
    const zip = buildArchive(meta, frames, ['a'], { sounds, clips: [clip('c1', 3), clip('c2', 20)] });
    const project = await importProjectArchive(new Blob([zip as BlobPart]));
    expect(project.audioClips).toHaveLength(2);
    expect(project.audioClips[0].id).not.toBe('c1');
    expect(project.audioClips[0].soundId).toBe(project.audioClips[1].soundId);
    expect(project.audioClips.map((c) => c.startFrame)).toEqual([3, 20]);
    const stored = await getSounds([project.audioClips[0].soundId]);
    expect(stored.get(project.audioClips[0].soundId)?.duration).toBe(1.5);
    expect((await getProject(project.id))?.audioClips).toEqual(project.audioClips);
  });
});

describe('looksLikeArchive', () => {
  it('accepts zip names', () => {
    expect(looksLikeArchive('A.stopmoergel.zip')).toBe(true);
    expect(looksLikeArchive('B.ZIP')).toBe(true);
    expect(looksLikeArchive('c.mp4')).toBe(false);
  });
});
