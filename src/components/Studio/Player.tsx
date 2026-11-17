import { useEffect, useRef } from 'react';

interface PlayerProps {
  urls: string[];
  fps: number;
  loop: boolean;
  startIndex?: number;
  onIndex: (index: number) => void;
  onEnd: () => void;
}

/**
 * Plays frames on a canvas. Images are decoded up-front (and cached per URL) so playback never
 * flickers. Timing is based on the clock, not on counting animation frames.
 */
export function Player({ urls, fps, loop, startIndex = 0, onIndex, onEnd }: PlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  // Keep latest callbacks/settings without restarting playback.
  const live = useRef({ fps, loop, onIndex, onEnd });
  live.current = { fps, loop, onIndex, onEnd };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || urls.length === 0) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let stopped = false;

    const getImage = (url: string) => {
      let img = images.current.get(url);
      if (!img) {
        img = new Image();
        img.src = url;
        images.current.set(url, img);
      }
      return img;
    };
    urls.forEach(getImage);

    const draw = (img: HTMLImageElement) => {
      if (!img.complete || !img.naturalWidth) return false;
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0);
      return true;
    };

    // Wait for the first frames to be decoded, then start the clock.
    const first = urls.slice(startIndex, startIndex + 6).map((u) => getImage(u).decode().catch(() => {}));
    let origin = 0;
    let base = startIndex; // index shown at `origin`
    let baseFps = live.current.fps;
    let shown = -1;

    const tick = (now: number) => {
      if (stopped) return;
      const { fps: f, loop: l } = live.current;
      if (f !== baseFps) {
        // Speed changed mid-play: continue from the current frame instead of jumping.
        base = Math.max(shown, startIndex);
        origin = now;
        baseFps = f;
      }
      let idx = base + Math.floor(((now - origin) * f) / 1000);
      if (idx >= urls.length) {
        if (!l) {
          live.current.onEnd();
          return;
        }
        idx = idx % urls.length;
      }
      if (idx !== shown && draw(getImage(urls[idx]))) {
        shown = idx;
        live.current.onIndex(idx);
      }
      raf = requestAnimationFrame(tick);
    };

    Promise.all(first).then(() => {
      if (stopped) return;
      origin = performance.now();
      draw(getImage(urls[startIndex]));
      raf = requestAnimationFrame(tick);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [urls, startIndex]);

  return <canvas ref={canvasRef} className="player" />;
}
