import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTests,
  addFrame,
  collectGarbage,
  createProject,
  deleteProject,
  getFrame,
  getFrames,
  getProject,
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
