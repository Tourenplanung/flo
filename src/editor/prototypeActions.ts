import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';

/** Starts the prototype from the screen containing the selection (or the start screen). */
export function playFromSelection() {
  const s = useEditorStore.getState();
  const project = useDocStore.getState().project;
  let start: string | null = null;
  const first = s.selection[0] ? project?.nodes[s.selection[0].split('__')[0]!] : undefined;
  if (project && first) {
    let cur = first;
    while (project.nodes[cur.parentId]) cur = project.nodes[cur.parentId]!;
    start = cur.type === 'frame' ? cur.id : null;
  }
  s.openPlayer(start);
}

