import { useEffect, useRef } from 'react';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  pasteClipboard,
  reorderSelection,
  toggleLock,
  toggleVisibility,
  ungroupSelection,
} from '@/editor/actions';
import { useT, type MessageKey } from '@/i18n';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { shortcutLabel } from '@/ui/editor/shortcuts';

export interface ContextMenuState {
  x: number;
  y: number;
}

interface Item {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const selection = useEditorStore((s) => s.selection);
  const project = useDocStore((s) => s.project);
  const hasSel = selection.length > 0;
  const first = hasSel ? project?.nodes[selection[0]!] : undefined;
  const canUngroup = !!first && (first.type === 'group' || first.type === 'frame') && first.childIds.length > 0;

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const L = (k: MessageKey) => t(k);
  const groups: Item[][] = [
    [
      { label: L('ctx.copy'), shortcut: shortcutLabel('mod+c'), action: copySelection, disabled: !hasSel },
      { label: L('ctx.cut'), shortcut: shortcutLabel('mod+x'), action: cutSelection, disabled: !hasSel },
      { label: L('ctx.paste'), shortcut: shortcutLabel('mod+v'), action: pasteClipboard },
      { label: L('ctx.duplicate'), shortcut: shortcutLabel('mod+d'), action: () => duplicateSelection(), disabled: !hasSel },
      { label: L('ctx.delete'), shortcut: '⌫', action: deleteSelection, disabled: !hasSel },
    ],
    [
      { label: L('ctx.bringFront'), shortcut: shortcutLabel('mod+alt+]'), action: () => reorderSelection('front'), disabled: !hasSel },
      { label: L('ctx.sendBack'), shortcut: shortcutLabel('mod+alt+['), action: () => reorderSelection('back'), disabled: !hasSel },
    ],
    [
      { label: L('ctx.group'), shortcut: shortcutLabel('mod+g'), action: () => groupSelection('group'), disabled: !hasSel },
      { label: L('ctx.frameSelection'), shortcut: shortcutLabel('mod+alt+g'), action: () => groupSelection('frame'), disabled: !hasSel },
      { label: L('ctx.ungroup'), shortcut: shortcutLabel('mod+shift+g'), action: ungroupSelection, disabled: !canUngroup },
    ],
    [
      { label: first?.visible === false ? L('left.show') : L('left.hide'), shortcut: shortcutLabel('mod+shift+h'), action: () => toggleVisibility(), disabled: !hasSel },
      { label: first?.locked ? L('left.unlock') : L('left.lock'), shortcut: shortcutLabel('mod+shift+l'), action: () => toggleLock(), disabled: !hasSel },
    ],
  ];

  const left = Math.min(state.x, window.innerWidth - 240);
  const top = Math.min(state.y, window.innerHeight - 360);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-56 rounded-lg border border-line-strong bg-elevated p-1 text-[12px] shadow-2xl"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {groups.map((g, gi) => (
        <div key={gi} className={gi ? 'mt-1 border-t border-line pt-1' : ''}>
          {g.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-fg enabled:hover:bg-accent enabled:hover:text-white disabled:text-fg-subtle"
              onClick={() => {
                it.action();
                onClose();
              }}
            >
              <span>{it.label}</span>
              {it.shortcut && <span className="text-[11px] opacity-60">{it.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
