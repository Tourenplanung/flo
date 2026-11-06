/**
 * Maps Tailwind utility classes and inline CSS to a small, framework-neutral style spec that
 * the React importer turns into flö layers. Unknown classes are reported, never guessed.
 */

export interface StyleSpec {
  display?: 'flex' | 'grid' | 'block' | 'inline' | 'none';
  /** inline-level box (inline-flex, inline-block, inline-grid, inline). */
  inline?: boolean;
  direction?: 'row' | 'column';
  wrap?: boolean;
  gridCols?: number;
  gap?: number;
  pt?: number;
  pr?: number;
  pb?: number;
  pl?: number;
  /** Margins (converted to auto-layout gaps by the importer). */
  mt?: number;
  mr?: number;
  mb?: number;
  ml?: number;
  width?: number | 'fill' | 'hug';
  height?: number | 'fill' | 'hug';
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'space-between';
  grow?: boolean;
  bg?: string;
  bgOpacity?: number;
  gradient?: { from?: string; via?: string; to?: string; angle: number };
  color?: string;
  colorOpacity?: number;
  fontSize?: number;
  lineHeight?: number; // px
  lineHeightRatio?: number;
  fontWeight?: number;
  letterSpacing?: number; // px (em values are converted later with fontSize)
  letterSpacingEm?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  italic?: boolean;
  textCase?: 'upper' | 'lower' | 'title' | 'none';
  decoration?: 'underline' | 'line-through' | 'none';
  fontFamily?: 'sans' | 'serif' | 'mono';
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  opacity?: number;
  hidden?: boolean;
  absolute?: boolean;
}

/** Text properties inherited by descendants (CSS inheritance). */
export const INHERITED: (keyof StyleSpec)[] = ['color', 'colorOpacity', 'fontSize', 'lineHeight', 'lineHeightRatio', 'fontWeight', 'letterSpacing', 'letterSpacingEm', 'textAlign', 'italic', 'textCase', 'fontFamily'];

/* ------------------------------------------------------------------ */
/* Tailwind theme (v3 defaults)                                        */
/* ------------------------------------------------------------------ */

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const PALETTE_RAW: Record<string, string> = {
  slate: 'f8fafc f1f5f9 e2e8f0 cbd5e1 94a3b8 64748b 475569 334155 1e293b 0f172a 020617',
  gray: 'f9fafb f3f4f6 e5e7eb d1d5db 9ca3af 6b7280 4b5563 374151 1f2937 111827 030712',
  zinc: 'fafafa f4f4f5 e4e4e7 d4d4d8 a1a1aa 71717a 52525b 3f3f46 27272a 18181b 09090b',
  neutral: 'fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717 0a0a0a',
  stone: 'fafaf9 f5f5f4 e7e5e4 d6d3d1 a8a29e 78716c 57534e 44403c 292524 1c1917 0c0a09',
  red: 'fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d 450a0a',
  orange: 'fff7ed ffedd5 fed7aa fdba74 fb923c f97316 ea580c c2410c 9a3412 7c2d12 431407',
  amber: 'fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f 451a03',
  yellow: 'fefce8 fef9c3 fef08a fde047 facc15 eab308 ca8a04 a16207 854d0e 713f12 422006',
  lime: 'f7fee7 ecfccb d9f99d bef264 a3e635 84cc16 65a30d 4d7c0f 3f6212 365314 1a2e05',
  green: 'f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d 052e16',
  emerald: 'ecfdf5 d1fae5 a7f3d0 6ee7b7 34d399 10b981 059669 047857 065f46 064e3b 022c22',
  teal: 'f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a 042f2e',
  cyan: 'ecfeff cffafe a5f3fc 67e8f9 22d3ee 06b6d4 0891b2 0e7490 155e75 164e63 083344',
  sky: 'f0f9ff e0f2fe bae6fd 7dd3fc 38bdf8 0ea5e9 0284c7 0369a1 075985 0c4a6e 082f49',
  blue: 'eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a 172554',
  indigo: 'eef2ff e0e7ff c7d2fe a5b4fc 818cf8 6366f1 4f46e5 4338ca 3730a3 312e81 1e1b4b',
  violet: 'f5f3ff ede9fe ddd6fe c4b5fd a78bfa 8b5cf6 7c3aed 6d28d9 5b21b6 4c1d95 2e1065',
  purple: 'faf5ff f3e8ff e9d5ff d8b4fe c084fc a855f7 9333ea 7e22ce 6b21a8 581c87 3b0764',
  fuchsia: 'fdf4ff fae8ff f5d0fe f0abfc e879f9 d946ef c026d3 a21caf 86198f 701a75 4a044e',
  pink: 'fdf2f8 fce7f3 fbcfe8 f9a8d4 f472b6 ec4899 db2777 be185d 9d174d 831843 500724',
  rose: 'fff1f2 ffe4e6 fecdd3 fda4af fb7185 f43f5e e11d48 be123c 9f1239 881337 4c0519',
};

