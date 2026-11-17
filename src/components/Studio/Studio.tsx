import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Mic,
  Music,
  Scissors,
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
import { PhoneLayout } from './PhoneLayout';
import { PHONE_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { AudioTrack } from './AudioTrack';
import { useSoundRecorder } from './useSoundRecorder';
import { useAudioPlayback } from '../../lib/audio/useAudioPlayback';
import { resumeAudio } from '../../lib/audio/context';
import { renderMix } from '../../lib/audio/mix';
import { audioFileToWav } from '../../lib/audio/recorder';
import { clipEndFrame, clipMiddleFrame } from '../../lib/audio/clips';
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
  const isPhone = useMediaQuery(PHONE_QUERY);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playFrom, setPlayFrom] = useState(0);
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
  const musicInput = useRef<HTMLInputElement>(null);

  const frameIds = useMemo(() => project?.frameIds ?? [], [project?.frameIds]);
  const count = frameIds.length;
  // Must be referentially stable, otherwise the player restarts on every render.
  const playUrls = useMemo(() => frameIds.map((id) => urls.get(id)).filter((u): u is string => !!u), [frameIds, urls]);
  // Selfie/laptop cameras feel natural mirrored; back cameras don't.
  const mirror = mirrorPref ?? cam.facingMode !== 'environment';
  const ghostUrl = ghost && count > 0 ? (urls.get(frameIds[count - 1]) ?? null) : null;
  const selectedUrl = selected != null && frameIds[selected] ? urls.get(frameIds[selected]) : undefined;

  const clips = useMemo(() => project?.audioClips ?? [], [project?.audioClips]);
  const fps = project?.fps ?? 8;
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  const audio = useAudioPlayback({ clips, fps, totalFrames: count, getBuffers: api.getAudioBuffers });

  const rec = useSoundRecorder({
    startPlayback: (startFrame) => {
      if (!count) return;
      setSelectedClipId(null);
      setPlayFrom(Math.min(startFrame, count - 1));
      setPlaying(true);
    },
    stopPlayback: () => {
      setPlaying(false);
      setPlayIndex(null);
    },
    onDone: (result, startFrame, leadIn) => {
      void api.addSound(result.blob, result.duration, 'recording', startFrame, leadIn).then((id) => {
        if (id) {
          setSelectedClipId(id);
          playPop();
        }
      });
    },
    onError: (err) => {
      console.error(err);
      const name = (err as DOMException)?.name;
      setToast({ message: name === 'NotAllowedError' || name === 'SecurityError' ? t.micDenied : name === 'NotFoundError' ? t.micMissing : t.exportFailed, undo: false });
    },
  });
  const recording = rec.phase !== 'idle';

  useEffect(() => {
    if (api.status === 'missing') onBack();
  }, [api.status, onBack]);

  // Silence the audio track whenever playback stops.
  useEffect(() => {
    if (!playing) audio.stopAll();
  }, [playing, audio.stopAll]);

  // Forget the clip selection if the clip disappears (undo, delete).
  useEffect(() => {
    if (selectedClipId && !selectedClip) setSelectedClipId(null);
  }, [selectedClipId, selectedClip]);

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
    if (!video || !canCapture || capturing || recording) return;
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
  }, [api, canCapture, capturing, mirror, recording]);

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
    if (recording) return;
    if (playing) {
      setPlaying(false);
      setPlayIndex(null);
    } else if (count > 0) {
      void resumeAudio();
      setPlayFrom(selected != null && selected < count - 1 ? selected : 0);
      setPlaying(true);
    }
  }, [playing, count, recording, selected]);

  const toggleRecording = () => {
    if (rec.phase === 'recording') void rec.stop();
    else if (rec.phase === 'countdown' || rec.phase === 'opening') rec.cancel();
    else if (rec.phase === 'idle') {
      setPlaying(false);
      void rec.start(selected ?? 0);
    }
  };

  const importMusic = async (file: File | undefined) => {
    if (!file) return;
    setToast({ message: t.musicLoading, undo: false });
    try {
      const { blob, duration } = await audioFileToWav(file);
      const id = await api.addSound(blob, duration, 'music', selected ?? 0);
      if (id) setSelectedClipId(id);
      playPop();
      setToast({ message: t.musicAdded, undo: false });
    } catch (err) {
      console.error(err);
      setToast({ message: t.soundImportFailed, undo: false });
    }
  };

  const selectClip = (id: string | null) => {
    setSelectedClipId(id);
    setPlaying(false);
  };

  // When a sound gets selected (tapped, just recorded, imported), put the scissors line inside it.
  // Only reacts to selection changes, so the child can still move the line anywhere afterwards.
  const placeScissorsFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedClip || placeScissorsFor.current === selectedClip.id) {
      if (!selectedClip) placeScissorsFor.current = null;
      return;
    }
    placeScissorsFor.current = selectedClip.id;
    if (!count) return;
    const end = clipEndFrame(selectedClip, fps);
    const inside = selected != null && selected > selectedClip.startFrame && selected < end;
    if (!inside) {
      const mid = clipMiddleFrame(selectedClip, fps);
      if (mid > selectedClip.startFrame && mid < Math.min(end, count)) setSelected(mid);
    }
  }, [selectedClip, selected, count, fps]);

  const cutClip = () => {
    if (!selectedClip) return;
    const right = selected != null ? api.splitClip(selectedClip.id, selected) : null;
    if (right) {
      setSelectedClipId(right);
      playPop();
    } else {
      setToast({ message: t.cutHint, undo: false });
    }
  };

  const deleteClip = useCallback(() => {
    if (!selectedClipId) return;
    api.deleteClip(selectedClipId);
    setSelectedClipId(null);
    playWhoosh();
    setToast({ message: t.soundDeleted, undo: true });
  }, [api, selectedClipId]);

  const duplicateClip = () => {
    if (!selectedClipId) return;
    const id = api.duplicateClip(selectedClipId);
    if (id) setSelectedClipId(id);
    playPop();
  };

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
      if (exportOpen || renameOpen || saveOpen || recording) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea')) return;
      if (e.key === ' ') {
        // Space always takes a picture. Blur first so a focused button isn't "clicked" on keyup.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        if (!e.repeat) void capture();
      } else if (e.key.toLowerCase() === 'p') {
        togglePlay();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault();
        deleteClip();
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
        if (selectedClipId) setSelectedClipId(null);
        else setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, togglePlay, deleteSelected, deleteClip, undo, selected, selectedClipId, count, exportOpen, renameOpen, saveOpen, recording]);

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

  const openSave = () => (count > 0 ? setSaveOpen(true) : setToast({ message: t.needFrames, undo: false }));
  const showActions = !playing && !recording && !!(selectedClip || selectedUrl);

  // ---- Pieces shared by the desktop and the phone layout ----
  const stageBase = (
    <>
            <CameraView
              videoRef={videoRef}
              stream={cam.stream}
              status={cam.status}
              needsPermission={cam.needsPermission}
              slow={cam.slow}
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
              </div>
            )}
    </>
  );
  const actionButtons = showActions ? (
    <>
                {selectedClip ? (
                  <>
                    <BigButton color="yellow" icon={<Scissors />} label={t.cut} onClick={cutClip} />
                    <BigButton color="white" icon={<Copy />} label={t.duplicate} onClick={duplicateClip} />
                    <BigButton color="red" icon={<Trash2 />} label={t.deleteSound} onClick={deleteClip} />
                  </>
                ) : (
                  <>
                    <BigButton color="white" icon={<Copy />} label={t.duplicate} onClick={duplicateSelected} />
                    <BigButton color="red" icon={<Trash2 />} label={t.deleteFrame} onClick={deleteSelected} />
                  </>
                )}
              </>
  ) : null;
  const stageOverlays = (
    <>
            {playing && (
              <div className="stage__player">
                <Player
                  urls={playUrls}
                  fps={project.fps}
                  loop={loop}
                  startIndex={playFrom}
                  onIndex={setPlayIndex}
                  onEnd={onPlayEnd}
                  holdLastFrame={recording}
                  onSync={(i) => (recording ? rec.markPlaybackStart() : audio.syncFrom(i))}
                />
              </div>
            )}
            {flashKey > 0 && <div key={flashKey} className="stage__flash" aria-hidden />}
            {rec.phase === 'countdown' && (
              <div className="stage__countdown" aria-live="assertive">
                <span key={rec.count}>{rec.count}</span>
              </div>
            )}
            {(rec.phase === 'recording' || rec.phase === 'countdown') && (
              <div className="stage__rec">
                <span className="stage__rec-dot" />
                <span>{rec.phase === 'recording' ? `${t.recording} ${formatTime(rec.elapsed)}` : t.recordSound}</span>
                <span className="stage__meter" aria-hidden>
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} className={rec.level * 10 > i ? 'is-on' : ''} />
                  ))}
                </span>
              </div>
            )}
    </>
  );
  const captureButton = (
          <button
            type="button"
            className="studio__capture"
            onClick={() => void capture()}
            disabled={!canCapture || recording}
            aria-label={t.takePicture}
          >
            <span className="studio__capture-inner" />
            <span className="studio__capture-label">{t.takePicture}</span>
          </button>
  );
  const hiddenInputs = (
    <>
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
        <input
          ref={musicInput}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            void importMusic(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
    </>
  );
  const timelineEl = (
      <Timeline
        frameIds={frameIds}
        urls={urls}
        selected={selected}
        playingIndex={playing ? playIndex : null}
        onSelect={(i) => {
          if (recording) return;
          setPlaying(false);
          // With a sound selected, tapping a picture moves the scissors line; "Live" ends sound editing.
          if (i === null) setSelectedClipId(null);
          setSelected(i);
        }}
        onMove={api.moveFrame}
        playhead={playing ? playIndex : selectedClip ? selected : null}
        scissors={!!selectedClip && !playing}
        audio={
          <AudioTrack
            clips={clips}
            sounds={api.sounds}
            fps={fps}
            frameCount={count}
            selectedClipId={selectedClipId}
            onSelectClip={(id) => !recording && selectClip(id)}
            onChangeClip={api.updateClip}
          />
        }
      />

  );
  const dialogsEl = (
    <>
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

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        getBlobs={api.getBlobs}
        getAudio={() => renderMix(project.audioClips, api.getAudioBuffers(), project.fps, count / project.fps)}
        fps={project.fps}
        name={project.name}
      />

      <RenameDialog open={renameOpen} name={project.name} onClose={() => setRenameOpen(false)} onRename={api.rename} />
    </>
  );

  if (isPhone) {
    const ghostBtn = (icon: ReactNode, label: string, onClick: () => void, active?: boolean, disabled?: boolean) => (
      <BigButton color="ghost" icon={icon} aria-label={label} title={label} active={active} onClick={onClick} disabled={disabled} />
    );
    return (
      <>
        <PhoneLayout
          aspect={aspect}
          stage={
            <>
              {stageBase}
              {stageOverlays}
            </>
          }
          actions={actionButtons}
          timeline={timelineEl}
          back={ghostBtn(<ArrowLeft />, t.back, onBack)}
          title={
            <button type="button" className="pstudio__name" onClick={() => setRenameOpen(true)} title={t.rename}>
              <span>{project.name}</span>
              <small>{t.frames(count)}</small>
            </button>
          }
          save={<BigButton color="green" icon={<Download />} aria-label={t.save} title={t.save} onClick={openSave} disabled={recording} />}
          tools={
            <>
              {ghostBtn(<Ghost />, t.ghost, () => setGhost((g) => !g), ghost)}
              {ghostBtn(<Grid3x3 />, t.grid, () => setGrid((g) => !g), grid)}
              {ghostBtn(<FlipHorizontal2 />, t.mirror, toggleMirror, mirror)}
              {cam.devices.length > 1 && ghostBtn(<SwitchCamera />, t.switchCamera, cam.switchCamera)}
              {ghostBtn(<ImagePlus />, t.importPictures, () => fileInput.current?.click())}
            </>
          }
          undo={ghostBtn(<Undo2 />, t.undo, undo, false, !api.canUndo)}
          loop={ghostBtn(<Repeat />, t.loop, () => setLoop((l) => !l), loop)}
          speedPanel={<SpeedControl fps={project.fps} onChange={api.setFps} />}
          fps={project.fps}
          play={
            <BigButton
              color={playing && !recording ? 'red' : 'primary'}
              icon={playing && !recording ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
              aria-label={playing && !recording ? t.stop : t.play}
              onClick={togglePlay}
              disabled={count === 0 || recording}
            />
          }
          mic={
            <BigButton
              color={recording ? 'red' : 'pink'}
              icon={recording ? <Square fill="currentColor" /> : <Mic />}
              aria-label={recording ? t.stop : t.recordSound}
              onClick={toggleRecording}
              className={`studio__mic ${rec.phase === 'recording' ? 'is-recording' : ''}`}
            />
          }
          capture={captureButton}
          music={<BigButton color="blue" icon={<Music />} aria-label={t.music} onClick={() => musicInput.current?.click()} disabled={recording} />}
          recording={recording}
        />
        {hiddenInputs}
        {dialogsEl}
      </>
    );
  }

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
          onClick={openSave}
          disabled={recording}
          className="studio__save"
        />
      </header>

      <main className="studio__main">
        <div className="stage">
          <div className="stage__frame" style={{ ['--ar' as string]: aspect }}>
            {stageBase}
            {actionButtons && <div className="stage__still-actions">{actionButtons}</div>}
            {stageOverlays}
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
          </div>
          {captureButton}
        </aside>
      </main>

      <div className="studio__bar">
        <BigButton
          color={playing && !recording ? 'red' : 'primary'}
          icon={playing && !recording ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
          label={playing && !recording ? t.stop : t.play}
          onClick={togglePlay}
          disabled={count === 0 || recording}
          className="studio__play"
        />
        <BigButton
          color={recording ? 'red' : 'pink'}
          icon={recording ? <Square fill="currentColor" /> : <Mic />}
          label={recording ? t.stop : t.recordSound}
          onClick={toggleRecording}
          className={`studio__mic ${rec.phase === 'recording' ? 'is-recording' : ''}`}
        />
        <BigButton color="blue" icon={<Music />} label={t.music} onClick={() => musicInput.current?.click()} disabled={recording} />
        <BigButton color="white" icon={<Repeat />} label={t.loop} active={loop} onClick={() => setLoop((l) => !l)} />
        <SpeedControl fps={project.fps} onChange={api.setFps} />
        <BigButton color="white" icon={<Undo2 />} label={t.undo} onClick={undo} disabled={!api.canUndo} />
      </div>

      {timelineEl}

      {hiddenInputs}
      {dialogsEl}
    </div>
  );
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
