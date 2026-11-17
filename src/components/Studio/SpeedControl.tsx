import { Rabbit, Turtle } from 'lucide-react';
import { t } from '../../i18n';
import { MAX_FPS, MIN_FPS } from '../../lib/types';

interface SpeedControlProps {
  fps: number;
  onChange: (fps: number) => void;
}

/** "Tempo" slider from turtle (slow) to rabbit (fast). The number is shown small for grown-ups. */
export function SpeedControl({ fps, onChange }: SpeedControlProps) {
  return (
    <label className="speed" title={`${t.speed}: ${fps}`}>
      <Turtle className="speed__icon" aria-label={t.slow} />
      <input
        type="range"
        min={MIN_FPS}
        max={MAX_FPS}
        step={1}
        value={fps}
        aria-label={t.speed}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${((fps - MIN_FPS) / (MAX_FPS - MIN_FPS)) * 100}%` }}
      />
      <Rabbit className="speed__icon" aria-label={t.fast} />
      <span className="speed__num">{fps}</span>
    </label>
  );
}
