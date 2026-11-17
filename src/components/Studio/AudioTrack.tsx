import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Mic, Music } from 'lucide-react';
import { t } from '../../i18n';
import { assignLanes, clipEndFrame, moveClip, trimClipEnd, trimClipStart } from '../../lib/audio/clips';
import { PEAKS_PER_SECOND } from '../../lib/audio/peaks';
import type { AudioClip } from '../../lib/types';
import type { SoundInfo } from '../../lib/useProject';

interface AudioTrackProps {
  clips: AudioClip[];
  sounds: ReadonlyMap<string, SoundInfo>;
  fps: number;
  frameCount: number;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  /** Commit a moved / trimmed clip (called once when the finger is lifted). */
  onChangeClip: (clip: AudioClip) => void;
}

type DragMode = 'move' | 'trimStart' | 'trimEnd';
interface Drag {
  mode: DragMode;
  pointerId: number;
  startX: number;
  /** px per frame at drag start (read from the CSS variable --pitch). */
  pitch: number;
  moved: boolean;
  preview: AudioClip;
}

const LANE_H = 52;

/**
 * The sound row under the picture strip. Same horizontal scale as the pictures (CSS var --pitch per frame),
 * so a clip under picture 20 starts exactly at picture 20. Overlapping clips go into extra lanes.
 * Tap = select; the selected clip can be dragged (snaps to pictures) and trimmed with its edge handles.
 */
export function AudioTrack({ clips, sounds, fps, frameCount, selectedClipId, onSelectClip, onChangeClip }: AudioTrackProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const justDragged = useRef(false);

  const { lanes, laneCount } = useMemo(() => assignLanes(clips, fps), [clips, fps]);
  const endFrames = clips.reduce((m, c) => Math.max(m, clipEndFrame(c, fps)), 0);

  const begin = (e: ReactPointerEvent<HTMLElement>, clip: AudioClip, mode: DragMode) => {
    if (clip.id !== selectedClipId || e.button !== 0) return;
    e.stopPropagation();
    const pitch = parseFloat(getComputedStyle(rowRef.current!).getPropertyValue('--pitch')) || 124;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode, pointerId: e.pointerId, startX: e.clientX, pitch, moved: false, preview: clip });
  };

  const move = (e: ReactPointerEvent<HTMLElement>, clip: AudioClip) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const moved = drag.moved || Math.abs(dx) > 6;
    if (!moved) return;
    const frames = dx / drag.pitch;
    const sound = sounds.get(clip.soundId)?.sound;
    let preview = clip;
    if (drag.mode === 'move') preview = moveClip(clip, clip.startFrame + Math.round(frames));
    else if (drag.mode === 'trimStart') preview = trimClipStart(clip, Math.round(frames), fps);
    else preview = trimClipEnd(clip, clip.duration + frames / fps, sound?.duration ?? clip.offset + clip.duration);
    setDrag({ ...drag, moved, preview });
  };

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    if (drag.moved) {
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      onChangeClip(drag.preview);
    }
    setDrag(null);
  };

  return (
    <div
      ref={rowRef}
      className={`audiotrack ${clips.length === 0 ? 'is-empty' : ''}`}
      style={{
        height: Math.max(1, laneCount) * LANE_H + 12,
        minWidth: `calc(var(--pitch) * ${Math.max(frameCount, endFrames) + 1})`,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !justDragged.current) onSelectClip(null);
      }}
    >
      {clips.length === 0 && (
        <div className="audiotrack__hint">
          <Mic size={22} />
          <Music size={22} />
          <span>{t.audioHint}</span>
        </div>
      )}

      {clips.map((clip) => {
        const shown = drag && clip.id === selectedClipId && drag.moved ? drag.preview : clip;
        const info = sounds.get(clip.soundId);
        const selected = clip.id === selectedClipId;
        const kind = info?.sound.kind ?? 'recording';
        return (
          <div
            key={clip.id}
            className={`aclip aclip--${kind} ${selected ? 'is-selected' : ''} ${drag?.moved && selected ? 'is-dragging' : ''}`}
            style={{
              left: `calc(var(--pitch) * ${shown.startFrame})`,
              width: `calc(var(--pitch) * ${shown.duration * fps})`,
              top: 6 + (lanes.get(clip.id) ?? 0) * LANE_H,
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!justDragged.current) onSelectClip(selected ? null : clip.id);
            }}
            onPointerDown={(e) => begin(e, clip, 'move')}
            onPointerMove={(e) => move(e, clip)}
            onPointerUp={end}
            onPointerCancel={() => setDrag(null)}
            role="button"
            aria-pressed={selected}
            aria-label={kind === 'music' ? t.music : t.sound}
          >
            <Waveform peaks={info?.peaks ?? null} offset={shown.offset} duration={shown.duration} />
            <span className="aclip__icon">{kind === 'music' ? <Music size={16} /> : <Mic size={16} />}</span>
            {selected && (
              <>
                <span
                  className="aclip__handle aclip__handle--start"
                  onPointerDown={(e) => begin(e, clip, 'trimStart')}
                  onPointerMove={(e) => move(e, clip)}
                  onPointerUp={end}
                />
                <span
                  className="aclip__handle aclip__handle--end"
                  onPointerDown={(e) => begin(e, clip, 'trimEnd')}
                  onPointerMove={(e) => move(e, clip)}
                  onPointerUp={end}
                />
              </>
            )}
          </div>
        );
      })}

      {/* Everything after the last picture is not part of the movie: fade it. */}
      <div className="audiotrack__past-end" style={{ left: `calc(var(--pitch) * ${frameCount})` }} aria-hidden />
    </div>
  );
}

/** Mirrored waveform envelope of the visible part of a sound, scaled to the clip box. */
const Waveform = memo(function Waveform({ peaks, offset, duration }: { peaks: Float32Array | null; offset: number; duration: number }) {
  const d = useMemo(() => {
    if (!peaks) return '';
    const from = Math.floor(offset * PEAKS_PER_SECOND);
    const to = Math.min(peaks.length, Math.ceil((offset + duration) * PEAKS_PER_SECOND));
    const n = to - from;
    if (n <= 0) return '';
    const step = Math.max(1, Math.ceil(n / 400)); // cap path size for long music
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < n; i += step) {
      let v = 0;
      for (let j = i; j < Math.min(n, i + step); j++) v = Math.max(v, peaks[from + j]);
      const h = Math.max(1.5, v * 46);
      top.push(`${i},${50 - h}`);
      bottom.unshift(`${i},${50 + h}`);
    }
    return `M0,50 L${top.join(' L')} L${n},50 L${bottom.join(' L')} Z`;
  }, [peaks, offset, duration]);

  const n = Math.max(1, Math.ceil(duration * PEAKS_PER_SECOND));
  return (
    <svg className="aclip__wave" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
      {d && <path d={d} />}
    </svg>
  );
});
