import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_FPS, type Frame, type Project } from './types';

interface StopmoergelDB extends DBSchema {
  projects: { key: string; value: Project };
  frames: { key: string; value: Frame; indexes: { byProject: string } };
}

let dbPromise: Promise<IDBPDatabase<StopmoergelDB>> | undefined;

/** Opens the database lazily, once. */
function db(): Promise<IDBPDatabase<StopmoergelDB>> {
  dbPromise ??= openDB<StopmoergelDB>('stopmoergel', 1, {
    upgrade(database) {
      database.createObjectStore('projects', { keyPath: 'id' });
      const frames = database.createObjectStore('frames', { keyPath: 'id' });
      frames.createIndex('byProject', 'projectId');
    },
  });
  return dbPromise;
}

/** Clears the cached connection (tests use a fresh IDBFactory per test). */
export function _resetForTests(): void {
  dbPromise = undefined;
}

/** All projects, newest (by updatedAt) first. */
export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One project by id. */
export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
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
  };
  await (await db()).put('projects', project);
  return project;
}

/** Stores a copy of the project with a fresh updatedAt and returns that copy. */
export async function saveProject(project: Project): Promise<Project> {
  const stored: Project = { ...project, frameIds: [...project.frameIds], updatedAt: Date.now() };
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

/** Deletes a project and all its frames in one transaction. */
export async function deleteProject(id: string): Promise<void> {
  const tx = (await db()).transaction(['projects', 'frames'], 'readwrite');
  const frameKeys = await tx.objectStore('frames').index('byProject').getAllKeys(id);
  await Promise.all([
    tx.objectStore('projects').delete(id),
    ...frameKeys.map((key) => tx.objectStore('frames').delete(key)),
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

/** Deletes the project's frames that are not in its frameIds. Returns the count deleted. */
export async function collectGarbage(projectId: string): Promise<number> {
  const tx = (await db()).transaction(['projects', 'frames'], 'readwrite');
  const project = await tx.objectStore('projects').get(projectId);
  const keep = new Set(project?.frameIds ?? []);
  const keys = await tx.objectStore('frames').index('byProject').getAllKeys(projectId);
  const garbage = keys.filter((key) => !keep.has(key));
  await Promise.all(garbage.map((key) => tx.objectStore('frames').delete(key)));
  await tx.done;
  return garbage.length;
}

/** Asks the browser not to evict our data. Never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
