import { useEffect, type ReactNode } from 'react';
import './ui.css';

interface ToastProps {
  message: string | null;
  action?: ReactNode;
  onDone: () => void;
  durationMs?: number;
  /** 'top' sits just under a top bar (Studio); 'bottom' is the default. */
  placement?: 'top' | 'bottom';
}

/** Small pill at the bottom of the screen. Auto-hides after `durationMs`. */
export function Toast({ message, action, onDone, durationMs = 4000, placement = 'bottom' }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(id);
  }, [message, onDone, durationMs]);

  if (!message) return null;
  return (
    <div className={`toast toast--${placement}`} role="status">
      <span>{message}</span>
      {action}
    </div>
  );
}
