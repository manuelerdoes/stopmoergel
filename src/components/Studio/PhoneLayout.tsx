import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, GalleryHorizontal, Rabbit } from 'lucide-react';
import { t } from '../../i18n';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { BigButton } from '../ui/BigButton';
import './PhoneLayout.css';

interface PhoneLayoutProps {
  /** Contents of the stage frame (camera, still picture, player, overlays). */
  stage: ReactNode;
  aspect: number;
  /** Picture / sound actions, shown floating above the strip when something is selected. */
  actions: ReactNode;
  timeline: ReactNode;
  back: ReactNode;
  title: ReactNode;
  save: ReactNode;
  /** Left column: ghost, grid, mirror, camera, pictures. */
  tools: ReactNode;
  undo: ReactNode;
  loop: ReactNode;
  /** The turtle/rabbit slider, shown in a small floating panel. */
  speedPanel: ReactNode;
  fps: number;
  play: ReactNode;
  mic: ReactNode;
  capture: ReactNode;
  music: ReactNode;
  /** While recording, the mic (stop) button must stay visible even with hidden controls. */
  recording: boolean;
}

/**
 * Phone studio: the stage fills the whole screen, controls float around the edges.
 * 👁 hides everything except Foto!/Play(/Stop recording); ▤ toggles the picture + sound strip.
 */
export function PhoneLayout(p: PhoneLayoutProps) {
  const landscape = useMediaQuery('(orientation: landscape)');
  const [uiHidden, setUiHidden] = useState(false);
  // Remembered per orientation: open in portrait, closed in landscape (it would cover a third of the picture).
  const [drawerByOrientation, setDrawerByOrientation] = useState({ portrait: true, landscape: false });
  const orientation = landscape ? 'landscape' : 'portrait';
  const drawerOpen = drawerByOrientation[orientation];
  const setDrawerOpen = (update: (open: boolean) => boolean) =>
    setDrawerByOrientation((d) => ({ ...d, [orientation]: update(d[orientation]) }));
  const [speedOpen, setSpeedOpen] = useState(false);

  useEffect(() => {
    if (uiHidden) setSpeedOpen(false);
  }, [uiHidden]);

  const hideToggle = (
    <BigButton
      color="ghost"
      icon={uiHidden ? <Eye /> : <EyeOff />}
      aria-label={uiHidden ? t.showControls : t.hideControls}
      title={uiHidden ? t.showControls : t.hideControls}
      active={uiHidden}
      onClick={() => setUiHidden((h) => !h)}
      className="pstudio__hide"
    />
  );
  const drawerToggle = (
    <BigButton
      color="ghost"
      icon={<GalleryHorizontal />}
      aria-label={t.filmStrip}
      title={t.filmStrip}
      active={drawerOpen}
      onClick={() => setDrawerOpen((o) => !o)}
    />
  );
  const speedButton = (
    <BigButton
      color="ghost"
      icon={<Rabbit />}
      aria-label={t.speed}
      title={t.speed}
      active={speedOpen}
      onClick={() => setSpeedOpen((o) => !o)}
      className="pstudio__speed-btn"
      data-fps={p.fps}
    />
  );

  const cls = ['pstudio', landscape ? 'pstudio--landscape' : 'pstudio--portrait', uiHidden ? 'is-ui-hidden' : '', drawerOpen ? 'is-drawer-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <div className="stage pstudio__stage">
        <div className="stage__frame" style={{ ['--ar' as string]: p.aspect }}>
          {p.stage}
        </div>
      </div>

      <header className="pstudio__top pstudio__hideable">
        {p.back}
        <div className="pstudio__title">{p.title}</div>
        {landscape && (
          <div className="pstudio__top-tools">
            {p.undo}
            {p.loop}
            {speedButton}
            {drawerToggle}
          </div>
        )}
        {/* keeps room for the 👁 button, which lives outside the bar so it stays visible when hiding */}
        <span className="pstudio__corner-space" aria-hidden />
        {p.save}
      </header>

      <div className="pstudio__corner">{hideToggle}</div>

      <aside className="pstudio__left pstudio__hideable">{p.tools}</aside>

      {!landscape && (
        <aside className="pstudio__right pstudio__hideable">
          {p.undo}
          {p.loop}
          {speedButton}
        </aside>
      )}

      {speedOpen && !uiHidden && (
        <div className="pstudio__speed-panel" role="dialog" aria-label={t.speed}>
          {p.speedPanel}
        </div>
      )}

      <div className="pstudio__dock">
        {!uiHidden && p.actions && <div className="pstudio__actions">{p.actions}</div>}
        {drawerOpen && <div className="pstudio__drawer pstudio__hideable">{p.timeline}</div>}
        {!landscape && (
          <div className="pstudio__bottom">
            {p.play}
            <span className={uiHidden && !p.recording ? 'pstudio__gone' : ''}>{p.mic}</span>
            {p.capture}
            <span className="pstudio__hideable">{p.music}</span>
            <span className="pstudio__hideable">{drawerToggle}</span>
          </div>
        )}
      </div>

      {landscape && (
        <aside className="pstudio__right pstudio__main-col">
          {p.play}
          <span className={uiHidden && !p.recording ? 'pstudio__gone' : ''}>{p.mic}</span>
          {p.capture}
          <span className="pstudio__hideable">{p.music}</span>
        </aside>
      )}
    </div>
  );
}
