import { useEffect, useState } from 'react';

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Phones (portrait or landscape) get the full-screen studio layout; tablets and desktops keep the classic one. */
export const PHONE_QUERY = '(max-width: 600px), (max-height: 500px)';
