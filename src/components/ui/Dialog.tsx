import { useEffect, type ReactNode } from 'react';
import './ui.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Big emoji or icon shown above the title. */
  hero?: ReactNode;
  children?: ReactNode;
  /** Buttons row. */
  actions?: ReactNode;
}

/** Friendly modal. Closes on backdrop click and Escape. */
export function Dialog({ open, onClose, title, hero, children, actions }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        {hero && <div className="dialog__hero">{hero}</div>}
        {title && <h2 className="dialog__title">{title}</h2>}
        {children && <div className="dialog__body">{children}</div>}
        {actions && <div className="dialog__actions">{actions}</div>}
      </div>
    </div>
  );
}
