import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_FPS, type Frame, type Project, type Sound } from './types';

interface StopmoergelDB extends DBSchema {
  projects: { key: string; value: Project };
  frames: { key: string; value: Frame; indexes: { byProject: string } };
  sounds: { key: string; value: Sound; indexes: { byProject: string } };
}

let dbPromise: Promise<IDBPDatabase<StopmoergelDB>> | undefined;

/** Opens the database lazily, once. */
function db(): Promise<IDBPDatabase<StopmoergelDB>> {
  dbPromise ??= openDB<StopmoergelDB>('stopmoergel', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('projects', { keyPath: 'id' });
        const frames = database.createObjectStore('frames', { keyPath: 'id' });
        frames.createIndex('byProject', 'projectId');
      }
      if (oldVersion < 2) {
        const sounds = database.createObjectStore('sounds', { keyPath: 'id' });
        sounds.createIndex('byProject', 'projectId');
      }
    },
  });
  return dbPromise;
}

/** Clears the cached connection (tests use a fresh IDBFactory per test). */
export function _resetForTests(): void {
  dbPromise = undefined;
}

/** Older stored projects lack audioClips. */
function normalize(p: Project): Project {
  return { ...p, audioClips: p.audioClips ?? [] };
}

/** All projects, newest (by updatedAt) first. */
export async function listProjects(): Promise<Project[]> {
  const all = (await (await db()).getAll('projects')).map(normalize);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One project by id. */
export async function getProject(id: string): Promise<Project | undefined> {
  const p = await (await db()).get('projects', id);
  return p ? normalize(p) : undefined;
}

/** Creates and stores an empty project. */
export async function createProject(name: string): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    fps: DEFAULT_FPS,
    frameIds: [],
    audioClips: [],
  };
  await (await db()).put('projects', project);
  return project;
}

/** Stores a copy of the project with a fresh updatedAt and returns that copy. */
export async function saveProject(project: Project): Promise<Project> {
  const stored: Project = { ...project, frameIds: [...project.frameIds],
    audioClips: (project.audioClips ?? []).map((c) => ({ ...c })),
    updatedAt: Date.now() };
  await (await db()).put('projects', stored);
  return stored;
}

/** Renames a project; no-op if it does not exist. */
export async function renameProject(id: string, name: string): Promise<void> {
  const tx = (await db()).transaction('projects', 'readwrite');
  const project = await tx.store.get(id);
  if (project) await tx.store.put({ ...project, name, updatedAt: Date.now() });
  await tx.done;
}

/** Deletes a project and all its frames and sounds in one transaction. */
export async function deleteProject(id: string): Promise<void> {
  const tx = (await db()).transaction(['projects', 'frames', 'sounds'], 'readwrite');
  const frameKeys = await tx.objectStore('frames').index('byProject').getAllKeys(id);
  const soundKeys = await tx.objectStore('sounds').index('byProject').getAllKeys(id);
  await Promise.all([
    tx.objectStore('projects').delete(id),
    ...frameKeys.map((key) => tx.objectStore('frames').delete(key)),
    ...soundKeys.map((key) => tx.objectStore('sounds').delete(key)),
  ]);
  await tx.done;
}

/** Stores a frame. Does not touch the project's frameIds. */
export async function addFrame(
  projectId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<Frame> {
  const frame: Frame = { id: crypto.randomUUID(), projectId, blob, width, height, createdAt: Date.now() };
  await (await db()).put('frames', frame);
  return frame;
}

/** One frame by id. */
export async function getFrame(id: string): Promise<Frame | undefined> {
  return (await db()).get('frames', id);
}

/** Loads several frames; missing ids are absent from the map. */
export async function getFrames(ids: string[]): Promise<Map<string, Frame>> {
  const database = await db();
  const found = await Promise.all(ids.map((id) => database.get('frames', id)));
  const map = new Map<string, Frame>();
  for (const frame of found) if (frame) map.set(frame.id, frame);
  return map;
}

/** Stores a sound. Does not touch the project's audioClips. */
export async function addSound(
  projectId: string,
  blob: Blob,
  duration: number,
  kind: Sound['kind'],
): Promise<Sound> {
  const sound: Sound = { id: crypto.randomUUID(), projectId, blob, duration, createdAt: Date.now(), kind };
  await (await db()).put('sounds', sound);
  return sound;
}

/** Loads several sounds; missing ids are absent from the map. */
export async function getSounds(ids: string[]): Promise<Map<string, Sound>> {
  const database = await db();
  const found = await Promise.all(ids.map((id) => database.get('sounds', id)));
  const map = new Map<string, Sound>();
  for (const sound of found) if (sound) map.set(sound.id, sound);
  return map;
}

/**
 * Deletes the project's frames not in frameIds and sounds not referenced by audioClips.
 * Returns the total count deleted.
 */
export async function collectGarbage(projectId: string): Promise<number> {
  const tx = (await db()).transaction(['projects', 'frames', 'sounds'], 'readwrite');
  const project = await tx.objectStore('projects').get(projectId);
  const keepFrames = new Set(project?.frameIds ?? []);
  const keepSounds = new Set((project?.audioClips ?? []).map((c) => c.soundId));
  const frameKeys = await tx.objectStore('frames').index('byProject').getAllKeys(projectId);
  const soundKeys = await tx.objectStore('sounds').index('byProject').getAllKeys(projectId);
  const garbageFrames = frameKeys.filter((key) => !keepFrames.has(key));
  const garbageSounds = soundKeys.filter((key) => !keepSounds.has(key));
  await Promise.all([
    ...garbageFrames.map((key) => tx.objectStore('frames').delete(key)),
    ...garbageSounds.map((key) => tx.objectStore('sounds').delete(key)),
  ]);
  await tx.done;
  return garbageFrames.length + garbageSounds.length;
}

/** Asks the browser not to evict our data. Never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
