/** Deterministic design validation: accessibility, consistency and responsiveness. */
import type { DesignNode, Project } from '../schema';
import type { ReportIssue, ReportValue, StylesValue } from './catalog';
import { blend, contrastRatio, hexToRgb, type RGB } from './color';

type Lang = 'it' | 'en';
const M = (lang: Lang, it: string, en: string) => (lang === 'it' ? it : en);

function walk(project: Project, rootIds: string[], fn: (n: DesignNode, ancestors: DesignNode[]) => void) {
  const visit = (id: string, ancestors: DesignNode[]) => {
    const n = project.nodes[id];
    if (!n || !n.visible) return;
    fn(n, ancestors);
    n.childIds.forEach((c) => visit(c, [...ancestors, n]));
  };
  rootIds.forEach((id) => visit(id, []));
}

/** Effective background behind a node: composite of its ancestors' visible solid fills over white. */
export function effectiveBackground(ancestors: DesignNode[]): RGB {
  let bg: RGB = [255, 255, 255];
  for (const a of ancestors) {
    if (a.type === 'text' || a.type === 'line' || a.type === 'icon') continue;
    for (const f of a.fills) {
      if (!f.visible) continue;
      if (f.type === 'solid') bg = blend(bg, hexToRgb(f.color), f.opacity * a.opacity);
      else {
        // Approximate gradients by the average of their stops.
        const avg = f.stops.map((s) => hexToRgb(s.color)).reduce((acc, c) => [acc[0] + c[0] / f.stops.length, acc[1] + c[1] / f.stops.length, acc[2] + c[2] / f.stops.length] as RGB, [0, 0, 0] as RGB);
        bg = blend(bg, avg, f.opacity * a.opacity);
      }
    }
  }
  return bg;
}

function textColor(n: DesignNode): { rgb: RGB; alpha: number } | null {
  const f = [...n.fills].reverse().find((x) => x.visible && x.type === 'solid');
  return f && f.type === 'solid' ? { rgb: hexToRgb(f.color), alpha: f.opacity * n.opacity } : null;
}

export function accessibilityReport(project: Project, rootIds: string[], level: 'AA' | 'AAA', lang: Lang): ReportValue {
  const issues: ReportIssue[] = [];
  let checked = 0;
  walk(project, rootIds, (n, ancestors) => {
    checked++;
    if (n.type === 'text') {
      const tc = textColor(n);
      if (tc && n.characters.trim()) {
        const bg = effectiveBackground(ancestors);
        const fg = blend(bg, tc.rgb, tc.alpha);
        const ratio = contrastRatio(fg, bg);
        const large = n.fontSize >= 24 || (n.fontSize >= 18.66 && n.fontWeight >= 700);
        const min = level === 'AAA' ? (large ? 4.5 : 7) : large ? 3 : 4.5;
        if (ratio < min) {
          issues.push({
            severity: 'error',
            nodeId: n.id,
            message: M(lang, `Contrasto insufficiente in “${n.name}”: ${ratio.toFixed(2)}:1 (minimo ${min}:1)`, `Insufficient contrast in “${n.name}”: ${ratio.toFixed(2)}:1 (min ${min}:1)`),
          });
        }
      }
      if (n.fontSize < 12) issues.push({ severity: 'warning', nodeId: n.id, message: M(lang, `Testo troppo piccolo in “${n.name}” (${n.fontSize}px)`, `Text too small in “${n.name}” (${n.fontSize}px)`) });
    }
    if (n.type === 'image' && !n.alt.trim()) {
      issues.push({ severity: 'warning', nodeId: n.id, message: M(lang, `Immagine “${n.name}” senza testo alternativo`, `Image “${n.name}” has no alt text`) });
    }
    const interactive = (n.type === 'frame' && (n.role === 'button' || n.role === 'link' || n.role === 'input')) || (n.type === 'text' && n.role === 'a');
    if (interactive && n.sizing.vertical === 'fixed' && n.height < 44 && n.type === 'frame') {
      issues.push({ severity: 'warning', nodeId: n.id, message: M(lang, `Target interattivo basso in “${n.name}” (${Math.round(n.height)}px, consigliato ≥ 44px)`, `Small touch target in “${n.name}” (${Math.round(n.height)}px, recommended ≥ 44px)`) });
    }
  });
  // Heading hierarchy per top-level frame.
  for (const root of rootIds) {
    const levels: number[] = [];
    walk(project, [root], (n) => {
      if (n.type === 'text' && /^h[1-6]$/.test(n.role)) levels.push(Number(n.role[1]));
    });
    const name = project.nodes[root]?.name ?? root;
    const h1 = levels.filter((x) => x === 1).length;
    if (h1 !== 1) issues.push({ severity: 'warning', nodeId: root, message: M(lang, `“${name}” ha ${h1} titoli h1 (atteso 1)`, `“${name}” has ${h1} h1 headings (expected 1)`) });
    for (let i = 1; i < levels.length; i++) {
      if (levels[i]! - levels[i - 1]! > 1) {
        issues.push({ severity: 'info', nodeId: root, message: M(lang, `“${name}”: salto di livello nei titoli (h${levels[i - 1]} → h${levels[i]})`, `“${name}”: skipped heading level (h${levels[i - 1]} → h${levels[i]})`) });
        break;
      }
    }
  }
  return { type: 'report', title: M(lang, `Accessibilità WCAG ${level}`, `WCAG ${level} accessibility`), checked, issues };
}

