import { useCallback, useEffect, useRef, useState } from 'react';
import { openMicRecorder, type MicRecorder, type RecordingResult } from '../../lib/audio/recorder';

export type RecPhase = 'idle' | 'opening' | 'countdown' | 'recording' | 'saving';

interface Options {
  /** Start the picture playback at `startFrame` (the recording runs along with the movie). */
  startPlayback: (startFrame: number) => void;
  stopPlayback: () => void;
  /** `leadIn` = seconds recorded before the movie actually started; trim them so sound and pictures line up. */
  onDone: (result: RecordingResult, startFrame: number, leadIn: number) => void;
  onError: (err: unknown) => void;
}

const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 800;

/**
 * Recording flow: open mic → 3-2-1 → start capturing → start movie playback → stop → clip.
 * Sync: the recorder reports when the first samples arrived, the player reports (via `markPlaybackStart`)
 * when its clock started; the difference is the lead-in that gets trimmed from the clip.
 */
export function useSoundRecorder({ startPlayback, stopPlayback, onDone, onError }: Options) {
  const [phase, setPhase] = useState<RecPhase>('idle');
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const rec = useRef<MicRecorder | null>(null);
  const session = useRef({ startFrame: 0, audioStart: 0, playbackStart: 0, token: 0 });
  const latest = useRef({ startPlayback, stopPlayback, onDone, onError });
  latest.current = { startPlayback, stopPlayback, onDone, onError };

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    session.current.token++;
    latest.current.stopPlayback();
    setPhase('saving');
    try {
      const result = await r.stop();
      const { audioStart, playbackStart, startFrame } = session.current;
      const leadIn = playbackStart > audioStart ? (playbackStart - audioStart) / 1000 : 0;
      latest.current.onDone(result, startFrame, leadIn);
    } catch (err) {
      latest.current.onError(err);
    } finally {
      setPhase('idle');
      setLevel(0);
    }
  }, []);

  const cancel = useCallback(() => {
    session.current.token++;
    rec.current?.cancel();
    rec.current = null;
    latest.current.stopPlayback();
    setPhase('idle');
    setLevel(0);
  }, []);

  const start = useCallback(
    async (startFrame: number) => {
      if (rec.current) return;
      const token = ++session.current.token;
      session.current = { startFrame, audioStart: 0, playbackStart: 0, token };
      setPhase('opening');
      setElapsed(0);
      try {
        // Must be the first call inside the tap: it unlocks audio on iOS before any await.
        const r = await openMicRecorder();
        if (session.current.token !== token) {
          r.cancel();
          return;
        }
        rec.current = r;
        r.onLimit = () => void stop();
        setPhase('countdown');
        for (let n = COUNTDOWN_FROM; n > 0; n--) {
          setCount(n);
          await new Promise((res) => setTimeout(res, COUNTDOWN_STEP_MS));
          if (session.current.token !== token) return;
        }
        session.current.audioStart = await r.start();
        if (session.current.token !== token) return;
        setPhase('recording');
        latest.current.startPlayback(startFrame);
      } catch (err) {
        rec.current?.cancel();
        rec.current = null;
        setPhase('idle');
        latest.current.onError(err);
      }
    },
    [stop],
  );

  /** Call when the picture clock really starts (Player onSync during recording). */
  const markPlaybackStart = useCallback(() => {
    if (!session.current.playbackStart) session.current.playbackStart = performance.now();
  }, []);

  // Live level meter + timer while the mic is open.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'countdown') return;
    let raf = 0;
    const tick = () => {
      const r = rec.current;
      if (r) {
        setLevel(r.level());
        if (phase === 'recording') setElapsed(r.elapsed());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Never leave the microphone open when leaving the studio.
  useEffect(() => () => rec.current?.cancel(), []);

  return { phase, count, level, elapsed, start, stop, cancel, markPlaybackStart };
}
