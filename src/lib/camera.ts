import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'missing' | 'error';

export interface CameraState {
  stream: MediaStream | null;
  status: CameraStatus;
  devices: MediaDeviceInfo[];
  /** 'user' (selfie/laptop), 'environment' (back camera) or undefined when the browser doesn't tell. */
  facingMode: string | undefined;
  /** Cycle to the next available camera. */
  switchCamera: () => void;
  retry: () => void;
}

const DEVICE_KEY = 'stopmoergel.cameraId';

function loadDeviceId(): string | undefined {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeDeviceId(id: string | undefined) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* storage unavailable (private mode) — not important */
  }
}

async function open(deviceId: string | undefined): Promise<MediaStream> {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { ...size, deviceId: { exact: deviceId } }, audio: false });
    } catch (err) {
      // The remembered camera may be unplugged — fall through to the default camera.
      if ((err as DOMException).name !== 'OverconstrainedError' && (err as DOMException).name !== 'NotFoundError') throw err;
    }
  }
  // Prefer the back camera on tablets (better for filming toys); laptops just use their only camera.
  return navigator.mediaDevices.getUserMedia({ video: { ...size, facingMode: { ideal: 'environment' } }, audio: false });
}

/** Opens the camera while `enabled` is true and cleans up the stream afterwards. */
export function useCamera(enabled = true): CameraState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(loadDeviceId);
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('starting');

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('missing');
      return;
    }

    open(deviceId)
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        setStatus('ready');
        // Labels/ids are only complete after permission was granted.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') setStatus('denied');
        else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') setStatus('missing');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      setStream(null);
    };
  }, [enabled, deviceId, attempt]);

  const switchCamera = useCallback(() => {
    if (devices.length < 2) return;
    const currentId = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId;
    const idx = devices.findIndex((d) => d.deviceId === currentId);
    const next = devices[(idx + 1) % devices.length].deviceId;
    storeDeviceId(next);
    setDeviceId(next);
  }, [devices, deviceId]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const facingMode = stream?.getVideoTracks()[0]?.getSettings().facingMode;

  return { stream, status, devices, facingMode, switchCamera, retry };
}