export const PALETTE: Record<string, string> = (() => {
  const out: Record<string, string> = { white: '#FFFFFF', black: '#000000' };
  for (const [name, list] of Object.entries(PALETTE_RAW)) {
    list.split(' ').forEach((hex, i) => (out[`${name}-${SHADES[i]}`] = `#${hex.toUpperCase()}`));
  }
  // shadcn/ui default theme (light, neutral) semantic colors.
  Object.assign(out, {
    background: '#FFFFFF',
    foreground: '#0A0A0A',
    card: '#FFFFFF',
    'card-foreground': '#0A0A0A',
    popover: '#FFFFFF',
    'popover-foreground': '#0A0A0A',
    primary: '#171717',
    'primary-foreground': '#FAFAFA',
    secondary: '#F5F5F5',
    'secondary-foreground': '#171717',
    muted: '#F5F5F5',
    'muted-foreground': '#737373',
    accent: '#F5F5F5',
    'accent-foreground': '#171717',
    destructive: '#EF4444',
    'destructive-foreground': '#FAFAFA',
    border: '#E5E5E5',
    input: '#E5E5E5',
    ring: '#0A0A0A',
  });
  return out;
})();

const FONT_SIZES: Record<string, [number, number]> = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  '2xl': [24, 32],
  '3xl': [30, 36],
  '4xl': [36, 40],
  '5xl': [48, 48],
  '6xl': [60, 60],
  '7xl': [72, 72],
  '8xl': [96, 96],
  '9xl': [128, 128],
};
const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const RADII: Record<string, number> = { none: 0, sm: 2, '': 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 9999 };
const MAX_W: Record<string, number> = { xs: 320, sm: 384, md: 448, lg: 512, xl: 576, '2xl': 672, '3xl': 768, '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280, prose: 650, 'screen-sm': 640, 'screen-md': 768, 'screen-lg': 1024, 'screen-xl': 1280, 'screen-2xl': 1536 };
const LEADING: Record<string, number> = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 };
const TRACKING: Record<string, number> = { tighter: -0.05, tight: -0.025, normal: 0, wide: 0.025, wider: 0.05, widest: 0.1 };
const SHADOWS = new Set(['sm', 'md', 'lg', 'xl', '2xl']);

/** Tailwind spacing scale: n × 4px, `px` = 1px, arbitrary `[12px]`. */
function spacing(v: string): number | null {
  if (v === 'px') return 1;
  if (v === '0') return 0;
  const arb = /^\[(-?[\d.]+)(px|rem)?\]$/.exec(v);
  if (arb) return Number(arb[1]) * (arb[2] === 'rem' ? 16 : 1);
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) * 4;
  return null;
}

