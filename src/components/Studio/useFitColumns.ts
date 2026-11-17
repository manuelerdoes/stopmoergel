import { useLayoutEffect, type RefObject } from 'react';

/**
 * Desktop tool panel: never scroll — add columns until every button fits in the available height.
 * Works directly on the DOM (data-cols + --tool-cols) to avoid render loops: the panel's width depends on
 * the column count, but its height does not, so measuring is stable.
 * Only active while the panel is a vertical column (in the tablet row layout it does nothing).
 */
export function useFitColumns(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    let lastHeight = -1;
    const fit = (force: boolean) => {
      const height = parent.clientHeight;
      if (!force && height === lastHeight) return; // width changes (from our own column count) don't matter
      lastHeight = height;
      if (getComputedStyle(parent).flexDirection !== 'column') {
        delete el.dataset.cols;
        el.style.removeProperty('--tool-cols');
        return;
      }
      const max = Math.max(1, el.children.length);
      for (let cols = 1; cols <= max; cols++) {
        el.dataset.cols = String(cols);
        el.style.setProperty('--tool-cols', String(cols));
        if (el.scrollHeight <= el.clientHeight + 1) break;
      }
    };

    fit(true);
    const ro = new ResizeObserver(() => fit(false));
    ro.observe(parent);
    const onResize = () => fit(true); // orientation / media query changes switch between column and row
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
