import { useEffect, useState } from 'react';
import { Gallery } from './components/Gallery/Gallery';
import { Studio } from './components/Studio/Studio';

type View = { name: 'gallery' } | { name: 'studio'; projectId: string };

/** Minimal hash routing so the browser back button and reloads work: `#/` or `#/movie/<id>`. */
function parseHash(): View {
  const m = location.hash.match(/^#\/movie\/([^/]+)$/);
  return m ? { name: 'studio', projectId: decodeURIComponent(m[1]) } : { name: 'gallery' };
}

export function App() {
  const [view, setView] = useState<View>(parseHash);

  useEffect(() => {
    const onHash = () => setView(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (view.name === 'studio') {
    return <Studio key={view.projectId} projectId={view.projectId} onBack={() => (location.hash = '#/')} />;
  }
  return <Gallery onOpen={(id) => (location.hash = `#/movie/${encodeURIComponent(id)}`)} />;
}
