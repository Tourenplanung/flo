import { useEffect, useState } from 'react';
import { Editor } from '@/ui/editor/Editor';
import { ProjectHome } from '@/ui/home/ProjectHome';
import { useSettingsStore } from '@/store/settingsStore';

/** Minimal hash router: `#/p/<projectId>` opens a project, anything else shows the home. */
function parseHash(): string | null {
  const m = /^#\/p\/([A-Za-z0-9_-]{1,64})$/.exec(window.location.hash);
  return m ? m[1]! : null;
}

export function App() {
  const [projectId, setProjectId] = useState<string | null>(parseHash);
  const lang = useSettingsStore((s) => s.language);

  useEffect(() => {
    const onHash = () => setProjectId(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const open = (id: string) => {
    window.location.hash = `#/p/${id}`;
  };
  const exit = () => {
    window.location.hash = '';
  };

  return projectId ? <Editor key={projectId} projectId={projectId} onExit={exit} /> : <ProjectHome onOpen={open} />;
}
