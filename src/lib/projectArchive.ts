import { unzipSync, zipSync, type Zippable } from 'fflate';
import { addFrame, createProject, deleteProject, getFrames, getProject, saveProject } from './db';
import { DEFAULT_FPS, MAX_FPS, MIN_FPS, type Project } from './types';

export const ARCHIVE_SUFFIX = '.stopmoergel.zip';
export const ARCHIVE_FORMAT_VERSION = 1;

export type ArchiveErrorCode = 'notArchive' | 'newerVersion' | 'brokenFrames';

/** Friendly, typed error for unusable backup files. */
export class ArchiveError extends Error {
  constructor(
    public code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ArchiveMeta {
  name: string;
  fps: number;
  createdAt: number;
  updatedAt: number;
}

export interface ArchiveFrameInput {
  id: string;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface ParsedArchive {
  name: string;
  fps: number;
  createdAt: number;
  frames: { bytes: Uint8Array; width: number; height: number; path: string }[];
}

const FRAME_PATH = /^frames\/[\w.-]+\.(jpe?g|png|webp)$/i;

/** Pure: builds the zip bytes. Frames repeated in `frameIds` are stored once. */
export function buildArchive(
  meta: ArchiveMeta,
  frames: ArchiveFrameInput[],
  frameIds: string[],
): Uint8Array {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const pathById = new Map<string, string>();
  const files: Zippable = {};
  const frameInfo: Record<string, { width: number; height: number }> = {};
  const order: string[] = [];
  for (const id of frameIds) {
    let path = pathById.get(id);
    if (!path) {
      const frame = byId.get(id);
      if (!frame) throw new ArchiveError('brokenFrames', `Frame ${id} not found`);
      path = `frames/${String(pathById.size + 1).padStart(4, '0')}.jpg`;
      pathById.set(id, path);
      files[path] = [frame.bytes, { level: 0 }];
      frameInfo[path] = { width: frame.width, height: frame.height };
    }
    order.push(path);
  }
  const json = {
    app: 'stopmoergel',
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: meta.name, fps: meta.fps, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    frames: order,
    frameInfo,
  };
  files['project.json'] = [new TextEncoder().encode(JSON.stringify(json, null, 2)), { level: 6 }];
  return zipSync(files);
}

/** Pure: validates and reads a zip. Repeated paths resolve to the same frame object. */
export function parseArchive(bytes: Uint8Array): ParsedArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ArchiveError('notArchive', 'Not a zip file');
  }
  const raw = entries['project.json'];
  if (!raw) throw new ArchiveError('notArchive', 'project.json missing');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ArchiveError('notArchive', 'project.json is not valid JSON');
  }
  if (!json || typeof json !== 'object' || json.app !== 'stopmoergel') {
    throw new ArchiveError('notArchive', 'Not a Stopmoergel archive');
  }
  if (typeof json.formatVersion === 'number' && json.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveError('newerVersion', 'Made with a newer version');
  }
  const proj = json.project && typeof json.project === 'object' ? json.project : {};
  const rawName = typeof proj.name === 'string' ? proj.name.trim().slice(0, 40).trim() : '';
  const fpsNum = typeof proj.fps === 'number' && Number.isFinite(proj.fps) ? Math.round(proj.fps) : DEFAULT_FPS;
  const fps = Math.min(MAX_FPS, Math.max(MIN_FPS, fpsNum));
  const createdAt = typeof proj.createdAt === 'number' ? proj.createdAt : Date.now();
  const order: unknown = json.frames;
  if (!Array.isArray(order)) throw new ArchiveError('brokenFrames', 'frames list missing');
  const info = json.frameInfo && typeof json.frameInfo === 'object' ? json.frameInfo : {};
  const cache = new Map<string, ParsedArchive['frames'][number]>();
  const frames: ParsedArchive['frames'] = [];
  for (const path of order) {
    if (typeof path !== 'string' || !FRAME_PATH.test(path)) {
      throw new ArchiveError('brokenFrames', `Bad frame path: ${String(path)}`);
    }
    let frame = cache.get(path);
    if (!frame) {
      const data = Object.prototype.hasOwnProperty.call(entries, path) ? entries[path] : undefined;
      if (!data || data.length === 0) throw new ArchiveError('brokenFrames', `Frame missing: ${path}`);
      const fi = Object.prototype.hasOwnProperty.call(info, path) ? info[path] : undefined;
      const width = typeof fi?.width === 'number' && fi.width > 0 ? fi.width : 1280;
      const height = typeof fi?.height === 'number' && fi.height > 0 ? fi.height : 720;
      frame = { bytes: data, width, height, path };
      cache.set(path, frame);
    }
    frames.push(frame);
  }
  return { name: rawName || 'Film', fps, createdAt, frames };
}

/** Makes a movie name safe to use as a file name. */
function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || 'movie';
}

/** Builds the zip for a stored project (reads project + frames from db). Throws if project missing. */
export async function exportProjectArchive(projectId: string): Promise<{ blob: Blob; fileName: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const stored = await getFrames([...new Set(project.frameIds)]);
  const frames: ArchiveFrameInput[] = [];
  for (const f of stored.values()) {
    frames.push({
      id: f.id,
      width: f.width,
      height: f.height,
      bytes: new Uint8Array(await f.blob.arrayBuffer()),
    });
  }
  const bytes = buildArchive(project, frames, project.frameIds);
  return {
    blob: new Blob([bytes as BlobPart], { type: 'application/zip' }),
    fileName: `${safeFileName(project.name)}${ARCHIVE_SUFFIX}`,
  };
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** Reads a zip and creates a NEW project (new ids) in the db. Returns it. */
export async function importProjectArchive(file: Blob): Promise<Project> {
  const parsed = parseArchive(new Uint8Array(await file.arrayBuffer()));
  const project = await createProject(parsed.name);
  try {
    const idByFrame = new Map<ParsedArchive['frames'][number], string>();
    const frameIds: string[] = [];
    for (const frame of parsed.frames) {
      let id = idByFrame.get(frame);
      if (!id) {
        const stored = await addFrame(
          project.id,
          new Blob([frame.bytes as BlobPart], { type: mimeFor(frame.path) }),
          frame.width,
          frame.height,
        );
        id = stored.id;
        idByFrame.set(frame, id);
      }
      frameIds.push(id);
    }
    return await saveProject({ ...project, fps: parsed.fps, frameIds });
  } catch (error) {
    await deleteProject(project.id).catch(() => undefined);
    throw error;
  }
}

/** True if the file name looks like something we can import (.zip). */
export function looksLikeArchive(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.zip');
}
