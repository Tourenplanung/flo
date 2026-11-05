import { op } from '@/core/ops';
import { dispatch, getProject } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';

const autoName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 40);

/** Applies the result of inline text editing. Empty text layers are removed (like most design tools). */
export function commitTextEdit(id: string, text: string) {
  const project = getProject();
  const node = project?.nodes[id];
  if (!node || node.type !== 'text') return;
  if (text.trim() === '') {
    dispatch([op.remove(id)], { label: 'Delete empty text', mergeKey: `create-text:${id}`, mergeWindow: Infinity });
    useEditorStore.getState().select(useEditorStore.getState().selection.filter((s) => s !== id));
    return;
  }
  if (text === node.characters) return;
  const nameIsAuto = node.name === '' || node.name === autoName(node.characters) || node.name === 'Testo' || node.name === 'Text';
  dispatch([op.update(id, { characters: text, ...(nameIsAuto ? { name: autoName(text) || 'Text' } : {}) })], {
    label: 'Edit text',
    mergeKey: `create-text:${id}`,
    mergeWindow: Infinity,
  });
}
