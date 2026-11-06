import { useEffect } from 'react';
import {
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  nudgeSelection,
  pasteClipboard,
  redo,
  reorderSelection,
  selectAll,
  selectChildren,
  selectParent,
  toggleLock,
  toggleVisibility,
  undo,
  ungroupSelection,
} from '@/editor/actions';
import { useEditorStore, type Tool } from '@/store/editorStore';
import { zoomBy, zoomTo100, zoomToFit, zoomToSelection } from './viewportActions';
import { playFromSelection } from '@/editor/prototypeActions';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function shortcutLabel(combo: string): string {
  return combo
    .split('+')
    .map((k) => {
      if (k === 'mod') return isMac ? '⌘' : 'Ctrl+';
      if (k === 'shift') return isMac ? '⇧' : 'Shift+';
      if (k === 'alt') return isMac ? '⌥' : 'Alt+';
      return k.toUpperCase();
    })
    .join('');
}

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  f: 'frame',
  a: 'frame',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
};

function isTypingTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  return e.isContentEditable || e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT';
}

export function handleShortcut(e: KeyboardEvent, extra: { save: () => void }): boolean {
  if (isTypingTarget(e.target)) return false;
  // The prototype player handles its own keys.
  if (useEditorStore.getState().player) return false;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();
  const s = useEditorStore.getState();

  // In workflow mode only document-level shortcuts apply; the flow canvas handles the rest.
  if (s.mode === 'workflow') {
    if (!mod) return false;
    if (key === 'z') return e.shiftKey ? redo() : undo(), true;
    if (key === 'y') return redo(), true;
    if (key === 's') return extra.save(), true;
    return false;
  }

  if (mod) {
    switch (key) {
      case 'z':
        e.shiftKey ? redo() : undo();
        return true;
      case 'y':
        redo();
        return true;
      case 'd':
        duplicateSelection();
        return true;
      case 'c':
        copySelection();
        return true;
      case 'x':
        cutSelection();
        return true;
      case 'v':
        pasteClipboard();
        return true;
      case 'a':
        selectAll();
        return true;
      case 'g':
        if (e.shiftKey) ungroupSelection();
        else groupSelection(e.altKey ? 'frame' : 'group');
        return true;
      case 's':
        extra.save();
        return true;
      case 'h':
        if (e.shiftKey) {
          toggleVisibility();
          return true;
        }
        return false;
      case 'l':
        if (e.shiftKey) {
          toggleLock();
          return true;
        }
        return false;
      case ']':
        reorderSelection(e.altKey ? 'front' : 'forward');
        return true;
      case '[':
        reorderSelection(e.altKey ? 'back' : 'backward');
        return true;
      case '=':
      case '+':
        zoomBy(1.25);
        return true;
      case '-':
        zoomBy(0.8);
        return true;
      case '0':
        zoomTo100();
        return true;
    }
    return false;
  }

  if (e.altKey) {
    const map: Record<string, Parameters<typeof alignSelection>[0]> = {
      a: 'left',
      d: 'right',
      h: 'hcenter',
      w: 'top',
      s: 'bottom',
      v: 'vcenter',
    };
    const code = e.code.replace('Key', '').toLowerCase();
    if (map[code]) {
      alignSelection(map[code]!);
      return true;
    }
    return false;
  }

  if (e.shiftKey) {
    if (e.code === 'Digit1') return zoomToFit(), true;
    if (e.code === 'Digit2') return zoomToSelection(), true;
    if (e.code === 'Digit0') return zoomTo100(), true;
    if (key === 'r') return s.toggleRulers(), true;
    if (key === 'p') return playFromSelection(), true;
  }

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      deleteSelection();
      return true;
    case 'Escape':
      if (s.tool !== 'select') s.setTool('select');
      else selectParent();
      return true;
    case 'Enter':
      selectChildren();
      return true;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      nudgeSelection(dx, dy);
      return true;
    }
  }
  if (!e.shiftKey && TOOL_KEYS[key]) {
    s.setTool(TOOL_KEYS[key]!);
    return true;
  }
  return false;
}

export function useEditorShortcuts(save: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && !e.key.startsWith('Arrow') && e.key.toLowerCase() !== 'z') return;
      if (handleShortcut(e, { save })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);
}

export const SHORTCUTS: { combo: string; it: string; en: string }[] = [
  { combo: 'V', it: 'Seleziona', en: 'Select' },
  { combo: 'F', it: 'Frame', en: 'Frame' },
  { combo: 'R / O / L', it: 'Rettangolo / Ellisse / Linea', en: 'Rectangle / Ellipse / Line' },
  { combo: 'T', it: 'Testo', en: 'Text' },
  { combo: 'H · Spazio', it: 'Sposta la vista', en: 'Pan' },
  { combo: 'mod+Z / mod+shift+Z', it: 'Annulla / Ripeti', en: 'Undo / Redo' },
  { combo: 'mod+D', it: 'Duplica', en: 'Duplicate' },
  { combo: 'mod+G / mod+shift+G', it: 'Raggruppa / Separa', en: 'Group / Ungroup' },
  { combo: 'mod+[ / mod+]', it: 'Sposta indietro / avanti', en: 'Send backward / forward' },
  { combo: 'shift+1 / shift+2', it: 'Adatta tutto / selezione', en: 'Zoom to fit / selection' },
  { combo: 'shift+R', it: 'Righelli', en: 'Rulers' },
  { combo: 'Enter / Esc', it: 'Seleziona figli / genitore', en: 'Select children / parent' },
  { combo: 'alt+A/D/H/W/S/V', it: 'Allinea', en: 'Align' },
];
