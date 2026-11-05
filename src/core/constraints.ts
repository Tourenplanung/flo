/** Resize constraints for absolutely positioned children of non-auto-layout frames. */
import type { DocOp } from './ops';
import type { Constraint, DesignNode, Project } from './schema';

function axis(c: Constraint, pos: number, size: number, oldParent: number, newParent: number): { pos: number; size: number } {
  switch (c) {
    case 'start':
      return { pos, size };
    case 'end':
      return { pos: pos + (newParent - oldParent), size };
    case 'center':
      return { pos: pos + (newParent - oldParent) / 2, size };
    case 'stretch':
      return { pos, size: Math.max(0, size + (newParent - oldParent)) };
    case 'scale': {
      const k = oldParent > 0 ? newParent / oldParent : 1;
      return { pos: pos * k, size: size * k };
    }
  }
}

/** Ops repositioning the children of `frameId` when it is resized from its stored size to the new one. */
export function constraintOps(project: Project, frameId: string, newWidth: number, newHeight: number): DocOp[] {
  const frame = project.nodes[frameId];
  if (!frame || (frame.type !== 'frame' && frame.type !== 'group')) return [];
  const flow = frame.type === 'frame' && frame.layout.mode !== 'none';
  const ops: DocOp[] = [];
  for (const id of frame.childIds) {
    const c = project.nodes[id];
    if (!c || (flow && c.layoutPositioning === 'auto')) continue;
    const { horizontal, vertical } = c.constraints;
    if (horizontal === 'start' && vertical === 'start') continue;
    const h = axis(horizontal, c.x, c.width, frame.width, newWidth);
    const v = axis(vertical, c.y, c.height, frame.height, newHeight);
    const props: Partial<DesignNode> = {};
    if (Math.round(h.pos) !== c.x) props.x = Math.round(h.pos);
    if (Math.round(v.pos) !== c.y) props.y = Math.round(v.pos);
    if (Math.round(h.size) !== Math.round(c.width)) props.width = Math.round(h.size);
    if (Math.round(v.size) !== Math.round(c.height)) props.height = Math.round(v.size);
    if (Object.keys(props).length) ops.push({ type: 'updateNode', id, props: props as Record<string, unknown> });
  }
  return ops;
}
