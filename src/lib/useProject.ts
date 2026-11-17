import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from './db';
import { clamp, insertAt, moveItem, removeAt } from './frames';
import { MAX_FPS, MIN_FPS, type Frame, type Project } from './types';

const UNDO_LIMIT = 50;

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
  const undoStack = useRef<string[][]>([]);
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
      const clean = { ...p, frameIds };
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
    };
  }, [projectId, registerFrame]);

  /** Apply a change to the project, persist it, optionally record an undo snapshot. */
  const commit = useCallback((change: (p: Project) => Project, undoable: boolean) => {
    const prev = projectRef.current;
    if (!prev) return;
    const next = change(prev);
    if (next === prev) return;
    if (undoable) {
      undoStack.current = [...undoStack.current.slice(-(UNDO_LIMIT - 1)), prev.frameIds];
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

  const undo = useCallback(() => {
    const frameIds = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (frameIds) commit((p) => ({ ...p, frameIds }), false);
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
    undo,
    canUndo: undoCount > 0,
    getBlobs,
  };
}
