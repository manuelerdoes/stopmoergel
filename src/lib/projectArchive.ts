import { unzipSync, zipSync, type Zippable } from 'fflate';
import {
  addFrame,
  addSound,
  createProject,
  deleteProject,
  getFrames,
  getProject,
  getSounds,
  saveProject,
} from './db';
import { DEFAULT_FPS, MAX_FPS, MIN_FPS, type AudioClip, type Project, type Sound } from './types';

export const ARCHIVE_SUFFIX = '.stopmoergel.zip';
export const ARCHIVE_FORMAT_VERSION = 2;

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

export interface ArchiveSoundInput {
  id: string;
  duration: number;
  kind: Sound['kind'];
  bytes: Uint8Array;
}

export interface ArchiveAudioInput {
  sounds: ArchiveSoundInput[];
  clips: AudioClip[];
}

export interface ParsedArchive {
  name: string;
  fps: number;
  createdAt: number;
  frames: { bytes: Uint8Array; width: number; height: number; path: string }[];
  sounds: { path: string; bytes: Uint8Array; duration: number; kind: Sound['kind'] }[];
  audioClips: { soundPath: string; startFrame: number; offset: number; duration: number }[];
}

const SOUND_PATH = /^sounds\/[\w.-]+\.wav$/i;
const FRAME_PATH = /^frames\/[\w.-]+\.(jpe?g|png|webp)$/i;

/** Pure: builds the zip bytes. Frames repeated in `frameIds` are stored once. */
export function buildArchive(
  meta: ArchiveMeta,
  frames: ArchiveFrameInput[],
  frameIds: string[],
  audio?: ArchiveAudioInput,
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
  // Sounds are numbered by first use in the clips; unreferenced sounds are left out.
  const soundById = new Map((audio?.sounds ?? []).map((snd) => [snd.id, snd]));
  const soundPathById = new Map<string, string>();
  const soundInfo: Record<string, { duration: number; kind: Sound['kind'] }> = {};
  const clipsJson: { sound: string; startFrame: number; offset: number; duration: number }[] = [];
  for (const clip of audio?.clips ?? []) {
    let path = soundPathById.get(clip.soundId);
    if (!path) {
      const snd = soundById.get(clip.soundId);
      if (!snd) throw new ArchiveError('brokenFrames', `Sound ${clip.soundId} not found`);
      path = `sounds/${String(soundPathById.size + 1).padStart(4, '0')}.wav`;
      soundPathById.set(clip.soundId, path);
      // PCM WAV compresses reasonably well; level 6 is fast enough for a few MB.
      files[path] = [snd.bytes, { level: 6 }];
      soundInfo[path] = { duration: snd.duration, kind: snd.kind };
    }
    clipsJson.push({ sound: path, startFrame: clip.startFrame, offset: clip.offset, duration: clip.duration });
  }
  const json = {
    app: 'stopmoergel',
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: meta.name, fps: meta.fps, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    frames: order,
    frameInfo,
    sounds: soundInfo,
    audioClips: clipsJson,
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
  const { sounds, audioClips } = json.formatVersion >= 2 ? parseAudio(json, entries) : { sounds: [], audioClips: [] };
  return { name: rawName || 'Film', fps, createdAt, frames, sounds, audioClips };
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAudio(json: any, entries: Record<string, Uint8Array>) {
  const info = json.sounds && typeof json.sounds === 'object' ? json.sounds : {};
  const clipsRaw: unknown = json.audioClips ?? [];
  if (!Array.isArray(clipsRaw)) throw new ArchiveError('brokenFrames', 'audioClips is not a list');
  const cache = new Map<string, ParsedArchive['sounds'][number]>();
  const audioClips: ParsedArchive['audioClips'] = [];
  for (const c of clipsRaw) {
    const path: unknown = c?.sound;
    if (typeof path !== 'string' || !SOUND_PATH.test(path)) {
      throw new ArchiveError('brokenFrames', `Bad sound path: ${String(path)}`);
    }
    if (!num(c.startFrame) || !num(c.offset) || !num(c.duration) || c.offset < 0 || c.duration <= 0) {
      throw new ArchiveError('brokenFrames', 'Bad clip numbers');
    }
    let sound = cache.get(path);
    if (!sound) {
      const data = own(entries, path) ? entries[path] : undefined;
      const si = own(info, path) ? info[path] : undefined;
      if (!data || data.length === 0 || !si || typeof si !== 'object') {
        throw new ArchiveError('brokenFrames', `Sound missing: ${path}`);
      }
      if (!num(si.duration) || si.duration <= 0) throw new ArchiveError('brokenFrames', 'Bad sound duration');
      sound = { path, bytes: data, duration: si.duration, kind: si.kind === 'music' ? 'music' : 'recording' };
      cache.set(path, sound);
    }
    audioClips.push({
      soundPath: path,
      startFrame: Math.max(0, Math.round(c.startFrame)),
      offset: c.offset,
      duration: c.duration,
    });
  }
  return { sounds: [...cache.values()], audioClips };
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
  const soundIds = [...new Set(project.audioClips.map((c) => c.soundId))];
  const storedSounds = await getSounds(soundIds);
  const sounds: ArchiveSoundInput[] = [];
  for (const snd of storedSounds.values()) {
    sounds.push({
      id: snd.id,
      duration: snd.duration,
      kind: snd.kind,
      bytes: new Uint8Array(await snd.blob.arrayBuffer()),
    });
  }
  // Clips whose sound is gone from the db are dropped rather than failing the backup.
  const clips = project.audioClips.filter((c) => storedSounds.has(c.soundId));
  const bytes = buildArchive(project, frames, project.frameIds, { sounds, clips });
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
    const idBySound = new Map<string, string>();
    for (const snd of parsed.sounds) {
      const stored = await addSound(
        project.id,
        new Blob([snd.bytes as BlobPart], { type: 'audio/wav' }),
        snd.duration,
        snd.kind,
      );
      idBySound.set(snd.path, stored.id);
    }
    const audioClips: AudioClip[] = parsed.audioClips.map((c) => ({
      id: crypto.randomUUID(),
      soundId: idBySound.get(c.soundPath) as string,
      startFrame: c.startFrame,
      offset: c.offset,
      duration: c.duration,
    }));
    return await saveProject({ ...project, fps: parsed.fps, frameIds, audioClips });
  } catch (error) {
    await deleteProject(project.id).catch(() => undefined);
    throw error;
  }
}

/** True if the file name looks like something we can import (.zip). */
export function looksLikeArchive(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.zip');
}
