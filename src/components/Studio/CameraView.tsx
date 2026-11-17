import { useEffect, type RefObject } from 'react';
import { CameraOff, Loader2 } from 'lucide-react';
import type { CameraStatus } from '../../lib/camera';
import { t } from '../../i18n';
import { BigButton } from '../ui/BigButton';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  status: CameraStatus;
  mirror: boolean;
  /** Last frame shown as a see-through "ghost" to line up the next picture. */
  ghostUrl: string | null;
  ghostOpacity: number;
  showGrid: boolean;
  onAspect: (aspect: number) => void;
  /** True once the video shows real pictures (not just an opened stream) — gates the capture button. */
  onVideoReady: (ready: boolean) => void;
  onRetry: () => void;
}

export function CameraView({ videoRef, stream, status, mirror, ghostUrl, ghostOpacity, showGrid, onAspect, onVideoReady, onRetry }: CameraViewProps) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    onVideoReady(false);
    video.srcObject = stream;
    if (!stream) return;
    let cancelled = false;
    // Wait until a frame has actually been presented; right after opening, cameras often deliver black frames.
    const markReady = () => {
      if (cancelled) return;
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(() => !cancelled && onVideoReady(true));
      } else {
        onVideoReady(true);
      }
    };
    video.addEventListener('playing', markReady, { once: true });
    video.play().catch(() => {});
    return () => {
      cancelled = true;
      video.removeEventListener('playing', markReady);
    };
  }, [stream, videoRef, onVideoReady]);

  return (
    <div className="camera">
      <video
        ref={videoRef}
        className={`camera__video ${mirror ? 'is-mirrored' : ''}`}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) onAspect(v.videoWidth / v.videoHeight);
        }}
      />
      {ghostUrl && status === 'ready' && (
        <img className="camera__ghost" src={ghostUrl} alt="" style={{ opacity: ghostOpacity }} draggable={false} />
      )}
      {showGrid && <div className="camera__grid" aria-hidden />}

      {status !== 'ready' && (
        <div className="camera__message">
          {status === 'starting' ? (
            <>
              <Loader2 className="spin" size={56} />
              <p>{t.cameraAsk}</p>
            </>
          ) : (
            <>
              <CameraOff size={56} />
              <p>{status === 'denied' ? t.cameraDenied : status === 'missing' ? t.cameraMissing : t.exportFailed}</p>
              <BigButton color="yellow" label={t.cameraRetry} onClick={onRetry} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
