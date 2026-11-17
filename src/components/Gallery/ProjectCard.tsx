import { useEffect, useState } from 'react';
import { Clapperboard, Package, Pencil, Trash2 } from 'lucide-react';
import { getFrame } from '../../lib/db';
import type { Project } from '../../lib/types';
import { t } from '../../i18n';

interface ProjectCardProps {
  project: Project;
  index: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSave: () => void;
}

const ACCENTS = ['mint', 'sky', 'lilac', 'peach', 'lemon', 'rose'] as const;

function accentFor(id: string): (typeof ACCENTS)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function useFirstFrameUrl(firstFrameId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!firstFrameId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    getFrame(firstFrameId)
      .then((frame) => {
        if (cancelled || !frame) return;
        created = URL.createObjectURL(frame.blob);
        setUrl(created);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [firstFrameId]);
  return url;
}

export function ProjectCard({ project, index, onOpen, onRename, onDelete, onSave }: ProjectCardProps) {
  const url = useFirstFrameUrl(project.frameIds[0]);
  const accent = accentFor(project.id);
  return (
    <li
      className={`gcard gcard--${accent}`}
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
    >
      <button type="button" className="gcard__main" onClick={onOpen} aria-label={`${t.open}: ${project.name}`}>
        <span className="gcard__thumb">
          {url ? (
            <img src={url} alt="" draggable={false} />
          ) : (
            <Clapperboard className="gcard__placeholder" aria-hidden="true" />
          )}
        </span>
        <span className="gcard__info">
          <span className="gcard__name">{project.name}</span>
          <span className="gcard__count">{t.frames(project.frameIds.length)}</span>
        </span>
      </button>
      <div className="gcard__actions">
        <button type="button" className="gcard__icon" onClick={onSave} aria-label={t.saveProject} title={t.saveProject}>
          <Package aria-hidden="true" />
        </button>
        <button type="button" className="gcard__icon" onClick={onRename} aria-label={t.rename} title={t.rename}>
          <Pencil aria-hidden="true" />
        </button>
        <button type="button" className="gcard__icon gcard__icon--danger" onClick={onDelete} aria-label={t.delete} title={t.delete}>
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
