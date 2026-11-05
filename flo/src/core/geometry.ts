/** Rect math and smart snapping. Coordinates are in world (page) space unless noted. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const rectRight = (r: Rect) => r.x + r.width;
export const rectBottom = (r: Rect) => r.y + r.height;

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

export interface SnapLine {
  axis: 'x' | 'y';
  /** World coordinate of the guide line. */
  position: number;
  /** Extent of the line along the other axis. */
  from: number;
  to: number;
}

export interface SnapTargets {
  /** Candidate x positions (left/center/right edges, guides). */
  xs: { value: number; from: number; to: number }[];
  ys: { value: number; from: number; to: number }[];
}

export function buildSnapTargets(rects: Rect[], guides: { axis: 'x' | 'y'; position: number }[] = []): SnapTargets {
  const xs: SnapTargets['xs'] = [];
  const ys: SnapTargets['ys'] = [];
  for (const r of rects) {
    for (const v of [r.x, r.x + r.width / 2, r.x + r.width]) xs.push({ value: v, from: r.y, to: r.y + r.height });
    for (const v of [r.y, r.y + r.height / 2, r.y + r.height]) ys.push({ value: v, from: r.x, to: r.x + r.width });
  }
  for (const g of guides) {
    if (g.axis === 'x') xs.push({ value: g.position, from: -1e6, to: 1e6 });
    else ys.push({ value: g.position, from: -1e6, to: 1e6 });
  }
  return { xs, ys };
}

function bestSnap(candidates: number[], targets: SnapTargets['xs'], threshold: number) {
  let best: { delta: number; value: number } | null = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = t.value - c;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, value: t.value };
    }
  }
  return best;
}

function linesFor(axis: 'x' | 'y', value: number, rect: Rect, targets: SnapTargets['xs']): SnapLine[] {
  const matching = targets.filter((t) => Math.abs(t.value - value) < 0.01);
  if (!matching.length) return [];
  const self = axis === 'x' ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width];
  const finite = matching.filter((t) => t.from > -1e5);
  const from = Math.min(self[0]!, ...finite.map((t) => t.from));
  const to = Math.max(self[1]!, ...finite.map((t) => t.to));
  if (finite.length < matching.length) return [{ axis, position: value, from: -1e6, to: 1e6 }];
  return [{ axis, position: value, from, to }];
}

/**
 * Snaps a moving rect to targets. Returns the adjusted offset and the guide lines to draw.
 * `edges` restricts which edges participate (used when resizing a single edge).
 */
export function snapRect(
  rect: Rect,
  targets: SnapTargets,
  threshold: number,
  edges: { x?: ('start' | 'center' | 'end')[]; y?: ('start' | 'center' | 'end')[] } = {},
): { dx: number; dy: number; lines: SnapLine[] } {
  const xEdges = edges.x ?? ['start', 'center', 'end'];
  const yEdges = edges.y ?? ['start', 'center', 'end'];
  const pick = (start: number, size: number, which: ('start' | 'center' | 'end')[]) =>
    which.map((w) => (w === 'start' ? start : w === 'center' ? start + size / 2 : start + size));
  const sx = xEdges.length ? bestSnap(pick(rect.x, rect.width, xEdges), targets.xs, threshold) : null;
  const sy = yEdges.length ? bestSnap(pick(rect.y, rect.height, yEdges), targets.ys, threshold) : null;
  const dx = sx?.delta ?? 0;
  const dy = sy?.delta ?? 0;
  const snapped = { ...rect, x: rect.x + dx, y: rect.y + dy };
  const lines: SnapLine[] = [];
  if (sx) lines.push(...linesFor('x', sx.value, snapped, targets.xs));
  if (sy) lines.push(...linesFor('y', sy.value, snapped, targets.ys));
  return { dx, dy, lines };
}

/* ------------------------------------------------------------------ */
/* Resize                                                              */
/* ------------------------------------------------------------------ */

export type HandleDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function resizeRect(
  start: Rect,
  dir: HandleDir,
  dx: number,
  dy: number,
  opts: { keepAspect?: boolean; fromCenter?: boolean } = {},
): Rect {
  let { x, y, width: w, height: h } = start;
  const hasW = dir.includes('w');
  const hasE = dir.includes('e');
  const hasN = dir.includes('n');
  const hasS = dir.includes('s');
  const k = opts.fromCenter ? 2 : 1;
  if (hasE) w = start.width + dx * k;
  if (hasW) w = start.width - dx * k;
  if (hasS) h = start.height + dy * k;
  if (hasN) h = start.height - dy * k;
  if (opts.keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if ((hasE || hasW) && (hasN || hasS)) {
      if (Math.abs(w / start.width) > Math.abs(h / start.height)) h = w / ratio;
      else w = h * ratio;
    } else if (hasE || hasW) h = w / ratio;
    else w = h * ratio;
  }
  // Allow flipping through zero by normalizing.
  const flipX = w < 0;
  const flipY = h < 0;
  w = Math.abs(w);
  h = Math.abs(h);
  if (opts.fromCenter) {
    x = start.x + start.width / 2 - w / 2;
    y = start.y + start.height / 2 - h / 2;
  } else {
    if (hasW) x = flipX ? start.x + start.width : start.x + start.width - w;
    else if (hasE) x = flipX ? start.x - w : start.x;
    else if (opts.keepAspect) x = start.x + start.width / 2 - w / 2;
    if (hasN) y = flipY ? start.y + start.height : start.y + start.height - h;
    else if (hasS) y = flipY ? start.y - h : start.y;
    else if (opts.keepAspect) y = start.y + start.height / 2 - h / 2;
  }
  return { x, y, width: w, height: h };
}

export const round = (v: number, precision = 100) => Math.round(v * precision) / precision;
