/** Deterministic responsive adaptation of a design subtree for a target device. */
import { createIcon } from '../factory';
import type { DesignNode, FrameNode } from '../schema';
import { DEVICES, type Device } from './placement';

/**
 * Mutates cloned nodes (root-first list) for the target device. Returns extra nodes to insert
 * (e.g. a menu icon replacing hidden navigation links).
 */
export function adaptTree(nodes: DesignNode[], device: Device): DesignNode[] {
  const target = DEVICES[device].width;
  const mobile = device === 'mobile';
  const maxPadX = mobile ? 20 : device === 'tablet' ? 40 : Infinity;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const extra: DesignNode[] = [];
  const root = nodes[0];
  if (!root) return extra;
  root.width = target;
  root.name = `${root.name} · ${DEVICES[device].label}`;

  const parentOf = (n: DesignNode) => byId.get(n.parentId);
  const inFlow = (n: DesignNode) => {
    const p = parentOf(n);
    return !!p && p.type === 'frame' && p.layout.mode !== 'none' && n.layoutPositioning === 'auto';
  };

  for (const n of nodes) {
    if (n.type === 'frame') {
      const f = n as FrameNode;
      const l = f.layout;
      if (l.mode !== 'none') {
        const [t, r, bt, lf] = l.padding;
        l.padding = [mobile ? Math.round(t * 0.6) : t, Math.min(r, maxPadX), mobile ? Math.round(bt * 0.6) : bt, Math.min(lf, maxPadX)];
        if (mobile) l.gap = Math.min(l.gap, 24);
      }
      const children = f.childIds.map((id) => byId.get(id)).filter(Boolean) as DesignNode[];
      if (l.mode === 'horizontal' && children.length) {
        const allFrames = children.every((c) => c.type === 'frame' || c.type === 'image');
        const textOnly = children.every((c) => c.type === 'text');
        if (f.role === 'nav' && textOnly && mobile) {
          // Collapse text navigation into a menu icon.
          f.visible = false;
          const parent = parentOf(f);
          if (parent && parent.type === 'frame') {
            const icon = createIcon({ parentId: parent.id, name: 'Menu' }, 'menu');
            icon.layoutPositioning = 'auto';
            const color = children[0]!.fills[0];
            if (color) icon.fills = [color];
            parent.childIds.push(icon.id);
            extra.push(icon);
          }
        } else if (allFrames && children.length > 1) {
          if (mobile) {
            l.mode = 'vertical';
            l.counterAlign = 'start';
            for (const c of children) c.sizing = { ...c.sizing, horizontal: 'fill' };
          } else l.wrap = true;
        } else if (textOnly && children.length > 2) l.wrap = true;
        if (mobile && f.role === 'footer') {
          l.mode = 'vertical';
          l.primaryAlign = 'start';
          l.counterAlign = 'start';
        }
      }
    }
    if (n.type === 'text') {
      const scale = mobile ? (n.fontSize >= 40 ? 0.62 : n.fontSize >= 28 ? 0.8 : 1) : device === 'tablet' && n.fontSize >= 40 ? 0.8 : 1;
      n.fontSize = Math.round(n.fontSize * scale);
      // Long hugging text would overflow a narrow screen: let it wrap.
      if (mobile && n.sizing.horizontal === 'hug' && n.characters.length > 28 && inFlow(n)) n.sizing = { ...n.sizing, horizontal: 'fill' };
    }
    if (n !== root && n.sizing.horizontal === 'fixed' && n.width > target - 2 * Math.min(maxPadX, 40)) {
      if (inFlow(n)) n.sizing = { ...n.sizing, horizontal: 'fill' };
      else n.width = target - 40;
    }
  }
  return extra;
}
