import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTests,
  addFrame,
  addSound,
  collectGarbage,
  createProject,
  deleteProject,
  getFrame,
  getFrames,
  getProject,
  getSounds,
  listProjects,
  renameProject,
  requestPersistentStorage,
  saveProject,
} from './db';
import { DEFAULT_FPS } from './types';

const jpeg = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
  vi.restoreAllMocks();
});

describe('projects', () => {
  it('creates a project with defaults', async () => {
    const p = await createProject('Hallo');
    expect(p.name).toBe('Hallo');
    expect(p.fps).toBe(DEFAULT_FPS);
    expect(p.frameIds).toEqual([]);
    expect(p.audioClips).toEqual([]);
    expect(p.createdAt).toBe(p.updatedAt);
    expect(await getProject(p.id)).toEqual(p);
  });

  it('lists newest updated first', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const a = await createProject('a');
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    const b = await createProject('b');
    vi.spyOn(Date, 'now').mockReturnValue(3000);
    await saveProject(a);
    expect((await listProjects()).map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('saveProject bumps updatedAt and returns the stored copy', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const p = await createProject('x');
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    const saved = await saveProject({ ...p, fps: 12 });
    expect(saved.updatedAt).toBe(5000);
    expect(saved.fps).toBe(12);
    expect(await getProject(p.id)).toEqual(saved);
  });

  it('renames, and ignores missing ids', async () => {
    const p = await createProject('old');
    await renameProject(p.id, 'new');
    expect((await getProject(p.id))?.name).toBe('new');
    await renameProject('missing', 'nope');
    expect(await getProject('missing')).toBeUndefined();
    expect(await listProjects()).toHaveLength(1);
  });
});

describe('frames', () => {
  it('stores frames without touching the project, and round-trips them', async () => {
    const p = await createProject('m');
    const f = await addFrame(p.id, jpeg(), 640, 480);
    expect((await getProject(p.id))?.frameIds).toEqual([]);
    const got = await getFrame(f.id);
    expect(got?.projectId).toBe(p.id);
    expect(got?.width).toBe(640);
    expect(got?.height).toBe(480);
    // jsdom's Blob is not structured-cloneable by fake-indexeddb (comes back as a plain object),
    // so only check that something was stored; real browsers round-trip Blobs natively.
    expect(got?.blob).toBeDefined();
  });

  it('getFrames omits missing ids', async () => {
    const p = await createProject('m');
    const f1 = await addFrame(p.id, jpeg(), 1, 1);
    const f2 = await addFrame(p.id, jpeg(), 1, 1);
    const map = await getFrames([f1.id, 'nope', f2.id]);
    expect([...map.keys()].sort()).toEqual([f1.id, f2.id].sort());
  });

  it('collectGarbage removes only unreferenced frames of that project', async () => {
    const p = await createProject('a');
    const other = await createProject('b');
    const keep = await addFrame(p.id, jpeg(), 1, 1);
    const drop1 = await addFrame(p.id, jpeg(), 1, 1);
    const drop2 = await addFrame(p.id, jpeg(), 1, 1);
    const foreign = await addFrame(other.id, jpeg(), 1, 1);
    await saveProject({ ...p, frameIds: [keep.id] });

    expect(await collectGarbage(p.id)).toBe(2);
    expect(await getFrame(keep.id)).toBeDefined();
    expect(await getFrame(drop1.id)).toBeUndefined();
    expect(await getFrame(drop2.id)).toBeUndefined();
    expect(await getFrame(foreign.id)).toBeDefined();
    expect(await collectGarbage(p.id)).toBe(0);
  });

  it('collectGarbage deletes all frames if the project is missing', async () => {
    const f = await addFrame('ghost', jpeg(), 1, 1);
    expect(await collectGarbage('ghost')).toBe(1);
    expect(await getFrame(f.id)).toBeUndefined();
  });

  it('deleteProject removes its frames but not others', async () => {
    const p = await createProject('a');
    const other = await createProject('b');
    const f = await addFrame(p.id, jpeg(), 1, 1);
    const g = await addFrame(other.id, jpeg(), 1, 1);
    await deleteProject(p.id);
    expect(await getProject(p.id)).toBeUndefined();
    expect(await getFrame(f.id)).toBeUndefined();
    expect(await getFrame(g.id)).toBeDefined();
    expect(await getProject(other.id)).toBeDefined();
  });
});

const wav = () => new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' });

describe('sounds', () => {
  it('stores and loads sounds, omitting missing ids', async () => {
    const p = await createProject('m');
    const a = await addSound(p.id, wav(), 1.5, 'recording');
    const b = await addSound(p.id, wav(), 2, 'music');
    expect(a.kind).toBe('recording');
    expect(a.duration).toBe(1.5);
    const map = await getSounds([a.id, 'nope', b.id]);
    expect([...map.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(map.get(b.id)?.kind).toBe('music');
  });

  it('saveProject copies audioClips', async () => {
    const p = await createProject('m');
    const clip = { id: 'c', soundId: 's', startFrame: 1, offset: 0, duration: 1 };
    const saved = await saveProject({ ...p, audioClips: [clip] });
    clip.startFrame = 9;
    expect(saved.audioClips[0].startFrame).toBe(1);
    expect((await getProject(p.id))?.audioClips).toEqual([{ ...clip, startFrame: 1 }]);
  });

  it('collectGarbage removes unreferenced sounds and counts frames + sounds', async () => {
    const p = await createProject('a');
    const other = await createProject('b');
    const keep = await addSound(p.id, wav(), 1, 'recording');
    const drop = await addSound(p.id, wav(), 1, 'recording');
    const foreign = await addSound(other.id, wav(), 1, 'recording');
    await addFrame(p.id, jpeg(), 1, 1);
    await saveProject({
      ...p,
      audioClips: [{ id: 'c', soundId: keep.id, startFrame: 0, offset: 0, duration: 1 }],
    });
    expect(await collectGarbage(p.id)).toBe(2);
    const map = await getSounds([keep.id, drop.id, foreign.id]);
    expect([...map.keys()].sort()).toEqual([keep.id, foreign.id].sort());
  });

  it('deleteProject removes its sounds but not others', async () => {
    const p = await createProject('a');
    const other = await createProject('b');
    const s = await addSound(p.id, wav(), 1, 'music');
    const t = await addSound(other.id, wav(), 1, 'music');
    await deleteProject(p.id);
    expect([...(await getSounds([s.id, t.id])).keys()]).toEqual([t.id]);
  });
});

describe('schema upgrade v1 -> v2', () => {
  it('keeps v1 data readable and adds the sounds store', async () => {
    const old = await openDB('stopmoergel', 1, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('frames', { keyPath: 'id' }).createIndex('byProject', 'projectId');
      },
    });
    await old.put('projects', { id: 'p1', name: 'Alt', createdAt: 1, updatedAt: 2, fps: 8, frameIds: ['f'] });
    await old.put('frames', { id: 'f', projectId: 'p1', blob: jpeg(), width: 1, height: 1, createdAt: 1 });
    old.close();

    const p = await getProject('p1');
    expect(p?.audioClips).toEqual([]);
    expect(p?.frameIds).toEqual(['f']);
    expect((await listProjects())[0].audioClips).toEqual([]);
    expect(await getFrame('f')).toBeDefined();
    const s = await addSound('p1', wav(), 1, 'recording');
    expect((await getSounds([s.id])).size).toBe(1);
    expect(await collectGarbage('p1')).toBe(1);
  });
});

describe('requestPersistentStorage', () => {
  it('returns false when unavailable', async () => {
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns the browser answer and never throws', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(true) } });
    expect(await requestPersistentStorage()).toBe(true);
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('x')) } });
    expect(await requestPersistentStorage()).toBe(false);
    vi.unstubAllGlobals();
  });
});
