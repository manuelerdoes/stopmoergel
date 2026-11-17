import { useEffect, type RefObject } from 'react';
import { CameraOff, Loader2 } from 'lucide-react';
import type { CameraStatus } from '../../lib/camera';
import { t } from '../../i18n';
import { BigButton } from '../ui/BigButton';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  status: CameraStatus;
  /** Browser is asking for permission (show the "please allow" hint only then). */
  needsPermission: boolean;
  /** Starting takes too long: offer a retry. */
  slow: boolean;
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

export function CameraView({ videoRef, stream, status, needsPermission, slow, mirror, ghostUrl, ghostOpacity, showGrid, onAspect, onVideoReady, onRetry }: CameraViewProps) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    onVideoReady(false);
    video.srcObject = stream;
    if (!stream) return;
    let cancelled = false;
    let ready = false;
    const done = () => {
      if (cancelled || ready) return;
      ready = true;
      onVideoReady(true);
    };
    // Wait until a frame has actually been presented; right after opening, cameras often deliver black frames.
    const markReady = () => {
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(done);
        window.setTimeout(done, 700); // some older iOS versions never call it back
      } else {
        done();
      }
    };
    // Fallback: older iPhones (e.g. in Low Power Mode) may never fire 'playing' although the video has pictures.
    let poll = window.setTimeout(function check() {
      if (cancelled || ready) return;
      if (video.readyState >= 2 && video.videoWidth > 0) done();
      else poll = window.setTimeout(check, 500);
    }, 1500);
    // If autoplay is refused (Low Power Mode), start the preview on the next tap anywhere.
    const retryPlay = () => void video.play().catch(() => {});
    video.addEventListener('playing', markReady, { once: true });
    video.play().catch(() => document.addEventListener('pointerdown', retryPlay, { once: true }));
    return () => {
      cancelled = true;
      window.clearTimeout(poll);
      video.removeEventListener('playing', markReady);
      document.removeEventListener('pointerdown', retryPlay);
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
              <p>{needsPermission ? t.cameraAsk : slow ? t.cameraSlow : t.cameraStarting}</p>
              {slow && <BigButton color="yellow" label={t.cameraRetry} onClick={onRetry} />}
            </>
          ) : (
            <>
              <CameraOff size={56} />
              <p>{status === 'denied' ? t.cameraDenied : status === 'missing' ? t.cameraMissing : t.cameraError}</p>
              <BigButton color="yellow" label={t.cameraRetry} onClick={onRetry} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
