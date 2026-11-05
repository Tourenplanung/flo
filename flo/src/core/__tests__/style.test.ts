import { describe, expect, it } from 'vitest';
import { createFrame, createPreset, createText, solid } from '../factory';
import { fillsToBackground, fontStack, nodeStyle } from '../style';

describe('nodeStyle', () => {
  it('positions absolute children and maps fills/radius/stroke', () => {
    const f = createFrame({ parentId: 'p', x: 10, y: 20, width: 300, height: 200 }, {
      radius: [8, 8, 8, 8],
      stroke: { color: '#000000', opacity: 0.5, width: 2, visible: true },
    });
    const css = nodeStyle(f, { parent: null });
    expect(css).toMatchObject({ position: 'absolute', left: '10px', top: '20px', width: '300px', height: '200px', borderRadius: '8px' });
    expect(css.border).toBe('2px solid rgba(0, 0, 0, 0.5)');
    expect(css.background).toBe('rgb(255, 255, 255)');
  });

  it('maps auto-layout to flexbox and flow children sizing', () => {
    const { root, nodes } = createPreset('navbar', 'p', 0, 0);
    const css = nodeStyle(root, { parent: null });
    expect(css).toMatchObject({ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: '32px', height: 'auto' });
    const logo = nodes[1]!;
    const childCss = nodeStyle(logo, { parent: root });
    expect(childCss.position).toBe('relative');
    expect(childCss.left).toBeUndefined();
    expect(childCss.width).toBe('max-content');
  });

  it('maps fill sizing on primary and counter axes', () => {
    const parent = createFrame({ parentId: 'p' }, { layout: { mode: 'vertical', gap: 0, padding: [0, 0, 0, 0], primaryAlign: 'start', counterAlign: 'start', wrap: false } });
    const child = createFrame({ parentId: parent.id }, { layoutPositioning: 'auto', sizing: { horizontal: 'fill', vertical: 'fill' } });
    const css = nodeStyle(child, { parent });
    expect(css.alignSelf).toBe('stretch');
    expect(css.flexGrow).toBe(1);
  });

  it('maps typography', () => {
    const t = createText({ parentId: 'p' }, { fontSize: 32, fontWeight: 700, lineHeight: { unit: 'percent', value: 120 }, textCase: 'upper', fills: [solid('#112233')] });
    const css = nodeStyle(t, { parent: null });
    expect(css).toMatchObject({ fontSize: '32px', fontWeight: 700, lineHeight: '1.2', textTransform: 'uppercase', color: 'rgb(17, 34, 51)', whiteSpace: 'pre' });
    expect(fontStack('Inter')).toContain('Inter Variable');
  });

  it('stacks multiple fills top-most first', () => {
    const bg = fillsToBackground([solid('#000000'), { type: 'linear-gradient', angle: 90, opacity: 1, visible: true, stops: [{ color: '#FF0000', position: 0 }, { color: '#0000FF', position: 1 }] }]);
    expect(bg?.startsWith('linear-gradient(90deg')).toBe(true);
    expect(fillsToBackground([{ ...solid('#000000'), visible: false }])).toBeUndefined();
  });
});
