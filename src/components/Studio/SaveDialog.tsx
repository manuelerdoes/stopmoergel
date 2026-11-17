import { Clapperboard, Package } from 'lucide-react';
import { t } from '../../i18n';
import { BigButton } from '../ui/BigButton';
import { Dialog } from '../ui/Dialog';

interface SaveDialogProps {
  open: boolean;
  onClose: () => void;
  onVideo: () => void;
  onProject: () => void;
}

/** Lets the child pick between a watchable video and a project backup to continue later. */
export function SaveDialog({ open, onClose, onVideo, onProject }: SaveDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={t.saveWhat} actions={<BigButton color="white" label={t.cancel} onClick={onClose} />}>
      <div className="save-choices">
        <button type="button" className="save-choice save-choice--video" onClick={onVideo}>
          <Clapperboard className="save-choice__icon" />
          <span className="save-choice__title">{t.saveVideoTitle}</span>
          <span className="save-choice__hint">{t.saveVideoHint}</span>
        </button>
        <button type="button" className="save-choice save-choice--project" onClick={onProject}>
          <Package className="save-choice__icon" />
          <span className="save-choice__title">{t.saveProject}</span>
          <span className="save-choice__hint">{t.saveProjectHint}</span>
        </button>
      </div>
    </Dialog>
  );
}