export function consistencyReport(project: Project, rootIds: string[], styles: StylesValue | undefined, lang: Lang): ReportValue {
  const issues: ReportIssue[] = [];
  const sizes = new Set<number>();
  const families = new Set<string>();
  const textColors = new Set<string>();
  const fillColors = new Set<string>();
  const radii = new Set<number>();
  let checked = 0;
  walk(project, rootIds, (n) => {
    checked++;
    if (n.type === 'text') {
      sizes.add(n.fontSize);
      families.add(n.fontFamily);
    }
    for (const f of n.fills) if (f.visible && f.type === 'solid') (n.type === 'text' ? textColors : fillColors).add(f.color.toUpperCase());
    if (n.type !== 'text' && n.type !== 'ellipse') for (const r of n.radius) if (r > 0) radii.add(r);
  });
  const warnIf = (count: number, max: number, it: string, en: string) => {
    if (count > max) issues.push({ severity: 'warning', message: M(lang, `${it}: ${count} (consigliati ≤ ${max})`, `${en}: ${count} (recommended ≤ ${max})`) });
  };
  warnIf(sizes.size, 7, 'Dimensioni di testo diverse', 'Distinct text sizes');
  warnIf(families.size, 2, 'Famiglie di font', 'Font families');
  warnIf(textColors.size, 5, 'Colori di testo diversi', 'Distinct text colors');
  warnIf(radii.size, 3, 'Raggi degli angoli diversi', 'Distinct corner radii');
  if (styles) {
    const palette = new Set(Object.values(styles.colors).map((c) => c.toUpperCase()));
    const off = [...textColors, ...fillColors].filter((c) => !palette.has(c) && c !== '#FFFFFF' && c !== '#000000');
    for (const c of off.slice(0, 12)) issues.push({ severity: 'info', message: M(lang, `Colore ${c} non presente nella palette del design system`, `Color ${c} is not in the design-system palette`) });
    for (const f of families) if (f !== styles.fonts.heading && f !== styles.fonts.body) issues.push({ severity: 'warning', message: M(lang, `Font “${f}” non previsto dal design system`, `Font “${f}” is not part of the design system`) });
  }
  return { type: 'report', title: M(lang, 'Coerenza del design', 'Design consistency'), checked, issues };
}

export function responsiveReport(project: Project, rootIds: string[], lang: Lang): ReportValue {
  const issues: ReportIssue[] = [];
  let checked = 0;
  for (const root of rootIds) {
    const r = project.nodes[root];
    if (!r) continue;
    const frameWidth = r.width;
    walk(project, [root], (n, ancestors) => {
      checked++;
      const parent = ancestors[ancestors.length - 1];
      if (n !== r && n.sizing.horizontal === 'fixed' && n.width > frameWidth) {
        issues.push({ severity: 'error', nodeId: n.id, message: M(lang, `“${n.name}” è più largo del frame (${Math.round(n.width)} > ${frameWidth}px)`, `“${n.name}” is wider than the frame (${Math.round(n.width)} > ${frameWidth}px)`) });
      }
      if (parent?.type === 'frame' && parent.layout.mode === 'none' && n.layoutPositioning === 'absolute' && parent.layout.mode === 'none' && parent !== r && n.x + n.width > parent.width + 1) {
        issues.push({ severity: 'warning', nodeId: n.id, message: M(lang, `“${n.name}” esce dal contenitore “${parent.name}”`, `“${n.name}” overflows its container “${parent.name}”`) });
      }
      if (n.type === 'frame' && n.layout.mode === 'horizontal' && !n.layout.wrap) {
        const kids = n.childIds.map((id) => project.nodes[id]).filter((c): c is DesignNode => !!c && c.visible && c.layoutPositioning === 'auto');
        const fixedSum = kids.filter((c) => c.sizing.horizontal === 'fixed').reduce((s, c) => s + c.width, 0) + n.layout.gap * Math.max(0, kids.length - 1) + n.layout.padding[1] + n.layout.padding[3];
        const avail = n.sizing.horizontal === 'fixed' ? n.width : frameWidth;
        if (fixedSum > avail) {
          issues.push({ severity: 'warning', nodeId: n.id, message: M(lang, `La riga “${n.name}” non si adatta: contenuti fissi di ${Math.round(fixedSum)}px (attiva “A capo” o usa “Riempi”)`, `Row “${n.name}” cannot adapt: ${Math.round(fixedSum)}px of fixed content (enable wrap or use Fill)`) });
        }
      }
      if (parent?.type === 'frame' && parent.layout.mode !== 'none' && n.layoutPositioning === 'absolute') {
        issues.push({ severity: 'info', nodeId: n.id, message: M(lang, `“${n.name}” è in posizione assoluta dentro un auto layout`, `“${n.name}” is absolutely positioned inside an auto layout`) });
      }
    });
  }
  return { type: 'report', title: M(lang, 'Controllo responsive', 'Responsive check'), checked, issues };
}
