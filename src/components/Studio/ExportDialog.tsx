import { useEffect, useState } from 'react';
import { Film, PartyPopper, Frown } from 'lucide-react';
import { t } from '../../i18n';
import { downloadBlob } from '../../lib/download';
import { playTada } from '../../lib/sounds';
import { BigButton } from '../ui/BigButton';
import { Dialog } from '../ui/Dialog';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  getBlobs: () => Blob[];
  fps: number;
  name: string;
}

type Phase = { kind: 'working'; progress: number } | { kind: 'done' } | { kind: 'error'; message: string };

/** Records the movie to a video file (takes as long as the movie), then downloads it. */
export function ExportDialog({ open, onClose, getBlobs, fps, name }: ExportDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'working', progress: 0 });

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setPhase({ kind: 'working', progress: 0 });
    // The encoder (mediabunny) is loaded on demand to keep the initial app bundle small.
    import('../../lib/exportVideo')
      .then(async ({ exportVideo, isVideoExportSupported, safeFileName }) => {
        if (!isVideoExportSupported()) throw Object.assign(new Error('unsupported'), { unsupported: true });
        const result = await exportVideo(getBlobs(), {
          fps,
          signal: ctrl.signal,
          onProgress: (p) => setPhase({ kind: 'working', progress: p }),
        });
        return { ...result, fileName: safeFileName(name) };
      })
      .then(({ blob, extension, fileName }) => {
        if (ctrl.signal.aborted) return;
        downloadBlob(blob, `${fileName}.${extension}`);
        playTada();
        setPhase({ kind: 'done' });
      })
      .catch((err: unknown) => {
        if ((err as DOMException)?.name === 'AbortError' || ctrl.signal.aborted) return;
        console.error(err);
        setPhase({ kind: 'error', message: (err as { unsupported?: boolean }).unsupported ? t.exportUnsupported : t.exportFailed });
      });
    return () => ctrl.abort();
    // Export once per opening; settings are snapshotted at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const working = phase.kind === 'working';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      hero={working ? <Film className="wiggle" /> : phase.kind === 'done' ? <PartyPopper /> : <Frown />}
      title={working ? t.exporting : phase.kind === 'done' ? t.exportDone : phase.message}
      actions={
        working ? (
          <BigButton color="white" label={t.cancel} onClick={onClose} />
        ) : (
          <BigButton color="green" label={t.ok} onClick={onClose} />
        )
      }
    >
      {working && (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(phase.progress * 100)}>
          <div className="progress__bar" style={{ width: `${phase.progress * 100}%` }} />
        </div>
      )}
    </Dialog>
  );
}