function color(v: string): { hex: string; opacity?: number } | null {
  const [name, op] = v.split('/');
  const opacity = op ? (op.startsWith('[') ? Number(op.slice(1, -1)) : Number(op) / 100) : undefined;
  const arb = /^\[#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]$/.exec(name!);
  let hex: string | undefined;
  if (arb) hex = arb[1]!.length === 3 ? `#${arb[1]!.split('').map((c) => c + c).join('')}` : `#${arb[1]}`;
  else hex = PALETTE[name!];
  if (!hex) return null;
  return { hex: hex.toUpperCase(), opacity: opacity !== undefined && Number.isFinite(opacity) ? opacity : undefined };
}

function size(v: string): number | 'fill' | 'hug' | null {
  if (v === 'full' || v === 'screen') return 'fill';
  if (v === 'auto' || v === 'fit' || v === 'max' || v === 'min') return 'hug';
  if (/^\d+\/\d+$/.test(v)) return 'fill';
  return spacing(v);
}

/** Applies one utility class (without variant prefix). Returns false if not understood. */
export function applyClass(spec: StyleSpec, cls: string): boolean {
  const neg = cls.startsWith('-');
  const c = neg ? cls.slice(1) : cls;
  const m = (re: RegExp) => re.exec(c);
  let r: RegExpExecArray | null;

  switch (c) {
    case 'flex':
    case 'inline-flex':
      spec.display = 'flex';
      spec.inline = c === 'inline-flex';
      spec.direction ??= 'row';
      return true;
    case 'grid':
    case 'inline-grid':
      spec.display = 'grid';
      spec.inline = c === 'inline-grid';
      return true;
    case 'block':
    case 'inline-block':
      spec.display = 'block';
      spec.inline = c === 'inline-block';
      return true;
    case 'inline':
      spec.display = 'inline';
      spec.inline = true;
      return true;
    case 'hidden':
      spec.hidden = true;
      return true;
    case 'flex-row':
    case 'flex-row-reverse':
      spec.direction = 'row';
      return true;
    case 'flex-col':
    case 'flex-col-reverse':
      spec.direction = 'column';
      return true;
    case 'flex-wrap':
      spec.wrap = true;
      return true;
    case 'flex-nowrap':
      spec.wrap = false;
      return true;
    case 'flex-1':
    case 'grow':
    case 'flex-grow':
      spec.grow = true;
      return true;
    case 'italic':
      spec.italic = true;
      return true;
    case 'not-italic':
      spec.italic = false;
      return true;
    case 'uppercase':
      spec.textCase = 'upper';
      return true;
    case 'lowercase':
      spec.textCase = 'lower';
      return true;
    case 'capitalize':
      spec.textCase = 'title';
      return true;
    case 'underline':
      spec.decoration = 'underline';
      return true;
    case 'line-through':
      spec.decoration = 'line-through';
      return true;
    case 'no-underline':
      spec.decoration = 'none';
      return true;
    case 'border':
      spec.borderWidth = 1;
      spec.borderColor ??= PALETTE.border!;
      return true;
    case 'rounded':
      spec.radius = 4;
      return true;
    case 'shadow':
      spec.shadow = 'sm';
      return true;
    case 'absolute':
    case 'fixed':
      spec.absolute = true;
      return true;
    case 'relative':
    case 'static':
    case 'sticky':
      return true;
    case 'font-sans':
    case 'font-serif':
    case 'font-mono':
      spec.fontFamily = c.slice(5) as StyleSpec['fontFamily'];
      return true;
  }

  if ((r = m(/^items-(start|center|end|stretch|baseline)$/))) return (spec.align = r[1] === 'baseline' ? 'center' : (r[1] as StyleSpec['align'])), true;
  if ((r = m(/^justify-(start|center|end|between|around|evenly)$/))) {
    spec.justify = r[1] === 'between' || r[1] === 'around' || r[1] === 'evenly' ? 'space-between' : (r[1] as StyleSpec['justify']);
    return true;
  }
  if ((r = m(/^grid-cols-(\d+)$/))) return (spec.gridCols = Number(r[1])), true;
  if ((r = m(/^(gap|gap-x|gap-y|space-x|space-y)-(.+)$/))) {
    const v = spacing(r[2]!);
    if (v === null) return false;
    spec.gap = v;
    if (r[1] === 'space-y') spec.direction ??= 'column';
    if (r[1] === 'space-x') spec.direction ??= 'row';
    if (r[1]!.startsWith('space')) spec.display ??= 'flex';
    return true;
  }
  if ((r = m(/^(p|px|py|pt|pr|pb|pl)-(.+)$/))) {
    const v = spacing(r[2]!);
    if (v === null) return false;
    const k = r[1]!;
    if (k === 'p' || k === 'py' || k === 'pt') spec.pt = v;
    if (k === 'p' || k === 'py' || k === 'pb') spec.pb = v;
    if (k === 'p' || k === 'px' || k === 'pl') spec.pl = v;
    if (k === 'p' || k === 'px' || k === 'pr') spec.pr = v;
    return true;
  }
  if ((r = m(/^(m|mx|my|mt|mr|mb|ml)-(.+)$/))) {
    // Margins are expressed by auto-layout gaps; `auto` centers (handled by the importer).
    const v = r[2] === 'auto' ? 0 : spacing(r[2]!);
    if (v === null) return false;
    const k = r[1]!;
    const val = neg ? -v : v;
    if (k === 'm' || k === 'my' || k === 'mt') spec.mt = val;
    if (k === 'm' || k === 'my' || k === 'mb') spec.mb = val;
    if (k === 'm' || k === 'mx' || k === 'ml') spec.ml = val;
    if (k === 'm' || k === 'mx' || k === 'mr') spec.mr = val;
    return true;
  }
  if ((r = m(/^size-(.+)$/))) {
    const v = size(r[1]!);
    if (v === null) return false;
    spec.width = v;
    spec.height = v;
    return true;
  }
  if ((r = m(/^(w|h)-(.+)$/))) {
    const v = size(r[2]!);
    if (v === null) return false;
    if (r[1] === 'w') spec.width = v;
    else spec.height = v;
    return true;
  }
  if ((r = m(/^max-w-(.+)$/))) {
    const v = MAX_W[r[1]!] ?? spacing(r[1]!);
    if (v === null || v === undefined) return r[1] === 'full' || r[1] === 'none';
    spec.maxWidth = v;
    return true;
  }
  if ((r = m(/^min-h-(.+)$/))) {
    if (r[1] === 'screen') return (spec.minHeight = 800), true;
    const v = spacing(r[1]!);
    if (v === null) return r[1] === 'full' || r[1] === '0';
    spec.minHeight = v;
    return true;
  }
  if ((r = m(/^min-w-(.+)$/))) {
    const v = spacing(r[1]!);
    if (v === null) return r[1] === '0' || r[1] === 'full';
    spec.minWidth = v;
    return true;
  }
  if ((r = m(/^max-h-(.+)$/))) {
    const v = spacing(r[1]!);
    if (v === null) return false;
    spec.maxHeight = v;
    return true;
  }
  if ((r = m(/^text-(xs|sm|base|lg|xl|[2-9]xl)$/))) {
    const [fs, lh] = FONT_SIZES[r[1]!]!;
    spec.fontSize = fs;
    spec.lineHeight = lh;
    return true;
  }
  if ((r = m(/^text-\[(\d+(?:\.\d+)?)(px|rem)\]$/))) return (spec.fontSize = Number(r[1]) * (r[2] === 'rem' ? 16 : 1)), (spec.lineHeight = undefined), true;
  if ((r = m(/^text-(left|center|right|justify)$/))) return (spec.textAlign = r[1] as StyleSpec['textAlign']), true;
  if ((r = m(/^text-(.+)$/))) {
    const col = color(r[1]!);
    if (!col) return false;
    spec.color = col.hex;
    spec.colorOpacity = col.opacity;
    return true;
  }
  if ((r = m(/^font-(\w+)$/))) {
    const w = WEIGHTS[r[1]!];
    if (!w) return false;
    spec.fontWeight = w;
    return true;
  }
  if ((r = m(/^leading-(.+)$/))) {
    if (LEADING[r[1]!] !== undefined) return (spec.lineHeightRatio = LEADING[r[1]!]), (spec.lineHeight = undefined), true;
    const v = spacing(r[1]!);
    if (v === null) return false;
    spec.lineHeight = v;
    return true;
  }
  if ((r = m(/^tracking-(.+)$/))) {
    if (TRACKING[r[1]!] === undefined) return false;
    spec.letterSpacingEm = TRACKING[r[1]!];
    return true;
  }
  if ((r = m(/^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/))) {
    const angles: Record<string, number> = { t: 0, tr: 45, r: 90, br: 135, b: 180, bl: 225, l: 270, tl: 315 };
    spec.gradient = { ...(spec.gradient ?? {}), angle: angles[r[1]!]! };
    return true;
  }
  if ((r = m(/^(from|via|to)-(.+)$/))) {
    const col = color(r[2]!);
    if (!col) return false;
    spec.gradient = { angle: spec.gradient?.angle ?? 180, ...(spec.gradient ?? {}), [r[1]!]: col.hex };
    return true;
  }
  if ((r = m(/^bg-(.+)$/))) {
    if (r[1] === 'transparent') return (spec.bg = undefined), true;
    const col = color(r[1]!);
    if (!col) return false;
    spec.bg = col.hex;
    spec.bgOpacity = col.opacity;
    return true;
  }
  if ((r = m(/^rounded(?:-(?:t|b|l|r|tl|tr|bl|br))?(?:-(none|sm|md|lg|xl|2xl|3xl|full))?$/))) {
    spec.radius = RADII[r[1] ?? '']!;
    return true;
  }
  if ((r = m(/^border-(\d+)$/))) return (spec.borderWidth = Number(r[1])), (spec.borderColor ??= PALETTE.border!), true;
  if ((r = m(/^border-[xytrbl]$/))) return (spec.borderWidth ??= 1), (spec.borderColor ??= PALETTE.border!), true;
  if ((r = m(/^border-(.+)$/))) {
    const col = color(r[1]!);
    if (!col) return false;
    spec.borderColor = col.hex;
    return true;
  }
  if ((r = m(/^shadow-(.+)$/))) {
    if (r[1] === 'none') return (spec.shadow = undefined), true;
    if (!SHADOWS.has(r[1]!)) return false;
    spec.shadow = r[1] as StyleSpec['shadow'];
    return true;
  }
  if ((r = m(/^opacity-(\d+)$/))) return (spec.opacity = Number(r[1]) / 100), true;
  // Purely behavioural/visual-effect utilities with no static layout meaning.
  if (m(/^(transition|duration|ease|delay|animate|cursor|select|outline|ring|focus|overflow|z|inset|top|left|right|bottom|object|aspect|shrink|basis|order|self|place|content|truncate|whitespace|break|list|appearance|pointer-events|sr-only|antialiased|backdrop|blur|scale|rotate|translate|origin|underline-offset|decoration|fill|stroke|peer|group|line-clamp|col-span|row-span|container|prose)/)) return true;
  return false;
}

const VARIANT_DESKTOP = new Set(['sm', 'md', 'lg', 'xl', '2xl']);
const DISPLAY = new Set(['flex', 'inline-flex', 'grid', 'inline-grid', 'block', 'inline-block', 'inline']);

/**
 * Parses a class string into a mobile-first pair: `mobile` (unprefixed classes) and `desktop`
 * (unprefixed + sm:/md:/lg:/xl:). Interaction/state variants (hover:, focus:, dark: …) are ignored.
 */
export function parseClasses(classes: string, unknown: Set<string>): { mobile: StyleSpec; desktop: StyleSpec } {
  const mobile: StyleSpec = {};
  const desktopOnly: string[] = [];
  for (const raw of classes.split(/\s+/).filter(Boolean)) {
    const parts = raw.split(':');
    const util = parts.pop()!.replace(/^!/, '');
    if (parts.length === 0) {
      if (!applyClass(mobile, util)) unknown.add(util);
    } else if (parts.every((p) => VARIANT_DESKTOP.has(p))) desktopOnly.push(util);
    // other variants (hover:, focus:, dark:, group-hover: …) describe states, not the static design
  }
  const desktop: StyleSpec = { ...mobile, gradient: mobile.gradient ? { ...mobile.gradient } : undefined };
  for (const util of desktopOnly) if (!applyClass(desktop, util)) unknown.add(util);
  // `hidden md:flex`: a responsive display utility re-shows the element (Tailwind orders
  // `hidden` last only within the same variant).
  if (desktopOnly.some((u) => DISPLAY.has(u)) && !desktopOnly.includes('hidden')) desktop.hidden = false;
  return { mobile, desktop };
}

/* ------------------------------------------------------------------ */
/* Inline styles                                                       */
/* ------------------------------------------------------------------ */

const px = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
};

function cssColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return `#${s.slice(1).split('').map((c) => c + c).join('')}`.toUpperCase();
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const named: Record<string, string> = { white: '#FFFFFF', black: '#000000', red: '#FF0000', blue: '#0000FF', green: '#008000', gray: '#808080', grey: '#808080', transparent: '' };
  return named[s.toLowerCase()] || undefined;
}

function boxValues(v: unknown): [number, number, number, number] | null {
  if (typeof v === 'number') return [v, v, v, v];
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(px);
  if (parts.some((p) => p === undefined)) return null;
  const [a, b = a, c = a, d = b] = parts as number[];
  return [a!, b!, c!, d!];
}

/** Applies a static React inline style object. */
export function applyInlineStyle(spec: StyleSpec, style: Record<string, unknown>, unknown: Set<string>) {
  for (const [k, v] of Object.entries(style)) {
    switch (k) {
      case 'display':
        if (v === 'flex' || v === 'inline-flex') (spec.display = 'flex'), (spec.direction ??= 'row');
        else if (v === 'grid') spec.display = 'grid';
        else if (v === 'none') spec.hidden = true;
        break;
      case 'flexDirection':
        spec.direction = String(v).startsWith('column') ? 'column' : 'row';
        break;
      case 'flexWrap':
        spec.wrap = v === 'wrap';
        break;
      case 'gap':
        spec.gap = px(v) ?? spec.gap;
        break;
      case 'padding': {
        const b = boxValues(v);
        if (b) [spec.pt, spec.pr, spec.pb, spec.pl] = b;
        break;
      }
      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft': {
        const key = ({ paddingTop: 'pt', paddingRight: 'pr', paddingBottom: 'pb', paddingLeft: 'pl' } as const)[k];
        spec[key] = px(v) ?? spec[key];
        break;
      }
      case 'margin': {
        const b = boxValues(v);
        if (b) [spec.mt, spec.mr, spec.mb, spec.ml] = b;
        break;
      }
      case 'marginTop':
      case 'marginRight':
      case 'marginBottom':
      case 'marginLeft': {
        const key = ({ marginTop: 'mt', marginRight: 'mr', marginBottom: 'mb', marginLeft: 'ml' } as const)[k];
        spec[key] = px(v) ?? spec[key];
        break;
      }
      case 'width':
      case 'height': {
        const val = v === '100%' ? 'fill' : v === 'auto' || v === 'fit-content' ? 'hug' : px(v);
        if (val !== undefined) spec[k] = val;
        break;
      }
      case 'maxWidth':
      case 'minWidth':
      case 'maxHeight':
      case 'minHeight':
        spec[k] = px(v) ?? spec[k];
        break;
      case 'alignItems':
        spec.align = String(v).includes('center') ? 'center' : String(v).includes('end') ? 'end' : String(v) === 'stretch' ? 'stretch' : 'start';
        break;
      case 'justifyContent':
        spec.justify = String(v).includes('space') ? 'space-between' : String(v).includes('center') ? 'center' : String(v).includes('end') ? 'end' : 'start';
        break;
      case 'flex':
      case 'flexGrow':
        if (Number.parseFloat(String(v)) > 0) spec.grow = true;
        break;
      case 'background':
      case 'backgroundColor':
        spec.bg = cssColor(v) ?? spec.bg;
        break;
      case 'color':
        spec.color = cssColor(v) ?? spec.color;
        break;
      case 'fontSize':
        spec.fontSize = px(v) ?? spec.fontSize;
        break;
      case 'fontWeight':
        spec.fontWeight = typeof v === 'number' ? v : v === 'bold' ? 700 : Number(v) || spec.fontWeight;
        break;
      case 'lineHeight':
        if (typeof v === 'number' && v < 5) spec.lineHeightRatio = v;
        else spec.lineHeight = px(v) ?? spec.lineHeight;
        break;
      case 'letterSpacing':
        spec.letterSpacing = px(v) ?? spec.letterSpacing;
        break;
      case 'textAlign':
        if (['left', 'center', 'right', 'justify'].includes(String(v))) spec.textAlign = v as StyleSpec['textAlign'];
        break;
      case 'textTransform':
        spec.textCase = v === 'uppercase' ? 'upper' : v === 'lowercase' ? 'lower' : v === 'capitalize' ? 'title' : 'none';
        break;
      case 'fontStyle':
        spec.italic = v === 'italic';
        break;
      case 'borderRadius':
        spec.radius = px(v) ?? spec.radius;
        break;
      case 'border': {
        const m = /(\d+)px\s+\w+\s+(.+)/.exec(String(v));
        if (m) (spec.borderWidth = Number(m[1])), (spec.borderColor = cssColor(m[2]) ?? spec.borderColor);
        break;
      }
      case 'borderWidth':
        spec.borderWidth = px(v) ?? spec.borderWidth;
        break;
      case 'borderColor':
        spec.borderColor = cssColor(v) ?? spec.borderColor;
        break;
      case 'opacity':
        spec.opacity = Number(v);
        break;
      case 'boxShadow':
        if (v && v !== 'none') spec.shadow = 'md';
        break;
      default:
        unknown.add(`style.${k}`);
    }
  }
}
