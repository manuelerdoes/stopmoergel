import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera } from 'lucide-react';
import { t } from '../../i18n';

interface TimelineProps {
  frameIds: string[];
  urls: ReadonlyMap<string, string>;
  /** Selected frame index, or null when the live camera is selected. */
  selected: number | null;
  /** Frame currently shown by the player (highlighted while playing). */
  playingIndex: number | null;
  onSelect: (index: number | null) => void;
  onMove: (from: number, to: number) => void;
}

interface DragState {
  from: number;
  pointerId: number;
  startX: number;
  x: number;
  /** Insertion slot 0..n (before which frame the dragged one lands). */
  slot: number;
  moved: boolean;
}

/**
 * Horizontal film strip. Tap a picture to select it; drag the *selected* picture to move it.
 * Only the selected thumb captures the pointer, so swiping elsewhere still scrolls the strip on touch.
 */
export function Timeline({ frameIds, urls, selected, playingIndex, onSelect, onMove }: TimelineProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const prevCount = useRef(frameIds.length);
  /** Swallow the click that browsers fire right after a drag ends. */
  const justDragged = useRef(false);

  // Scroll to the end when a new picture is added; keep the highlighted frame visible.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    if (frameIds.length > prevCount.current) {
      strip.scrollTo({ left: strip.scrollWidth, behavior: 'smooth' });
    }
    prevCount.current = frameIds.length;
  }, [frameIds.length]);

  const focusIndex = playingIndex ?? selected;
  useEffect(() => {
    if (focusIndex == null) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: playingIndex != null ? 'auto' : 'smooth' });
  }, [focusIndex, playingIndex]);

  const slotAt = (clientX: number): number => {
    const thumbs = stripRef.current?.querySelectorAll<HTMLElement>('[data-index]') ?? [];
    let slot = 0;
    thumbs.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (clientX > r.left + r.width / 2) slot = Number(el.dataset.index) + 1;
    });
    return slot;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (index !== selected || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, pointerId: e.pointerId, startX: e.clientX, x: e.clientX, slot: index, moved: false });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved = drag.moved || Math.abs(e.clientX - drag.startX) > 8;
    // Auto-scroll when dragging near the edges.
    const strip = stripRef.current;
    if (strip && moved) {
      const r = strip.getBoundingClientRect();
      if (e.clientX < r.left + 60) strip.scrollLeft -= 14;
      else if (e.clientX > r.right - 60) strip.scrollLeft += 14;
    }
    setDrag({ ...drag, x: e.clientX, moved, slot: slotAt(e.clientX) });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      // Slot is an insertion point in the original list; convert to target index after removal.
      const to = drag.slot > drag.from ? drag.slot - 1 : drag.slot;
      if (to !== drag.from) {
        onMove(drag.from, to);
        onSelect(to);
      }
    }
    setDrag(null);
  };

  return (
    <div className="timeline" ref={stripRef}>
      {frameIds.map((id, i) => {
        const isSelected = selected === i;
        const isDragging = drag?.moved && drag.from === i;
        const cls = [
          'timeline__thumb',
          isSelected ? 'is-selected' : '',
          playingIndex === i ? 'is-playing' : '',
          isDragging ? 'is-dragging' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div className="timeline__slot" key={`${id}-${i}`}>
            {drag?.moved && drag.slot === i && <div className="timeline__drop" />}
            <button
              type="button"
              data-index={i}
              className={cls}
              style={isDragging ? { transform: `translateX(${drag.x - drag.startX}px) scale(1.08)` } : undefined}
              onClick={() => !justDragged.current && onSelect(isSelected ? null : i)}
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              aria-label={`${i + 1}`}
              aria-pressed={isSelected}
            >
              <img src={urls.get(id)} alt="" draggable={false} />
              <span className="timeline__num">{i + 1}</span>
            </button>
          </div>
        );
      })}
      {drag?.moved && drag.slot === frameIds.length && <div className="timeline__drop" />}
      <button
        type="button"
        className={`timeline__live ${selected === null && playingIndex === null ? 'is-selected' : ''}`}
        onClick={() => onSelect(null)}
        aria-label={t.live}
      >
        <Camera size={30} strokeWidth={2.5} />
        <span>{t.live}</span>
      </button>
    </div>
  );
}
