import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from './db';
import { clamp, insertAt, moveItem, removeAt } from './frames';
import { MAX_FPS, MIN_FPS, type AudioClip, type Frame, type Project, type Sound } from './types';
import { decodeAudio } from './audio/context';
import { computePeaks } from './audio/peaks';
import { clipEndFrame, splitClip as splitClipPure } from './audio/clips';

const UNDO_LIMIT = 50;

/** A stored sound plus its decoded audio (null while decoding / if decoding failed) and waveform peaks. */
export interface SoundInfo {
  sound: Sound;
  buffer: AudioBuffer | null;
  peaks: Float32Array | null;
}

/** What undo restores: the editable "timeline" part of the project. */
interface Snapshot {
  frameIds: string[];
  audioClips: AudioClip[];
}

export interface ProjectApi {
  status: 'loading' | 'ready' | 'missing';
  project: Project | null;
  /** Object URL per frame id (for <img> / player). */
  urls: ReadonlyMap<string, string>;
  addFrame: (blob: Blob, width: number, height: number) => Promise<void>;
  deleteFrame: (index: number) => void;
  /** Inserts a copy right after `index`. Copies share the same stored image (same id). */
  duplicateFrame: (index: number) => void;
  moveFrame: (from: number, to: number) => void;
  setFps: (fps: number) => void;
  rename: (name: string) => void;
  /** Sounds by id. */
  sounds: ReadonlyMap<string, SoundInfo>;
  /**
   * Stores a sound and puts a clip for it at `startFrame`. `trimStart` seconds are skipped at the
   * beginning (used to remove the recording lead-in before the movie started). Returns the new clip id.
   */
  addSound: (blob: Blob, duration: number, kind: Sound['kind'], startFrame: number, trimStart?: number) => Promise<string | null>;
  /** Replace a clip (move / trim). Undoable. */
  updateClip: (clip: AudioClip) => void;
  deleteClip: (id: string) => void;
  /** Copy placed right after the original. Returns the new clip id. */
  duplicateClip: (id: string) => string | null;
  /** Split at a frame position. Returns the id of the right part, or null if not possible. */
  splitClip: (id: string, atFrame: number) => string | null;
  /** Decoded buffers by sound id (for playback / export mixdown). */
  getAudioBuffers: () => Map<string, AudioBuffer>;
  undo: () => void;
  canUndo: boolean;
  /** Frame blobs in movie order, for export. */
  getBlobs: () => Blob[];
  /** Resolves once all pending writes to the database are done. */
  flush: () => Promise<void>;
}

/**
 * Loads one project and exposes every edit operation. Each change is persisted immediately
 * (writes are serialized). Undo works on `frameIds` snapshots; frame blobs stay in the DB until
 * garbage-collected the next time the project is opened.
 */
