import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Clapperboard, Film, FolderOpen, Frown, Loader2, Plus, Trash2 } from 'lucide-react';
import { BigButton } from '../ui/BigButton';
import { Dialog } from '../ui/Dialog';
import { Toast } from '../ui/Toast';
import { downloadBlob } from '../../lib/download';
import { ArchiveError, exportProjectArchive, importProjectArchive } from '../../lib/projectArchive';
import { createProject, deleteProject, listProjects, renameProject } from '../../lib/db';
import type { Project } from '../../lib/types';
import { t } from '../../i18n';
import { ProjectCard } from './ProjectCard';
import './Gallery.css';

const MAX_NAME = 40;

export function Gallery({ onOpen }: { onOpen: (projectId: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const reload = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((p) => !cancelled && setProjects(p))
      .catch(() => !cancelled && setProjects([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const p = await createProject(t.defaultMovieName((projects?.length ?? 0) + 1));
      onOpen(p.id);
    } finally {
      setBusy(false);
    }
  };

  const startRename = (p: Project) => {
    setName(p.name);
    setRenaming(p);
  };

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const confirmRename = async () => {
    const trimmed = name.trim();
    const target = renaming;
    setRenaming(null);
    if (!target || !trimmed || trimmed === target.name) return;
    await renameProject(target.id, trimmed);
    await reload();
  };

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    await deleteProject(target.id);
    await reload();
  };

  const importFile = async (file: File | undefined) => {
    if (!file || importing) return;
    setImporting(true);
    try {
      const p = await importProjectArchive(file);
      await reload();
      setToast(t.importDone(p.name));
    } catch (err) {
      console.error(err);
      const code = err instanceof ArchiveError ? err.code : null;
      setImportError(code === 'newerVersion' ? t.importNewer : code === 'brokenFrames' ? t.importBroken : t.importNotArchive);
    } finally {
      setImporting(false);
    }
  };

  const saveProjectFile = async (p: Project) => {
    try {
      const { blob, fileName } = await exportProjectArchive(p.id);
      downloadBlob(blob, fileName);
      setToast(t.projectSaved);
    } catch (err) {
      console.error(err);
      setToast(t.exportFailed);
    }
  };

  // Drag & drop a backup file anywhere on the gallery. A depth counter avoids flicker
  // because dragenter/dragleave also fire for every child element.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      void importFile(e.dataTransfer.files[0]);
    },
  };

  const closeRename = useCallback(() => setRenaming(null), []);
  const closeToast = useCallback(() => setToast(null), []);
  const closeDelete = useCallback(() => setDeleting(null), []);

  return (
    <main className="gallery" {...dropHandlers}>
      <header className="gallery__header">
        <div className="gallery__logo" aria-hidden="true">
          <Clapperboard />
          <Film className="gallery__logo-film" />
        </div>
        <h1 className="gallery__title">{t.appName}</h1>
      </header>

      <div className="gallery__section-row">
        <h2 className="gallery__section">{t.myMovies}</h2>
        <BigButton
          color="white"
          icon={importing ? <Loader2 className="gallery__spin" /> : <FolderOpen />}
          label={importing ? t.importing : t.openProject}
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <ul className="gallery__grid" aria-busy={projects === null}>
        <li className="gallery__new-item">
          <button type="button" className="gallery__new" onClick={create} disabled={busy}>
            <span className="gallery__new-plus">
              <Plus aria-hidden="true" />
            </span>
            <span className="gallery__new-label">{t.newMovie}</span>
          </button>
        </li>
        {projects?.map((p, i) => (
          <ProjectCard
            key={p.id}
            project={p}
            index={i + 1}
            onOpen={() => onOpen(p.id)}
            onRename={() => startRename(p)}
            onDelete={() => setDeleting(p)}
            onSave={() => void saveProjectFile(p)}
          />
        ))}
        {projects === null && (
          <li className="gallery__loading" role="status">
            {t.loading}
          </li>
        )}
        {projects?.length === 0 && <li className="gallery__empty">{t.noMoviesYet}</li>}
      </ul>

      <Dialog
        open={renaming !== null}
        onClose={closeRename}
        title={t.rename}
        actions={
          <>
            <BigButton color="white" label={t.cancel} onClick={closeRename} />
            <BigButton color="green" label={t.ok} onClick={confirmRename} disabled={!name.trim()} />
          </>
        }
      >
        <input
          ref={inputRef}
          className="gallery__input"
          value={name}
          maxLength={MAX_NAME}
          autoFocus
          aria-label={t.movieName}
          placeholder={t.movieName}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmRename();
          }}
        />
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={closeDelete}
        hero={<Trash2 color="var(--c-red)" aria-hidden="true" />}
        title={deleting ? t.deleteMovieQuestion(deleting.name) : undefined}
        actions={
          <>
            <BigButton color="white" label={t.cancel} onClick={closeDelete} />
            <BigButton color="red" label={t.yesDelete} onClick={confirmDelete} />
          </>
        }
      >
        {t.deleteMovieHint}
      </Dialog>
      <Dialog
        open={importError !== null}
        onClose={() => setImportError(null)}
        hero={<Frown color="var(--c-orange)" aria-hidden="true" />}
        title={t.importFailedTitle}
        actions={<BigButton color="green" label={t.ok} onClick={() => setImportError(null)} />}
      >
        {importError}
      </Dialog>

      <Toast message={toast} onDone={closeToast} />

      {dragOver && (
        <div className="gallery__drop" aria-hidden="true">
          <FolderOpen />
          <span>{t.dropHere}</span>
        </div>
      )}
    </main>
  );
}
