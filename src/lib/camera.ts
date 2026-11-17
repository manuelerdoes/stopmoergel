import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'missing' | 'error';
type Facing = 'user' | 'environment';

export interface CameraState {
  stream: MediaStream | null;
  status: CameraStatus;
  /** While starting: the browser is (probably) showing its permission prompt. */
  needsPermission: boolean;
  /** While starting: it takes suspiciously long — offer a retry. */
  slow: boolean;
  devices: MediaDeviceInfo[];
  /** 'user' (selfie/laptop), 'environment' (back camera) or undefined when the browser doesn't tell. */
  facingMode: string | undefined;
  /** Phones/tablets: toggle front/back. Desktops with several webcams: cycle through them. */
  switchCamera: () => void;
  retry: () => void;
}

/** What to open: a facing direction (phones/tablets) or a concrete device (desktop webcams). */
type Choice = { facing: Facing } | { deviceId: string } | null;

const CHOICE_KEY = 'stopmoergel.camera';
const SLOW_AFTER_MS = 6000;
/** iOS Safari can hang when a new camera is requested right after the previous one was stopped. */
const RELEASE_PAUSE_MS = 250;

function loadChoice(): Choice {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    return raw ? (JSON.parse(raw) as Choice) : null;
  } catch {
    return null;
  }
}

function storeChoice(choice: Choice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable (private mode) — not important */
  }
}

const SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } };

function isConstraintError(err: unknown) {
  const name = (err as DOMException)?.name;
  return name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError';
}

async function open(choice: Choice): Promise<MediaStream> {
  const gum = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video, audio: false });
  if (choice && 'facing' in choice) {
    try {
      return await gum({ ...SIZE, facingMode: { exact: choice.facing } });
    } catch (err) {
      if (!isConstraintError(err)) throw err;
    }
  } else if (choice && 'deviceId' in choice) {
    try {
      return await gum({ ...SIZE, deviceId: { exact: choice.deviceId } });
    } catch (err) {
      // The remembered webcam may be unplugged — fall back to the default camera.
      if (!isConstraintError(err)) throw err;
    }
  }
  // Default: prefer the back camera on tablets (better for filming toys); laptops just use their camera.
  return gum({ ...SIZE, facingMode: { ideal: 'environment' } });
}

/** Best-effort: is the browser going to show (or showing) a camera permission prompt? */
async function permissionIsPrompt(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state === 'prompt';
  } catch {
    return false; // Permissions API without 'camera' support (older Safari/Firefox)
  }
}

/** Opens the camera while `enabled` is true and cleans up the stream afterwards. */
export function useCamera(enabled = true): CameraState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [slow, setSlow] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [choice, setChoice] = useState<Choice>(loadChoice);
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const releasedAt = useRef(0);
  /** Last facing direction a real stream reported — known even while the next camera is still starting. */
  const lastFacing = useRef<Facing | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('starting');
    setSlow(false);
    setNeedsPermission(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('missing');
      return;
    }

    const slowTimer = window.setTimeout(() => !cancelled && setSlow(true), SLOW_AFTER_MS);
    void permissionIsPrompt().then((p) => !cancelled && setNeedsPermission(p));

    (async () => {
      // Give the previous camera time to be fully released (and detached from the <video>) first.
      const wait = releasedAt.current + RELEASE_PAUSE_MS - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (cancelled) return;

      const s = await open(choice);
      if (cancelled) {
        s.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = s;
      const fm = s.getVideoTracks()[0]?.getSettings().facingMode;
      if (fm === 'user' || fm === 'environment') lastFacing.current = fm;
      setStream(s);
      setStatus('ready');
      setSlow(false);
      setNeedsPermission(false);
      // Labels/ids are only complete after permission was granted.
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
    })().catch((err: DOMException) => {
      if (cancelled) return;
      console.error('camera', err);
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') setStatus('denied');
      else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') setStatus('missing');
      else setStatus('error');
    });

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        releasedAt.current = performance.now();
      }
      streamRef.current = null;
      setStream(null); // detaches the stream from the <video> before the next camera opens
    };
  }, [enabled, choice, attempt]);

  const switchCamera = useCallback(() => {
    const settings = streamRef.current?.getVideoTracks()[0]?.getSettings();
    const streamFacing = settings?.facingMode === 'user' || settings?.facingMode === 'environment' ? settings.facingMode : null;
    // Toggle relative to the camera the child *wants* (also while it is still starting — kids tap twice).
    const wanted: Facing | null = choice && 'facing' in choice ? choice.facing : (streamFacing ?? lastFacing.current);
    let next: Choice;
    if (wanted) {
      // Phones/tablets report several back cameras (wide, ultra wide, tele…): toggle front/back instead of cycling.
      next = { facing: wanted === 'user' ? 'environment' : 'user' };
    } else {
      // Desktop webcams don't report a facing direction: cycle through the devices.
      if (devices.length < 2) return;
      const currentId = settings?.deviceId ?? (choice && 'deviceId' in choice ? choice.deviceId : undefined);
      const idx = devices.findIndex((d) => d.deviceId === currentId);
      next = { deviceId: devices[(idx + 1) % devices.length].deviceId };
    }
    storeChoice(next);
    setChoice(next);
  }, [devices, choice]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const facingMode = stream?.getVideoTracks()[0]?.getSettings().facingMode;

  return { stream, status, needsPermission, slow, devices, facingMode, switchCamera, retry };
}
