import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Download,
  Ghost,
  Grid3x3,
  ImagePlus,
  Loader2,
  Play,
  Repeat,
  Square,
  SwitchCamera,
  FlipHorizontal2,
  Trash2,
  Undo2,
  Pencil,
} from 'lucide-react';
import { t } from '../../i18n';
import { useCamera } from '../../lib/camera';
import { captureFrame, imageFileToFrame } from '../../lib/capture';
import { playPop, playShutter, playWhoosh } from '../../lib/sounds';
import { useProject } from '../../lib/useProject';
import { BigButton } from '../ui/BigButton';
import { Dialog } from '../ui/Dialog';
import { Toast } from '../ui/Toast';
import { CameraView } from './CameraView';
import { ExportDialog } from './ExportDialog';
import { SaveDialog } from './SaveDialog';
import { exportProjectArchive } from '../../lib/projectArchive';
import { downloadBlob } from '../../lib/download';
import { Player } from './Player';
import { SpeedControl } from './SpeedControl';
import { Timeline } from './Timeline';
import './Studio.css';

interface StudioProps {
  projectId: string;
  onBack: () => void;
}

const MIRROR_KEY = 'stopmoergel.mirror';

function loadMirror(): boolean | null {
  try {
    const v = localStorage.getItem(MIRROR_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export function Studio({ projectId, onBack }: StudioProps) {
  const api = useProject(projectId);
  const { project, urls } = api;
  const cam = useCamera(api.status === 'ready');
  const videoRef = useRef<HTMLVideoElement>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(0.4);
  const [grid, setGrid] = useState(false);
  const [mirrorPref, setMirrorPref] = useState<boolean | null>(loadMirror);
  const [aspect, setAspect] = useState(16 / 9);
  const [flashKey, setFlashKey] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const canCapture = cam.status === 'ready' && videoReady;
  const [toast, setToast] = useState<{ message: string; undo: boolean } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const frameIds = useMemo(() => project?.frameIds ?? [], [project?.frameIds]);
  const count = frameIds.length;
  // Must be referentially stable, otherwise the player restarts on every render.
  const playUrls = useMemo(() => frameIds.map((id) => urls.get(id)).filter((u): u is string => !!u), [frameIds, urls]);
  // Selfie/laptop cameras feel natural mirrored; back cameras don't.
  const mirror = mirrorPref ?? cam.facingMode !== 'environment';
  const ghostUrl = ghost && count > 0 ? (urls.get(frameIds[count - 1]) ?? null) : null;
  const selectedUrl = selected != null && frameIds[selected] ? urls.get(frameIds[selected]) : undefined;

  useEffect(() => {
    if (api.status === 'missing') onBack();
  }, [api.status, onBack]);

  // Keep selection valid when frames disappear (undo, delete).
  useEffect(() => {
    if (selected != null && selected >= count) setSelected(count ? count - 1 : null);
  }, [count, selected]);

  const toggleMirror = () => {
    const next = !mirror;
    setMirrorPref(next);
    try {
      localStorage.setItem(MIRROR_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !canCapture || capturing) return;
    setCapturing(true);
    setPlaying(false);
    setSelected(null);
    try {
      playShutter();
      setFlashKey((k) => k + 1);
      const shot = await captureFrame(video, { mirror });
      await api.addFrame(shot.blob, shot.width, shot.height);
    } catch (err) {
      console.error(err);
    } finally {
      setCapturing(false);
    }
  }, [api, canCapture, capturing, mirror]);

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    setSelected(null);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const img = await imageFileToFrame(file);
        await api.addFrame(img.blob, img.width, img.height);
      } catch (err) {
        console.error(err);
      }
    }
    playPop();
  };

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      setPlayIndex(null);
    } else if (count > 0) {
      setPlaying(true);
    }
  }, [playing, count]);

  const deleteSelected = useCallback(() => {
    if (selected == null) return;
    api.deleteFrame(selected);
    playWhoosh();
    const remaining = count - 1;
    setSelected(remaining > 0 ? Math.min(selected, remaining - 1) : null);
    setToast({ message: t.frameDeleted, undo: true });
  }, [api, selected, count]);

  const duplicateSelected = useCallback(() => {
    if (selected == null) return;
    api.duplicateFrame(selected);
    playPop();
    setSelected(selected + 1);
  }, [api, selected]);

  const saveProjectFile = async () => {
    setSaveOpen(false);
    if (!project) return;
    try {
      await api.flush();
      const { blob, fileName } = await exportProjectArchive(project.id);
      downloadBlob(blob, fileName);
      playPop();
      setToast({ message: t.projectSaved, undo: false });
    } catch (err) {
      console.error(err);
      setToast({ message: t.exportFailed, undo: false });
    }
  };

  const undo = useCallback(() => {
    api.undo();
    setToast(null);
    playPop();
  }, [api]);

  // Keyboard shortcuts: Space/Enter = picture, P = play, Delete = delete, Ctrl+Z = undo, arrows = select.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportOpen || renameOpen || saveOpen) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea')) return;
      if (e.key === ' ') {
        // Space always takes a picture. Blur first so a focused button isn't "clicked" on keyup.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        if (!e.repeat) void capture();
      } else if (e.key.toLowerCase() === 'p') {
        togglePlay();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      } else if (e.key === 'ArrowLeft' && count > 0) {
        setSelected((s) => (s == null ? count - 1 : Math.max(0, s - 1)));
      } else if (e.key === 'ArrowRight') {
        setSelected((s) => (s == null || s >= count - 1 ? null : s + 1));
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, togglePlay, deleteSelected, undo, selected, count, exportOpen, renameOpen, saveOpen]);

  const onPlayEnd = useCallback(() => {
    setPlaying(false);
    setPlayIndex(null);
  }, []);

  if (api.status === 'loading') {
    return (
      <div className="studio studio--center">
        <Loader2 className="spin" size={64} />
      </div>
    );
  }
  if (api.status === 'missing' || !project) return null;

  return (
    <div className="studio">
      <header className="studio__top">
        <BigButton color="white" icon={<ArrowLeft />} label={t.back} onClick={onBack} className="studio__back" />
        <button type="button" className="studio__title" onClick={() => setRenameOpen(true)} title={t.rename}>
          <span>{project.name}</span>
          <Pencil size={20} />
        </button>
        <BigButton
          color="green"
          icon={<Download />}
          label={t.save}
          onClick={() => (count > 0 ? setSaveOpen(true) : setToast({ message: t.needFrames, undo: false }))}
          className="studio__save"
        />
      </header>

      <main className="studio__main">
        <div className="stage">
          <div className="stage__frame" style={{ ['--ar' as string]: aspect }}>
            <CameraView
              videoRef={videoRef}
              stream={cam.stream}
              status={cam.status}
              mirror={mirror}
              ghostUrl={selected == null && !playing ? ghostUrl : null}
              ghostOpacity={ghostOpacity}
              showGrid={grid}
              onAspect={setAspect}
              onVideoReady={setVideoReady}
              onRetry={cam.retry}
            />
            {selectedUrl && !playing && (
              <div className="stage__still">
                <img src={selectedUrl} alt="" draggable={false} />
                <div className="stage__still-actions">
                  <BigButton color="white" icon={<Copy />} label={t.duplicate} onClick={duplicateSelected} />
                  <BigButton color="red" icon={<Trash2 />} label={t.deleteFrame} onClick={deleteSelected} />
                </div>
              </div>
            )}
            {playing && (
              <div className="stage__player">
                <Player
                  urls={playUrls}
                  fps={project.fps}
                  loop={loop}
                  startIndex={selected != null && selected < count - 1 ? selected : 0}
                  onIndex={setPlayIndex}
                  onEnd={onPlayEnd}
                />
              </div>
            )}
            {flashKey > 0 && <div key={flashKey} className="stage__flash" aria-hidden />}
            <div className="stage__counter">{t.frames(count)}</div>
          </div>
        </div>

        <aside className="studio__tools">
          <div className="studio__toggles">
            <BigButton color="ghost" stacked icon={<Ghost />} label={t.ghost} active={ghost} onClick={() => setGhost((g) => !g)} />
            {ghost && (
              <input
                className="studio__ghost-slider"
                type="range"
                min={0.15}
                max={0.8}
                step={0.05}
                value={ghostOpacity}
                aria-label={t.ghost}
                onChange={(e) => setGhostOpacity(Number(e.target.value))}
              />
            )}
            <BigButton color="ghost" stacked icon={<Grid3x3 />} label={t.grid} active={grid} onClick={() => setGrid((g) => !g)} />
            <BigButton color="ghost" stacked icon={<FlipHorizontal2 />} label={t.mirror} active={mirror} onClick={toggleMirror} />
            {cam.devices.length > 1 && (
              <BigButton color="ghost" stacked icon={<SwitchCamera />} label={t.switchCamera} onClick={cam.switchCamera} />
            )}
            <BigButton color="ghost" stacked icon={<ImagePlus />} label={t.importPictures} onClick={() => fileInput.current?.click()} />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void importFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <button
            type="button"
            className="studio__capture"
            onClick={() => void capture()}
            disabled={!canCapture}
            aria-label={t.takePicture}
          >
            <span className="studio__capture-inner" />
            <span className="studio__capture-label">{t.takePicture}</span>
          </button>
        </aside>
      </main>

      <div className="studio__bar">
        <BigButton
          color={playing ? 'red' : 'primary'}
          icon={playing ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
          label={playing ? t.stop : t.play}
          onClick={togglePlay}
          disabled={count === 0}
          className="studio__play"
        />
        <BigButton color="white" icon={<Repeat />} label={t.loop} active={loop} onClick={() => setLoop((l) => !l)} />
        <SpeedControl fps={project.fps} onChange={api.setFps} />
        <BigButton color="white" icon={<Undo2 />} label={t.undo} onClick={undo} disabled={!api.canUndo} />
      </div>

      <Timeline
        frameIds={frameIds}
        urls={urls}
        selected={selected}
        playingIndex={playing ? playIndex : null}
        onSelect={(i) => {
          setPlaying(false);
          setSelected(i);
        }}
        onMove={api.moveFrame}
      />

      <Toast
        placement="top"
        message={toast?.message ?? null}
        onDone={() => setToast(null)}
        action={toast?.undo ? <BigButton color="yellow" icon={<Undo2 />} label={t.undo} onClick={undo} /> : undefined}
      />

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onVideo={() => {
          setSaveOpen(false);
          setExportOpen(true);
        }}
        onProject={() => void saveProjectFile()}
      />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} getBlobs={api.getBlobs} fps={project.fps} name={project.name} />

      <RenameDialog open={renameOpen} name={project.name} onClose={() => setRenameOpen(false)} onRename={api.rename} />
    </div>
  );
}

function RenameDialog({ open, name, onClose, onRename }: { open: boolean; name: string; onClose: () => void; onRename: (n: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);
  const submit = () => {
    if (value.trim()) onRename(value);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.movieName}
      actions={
        <>
          <BigButton color="white" label={t.cancel} onClick={onClose} />
          <BigButton color="green" label={t.ok} onClick={submit} />
        </>
      }
    >
      <input
        className="studio__rename-input"
        value={value}
        maxLength={40}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </Dialog>
  );
}
