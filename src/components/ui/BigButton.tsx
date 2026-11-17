import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './ui.css';

export type ButtonColor = 'primary' | 'red' | 'yellow' | 'green' | 'teal' | 'blue' | 'pink' | 'white' | 'ghost';

interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label?: string;
  color?: ButtonColor;
  /** Show the label underneath the icon (toolbar style) instead of next to it. */
  stacked?: boolean;
  /** Visually "on" state for toggles. */
  active?: boolean;
  size?: 'md' | 'lg';
}

/** Chunky, tactile button. Always give it a `label` (also used as aria-label). */
export function BigButton({
  icon,
  label,
  color = 'primary',
  stacked = false,
  active,
  size = 'md',
  className = '',
  ...rest
}: BigButtonProps) {
  const cls = [
    'bigbtn',
    `bigbtn--${color}`,
    `bigbtn--${size}`,
    stacked ? 'bigbtn--stacked' : '',
    active ? 'is-active' : '',
    !label ? 'bigbtn--icon-only' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} aria-label={label} aria-pressed={active} title={label} {...rest}>
      {icon && <span className="bigbtn__icon">{icon}</span>}
      {label && <span className="bigbtn__label">{label}</span>}
    </button>
  );
}