export function useProject(projectId: string): ProjectApi {
  const [status, setStatus] = useState<ProjectApi['status']>('loading');
  const [project, setProject] = useState<Project | null>(null);
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const undoStack = useRef<Snapshot[]>([]);
  const [sounds, setSounds] = useState<ReadonlyMap<string, SoundInfo>>(new Map());
  const soundsRef = useRef(new Map<string, SoundInfo>());
  const [undoCount, setUndoCount] = useState(0);

  const framesRef = useRef(new Map<string, Frame>());
  const urlsRef = useRef(new Map<string, string>());
  const projectRef = useRef<Project | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const registerFrame = useCallback((frame: Frame) => {
    framesRef.current.set(frame.id, frame);
    if (!urlsRef.current.has(frame.id)) {
      urlsRef.current.set(frame.id, URL.createObjectURL(frame.blob));
    }
  }, []);

  /** Adds sounds to the map right away, then decodes them in the background. */
  const registerSounds = useCallback((list: Sound[], isCancelled: () => boolean) => {
    for (const sound of list) soundsRef.current.set(sound.id, { sound, buffer: null, peaks: null });
    setSounds(new Map(soundsRef.current));
    for (const sound of list) {
      decodeAudio(sound.blob)
        .then((buffer) => {
          if (isCancelled()) return;
          soundsRef.current.set(sound.id, { sound, buffer, peaks: computePeaks(buffer) });
          setSounds(new Map(soundsRef.current));
        })
        .catch((err) => console.error('could not decode sound', err));
    }
  }, []);

  // Load
  useEffect(() => {
    let cancelled = false;
    const frames = framesRef.current;
    const objectUrls = urlsRef.current;
    (async () => {
      await db.collectGarbage(projectId);
      const p = await db.getProject(projectId);
      if (cancelled) return;
      if (!p) {
        setStatus('missing');
        return;
      }
      const loaded = await db.getFrames([...new Set(p.frameIds)]);
      if (cancelled) return;
      loaded.forEach(registerFrame);
      // Drop ids whose blob is gone (should not happen, but never show broken frames).
      const frameIds = p.frameIds.filter((id) => loaded.has(id));
      const storedSounds = await db.getSounds([...new Set(p.audioClips.map((c) => c.soundId))]);
      if (cancelled) return;
      const audioClips = p.audioClips.filter((c) => storedSounds.has(c.soundId));
      registerSounds([...storedSounds.values()], () => cancelled);
      const clean = { ...p, frameIds, audioClips };
      projectRef.current = clean;
      setProject(clean);
      setUrls(new Map(objectUrls));
      setStatus('ready');
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setStatus('missing');
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
      objectUrls.clear();
      frames.clear();
      soundsRef.current.clear();
    };
  }, [projectId, registerFrame, registerSounds]);

  /** Apply a change to the project, persist it, optionally record an undo snapshot. */
  const commit = useCallback((change: (p: Project) => Project, undoable: boolean) => {
    const prev = projectRef.current;
    if (!prev) return;
    const next = change(prev);
    if (next === prev) return;
    if (undoable) {
      undoStack.current = [
        ...undoStack.current.slice(-(UNDO_LIMIT - 1)),
        { frameIds: prev.frameIds, audioClips: prev.audioClips },
      ];
      setUndoCount(undoStack.current.length);
    }
    projectRef.current = next;
    setProject(next);
    saveChain.current = saveChain.current.then(() => db.saveProject(next)).catch((e) => console.error('save failed', e));
  }, []);

  const addFrame = useCallback(
    async (blob: Blob, width: number, height: number) => {
      const p = projectRef.current;
      if (!p) return;
      const frame = await db.addFrame(p.id, blob, width, height);
      registerFrame(frame);
      setUrls(new Map(urlsRef.current));
      commit((cur) => ({ ...cur, frameIds: [...cur.frameIds, frame.id] }), true);
    },
    [commit, registerFrame],
  );

  const deleteFrame = useCallback(
    (index: number) => commit((p) => ({ ...p, frameIds: removeAt(p.frameIds, index) }), true),
    [commit],
  );

  const duplicateFrame = useCallback(
    (index: number) =>
      commit((p) => (p.frameIds[index] ? { ...p, frameIds: insertAt(p.frameIds, index + 1, p.frameIds[index]) } : p), true),
    [commit],
  );

  const moveFrame = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      commit((p) => ({ ...p, frameIds: moveItem(p.frameIds, from, to) }), true);
    },
    [commit],
  );

  const setFps = useCallback(
    (fps: number) => commit((p) => ({ ...p, fps: clamp(Math.round(fps), MIN_FPS, MAX_FPS) }), false),
    [commit],
  );

  const rename = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 40);
      if (trimmed) commit((p) => ({ ...p, name: trimmed }), false);
    },
    [commit],
  );

  const addSound = useCallback(
    async (blob: Blob, duration: number, kind: Sound['kind'], startFrame: number, trimStart = 0) => {
      const p = projectRef.current;
      const offset = Math.max(0, Math.min(trimStart, duration - 0.1));
      if (!p || duration - offset <= 0.05) return null;
      const sound = await db.addSound(p.id, blob, duration, kind);
      registerSounds([sound], () => false);
      const clip: AudioClip = {
        id: crypto.randomUUID(),
        soundId: sound.id,
        startFrame: Math.max(0, Math.round(startFrame)),
        offset,
        duration: duration - offset,
      };
      commit((cur) => ({ ...cur, audioClips: [...cur.audioClips, clip] }), true);
      return clip.id;
    },
    [commit, registerSounds],
  );

  const updateClip = useCallback(
    (clip: AudioClip) =>
      commit((p) => {
        const old = p.audioClips.find((c) => c.id === clip.id);
        if (!old || (old.startFrame === clip.startFrame && old.offset === clip.offset && old.duration === clip.duration)) return p;
        return { ...p, audioClips: p.audioClips.map((c) => (c.id === clip.id ? clip : c)) };
      }, true),
    [commit],
  );

  const deleteClip = useCallback(
    (id: string) => commit((p) => ({ ...p, audioClips: p.audioClips.filter((c) => c.id !== id) }), true),
    [commit],
  );

  const duplicateClip = useCallback(
    (id: string) => {
      const p = projectRef.current;
      const src = p?.audioClips.find((c) => c.id === id);
      if (!p || !src) return null;
      const copy: AudioClip = { ...src, id: crypto.randomUUID(), startFrame: Math.ceil(clipEndFrame(src, p.fps) - 1e-6) };
      commit((cur) => ({ ...cur, audioClips: [...cur.audioClips, copy] }), true);
      return copy.id;
    },
    [commit],
  );

  const splitClip = useCallback(
    (id: string, atFrame: number) => {
      const p = projectRef.current;
      const src = p?.audioClips.find((c) => c.id === id);
      if (!p || !src) return null;
      const parts = splitClipPure(src, atFrame, p.fps, crypto.randomUUID());
      if (!parts) return null;
      commit((cur) => ({ ...cur, audioClips: cur.audioClips.flatMap((c) => (c.id === id ? parts : [c])) }), true);
      return parts[1].id;
    },
    [commit],
  );

  const getAudioBuffers = useCallback(() => {
    const out = new Map<string, AudioBuffer>();
    soundsRef.current.forEach((info, id) => info.buffer && out.set(id, info.buffer));
    return out;
  }, []);

  const undo = useCallback(() => {
    const snap = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (snap) commit((p) => ({ ...p, frameIds: snap.frameIds, audioClips: snap.audioClips }), false);
  }, [commit]);

  const getBlobs = useCallback(
    () =>
      (projectRef.current?.frameIds ?? [])
        .map((id) => framesRef.current.get(id)?.blob)
        .filter((b): b is Blob => !!b),
    [],
  );

  const flush = useCallback(() => saveChain.current.then(() => undefined), []);

  return {
    flush,
    status,
    project,
    urls,
    addFrame,
    deleteFrame,
    duplicateFrame,
    moveFrame,
    setFps,
    rename,
    sounds,
    addSound,
    updateClip,
    deleteClip,
    duplicateClip,
    splitClip,
    getAudioBuffers,
    undo,
    canUndo: undoCount > 0,
    getBlobs,
  };
}
