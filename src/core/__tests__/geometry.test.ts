import { describe, expect, it } from 'vitest';
import { buildSnapTargets, resizeRect, snapRect, unionRects } from '../geometry';

describe('geometry', () => {
  it('unions rects', () => {
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 5, width: 5, height: 20 }])).toEqual({ x: 0, y: 0, width: 25, height: 25 });
    expect(unionRects([])).toBeNull();
  });

  it('snaps edges and centers within threshold', () => {
    const targets = buildSnapTargets([{ x: 100, y: 100, width: 100, height: 50 }]);
    const res = snapRect({ x: 197, y: 300, width: 40, height: 40 }, targets, 5);
    expect(res.dx).toBe(3); // left edge -> 200 (right edge of target)
    expect(res.lines.some((l) => l.axis === 'x' && l.position === 200)).toBe(true);
    const none = snapRect({ x: 400, y: 400, width: 10, height: 10 }, targets, 5);
    expect(none.dx).toBe(0);
    expect(none.dy).toBe(0);
  });

  it('snaps to guides', () => {
    const targets = buildSnapTargets([], [{ axis: 'y', position: 64 }]);
    expect(snapRect({ x: 0, y: 61, width: 10, height: 40 }, targets, 4).dy).toBe(3);
    expect(snapRect({ x: 0, y: 61, width: 10, height: 10 }, targets, 4).dy).toBe(-2); // center is closer
  });

  it('resizes from any handle, with aspect lock and flipping', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    expect(resizeRect(r, 'se', 20, 10)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(resizeRect(r, 'nw', 10, 10)).toEqual({ x: 10, y: 10, width: 90, height: 40 });
    expect(resizeRect(r, 'e', 50, 0, { keepAspect: true }).height).toBe(75);
    expect(resizeRect(r, 'e', -150, 0)).toEqual({ x: -50, y: 0, width: 50, height: 50 });
  });
});
