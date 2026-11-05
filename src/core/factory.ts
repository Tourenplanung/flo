/**
 * Factories for new nodes, pages, projects and composite UI presets.
 * All output is plain schema-conformant data.
 */
import { createId } from './ids';
import {
  SCHEMA_VERSION,
  type AutoLayout,
  type DesignNode,
  type EllipseNode,
  type FrameNode,
  type GroupNode,
  type IconName,
  type IconNode,
  type ImageNode,
  type LineNode,
  type Page,
  type Paint,
  type Project,
  type RectNode,
  type TextNode,
} from './schema';

export const solid = (color: string, opacity = 1): Paint => ({ type: 'solid', color, opacity, visible: true });

type Base = Omit<DesignNode, 'type'>;

function base(name: string, parentId: string, x: number, y: number, width: number, height: number): Base {
  return {
    id: createId(),
    name,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    x,
    y,
    width,
    height,
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
    opacity: 1,
    layoutPositioning: 'absolute',
    sizing: { horizontal: 'fixed', vertical: 'fixed' },
    fills: [],
    stroke: null,
    radius: [0, 0, 0, 0],
    effects: [],
  };
}

export const NO_LAYOUT: AutoLayout = {
  mode: 'none',
  gap: 0,
  padding: [0, 0, 0, 0],
  primaryAlign: 'start',
  counterAlign: 'start',
  wrap: false,
};

export interface Box {
  parentId: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
}

export function createFrame(b: Box, extra: Partial<FrameNode> = {}): FrameNode {
  return {
    ...base(b.name ?? 'Frame', b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 100, b.height ?? 100),
    type: 'frame',
    fills: [solid('#FFFFFF')],
    clipContent: true,
    layout: { ...NO_LAYOUT },
    role: 'div',
    ...extra,
  };
}

export function createGroup(b: Box): GroupNode {
  return { ...base(b.name ?? 'Group', b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 0, b.height ?? 0), type: 'group' };
}

export function createRect(b: Box, extra: Partial<RectNode> = {}): RectNode {
  return {
    ...base(b.name ?? 'Rectangle', b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 100, b.height ?? 100),
    type: 'rect',
    fills: [solid('#D9D9DE')],
    ...extra,
  };
}

export function createEllipse(b: Box, extra: Partial<EllipseNode> = {}): EllipseNode {
  return {
    ...base(b.name ?? 'Ellipse', b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 100, b.height ?? 100),
    type: 'ellipse',
    fills: [solid('#D9D9DE')],
    ...extra,
  };
}

export function createLine(b: Box, extra: Partial<LineNode> = {}): LineNode {
  return {
    ...base(b.name ?? 'Line', b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 100, b.height ?? 0),
    type: 'line',
    flip: false,
    stroke: { color: '#1B1C22', opacity: 1, width: 1, visible: true },
    ...extra,
  };
}

export function createText(b: Box, extra: Partial<TextNode> = {}): TextNode {
  const characters = extra.characters ?? 'Testo';
  return {
    ...base(b.name ?? characters.slice(0, 40), b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 100, b.height ?? 24),
    type: 'text',
    sizing: { horizontal: 'hug', vertical: 'hug' },
    fills: [solid('#111216')],
    characters,
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    italic: false,
    lineHeight: { unit: 'percent', value: 140 },
    letterSpacing: 0,
    textAlign: 'left',
    textDecoration: 'none',
    textCase: 'none',
    role: 'p',
    ...extra,
  };
}

export function createImage(b: Box, extra: Partial<ImageNode> = {}): ImageNode {
  return {
    ...base(b.name ?? 'Image', b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 240, b.height ?? 160),
    type: 'image',
    fills: [solid('#E6E7EC')],
    assetId: null,
    fit: 'cover',
    alt: '',
    ...extra,
  };
}

export function createIcon(b: Box, icon: IconName = 'star', extra: Partial<IconNode> = {}): IconNode {
  return {
    ...base(b.name ?? icon, b.parentId, b.x ?? 0, b.y ?? 0, b.width ?? 24, b.height ?? 24),
    type: 'icon',
    icon,
    strokeWidth: 2,
    fills: [solid('#111216')],
    ...extra,
  };
}

export function createPage(name: string): Page {
  return { id: createId(), name, childIds: [], background: '#1E1F25', guides: [] };
}

export function createProject(name: string, pageName = 'Pagina 1'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId(),
    name,
    createdAt: Date.now(),
    pages: [createPage(pageName)],
    nodes: {},
    assets: {},
    workflows: [],
  };
}

/* ------------------------------------------------------------------ */
/* Frame presets                                                       */
/* ------------------------------------------------------------------ */

export interface FramePreset {
  id: string;
  group: 'desktop' | 'tablet' | 'mobile';
  name: string;
  width: number;
  height: number;
}

export const FRAME_PRESETS: FramePreset[] = [
  { id: 'desktop', group: 'desktop', name: 'Desktop', width: 1440, height: 1024 },
  { id: 'laptop', group: 'desktop', name: 'Laptop', width: 1280, height: 832 },
  { id: 'desktop-hd', group: 'desktop', name: 'Desktop HD', width: 1920, height: 1080 },
  { id: 'tablet', group: 'tablet', name: 'Tablet', width: 768, height: 1024 },
  { id: 'tablet-landscape', group: 'tablet', name: 'Tablet orizzontale', width: 1024, height: 768 },
  { id: 'mobile', group: 'mobile', name: 'Mobile', width: 390, height: 844 },
  { id: 'mobile-small', group: 'mobile', name: 'Mobile S', width: 360, height: 640 },
  { id: 'mobile-large', group: 'mobile', name: 'Mobile L', width: 430, height: 932 },
];

/* ------------------------------------------------------------------ */
/* Composite UI presets (structured, fully editable node trees)       */
/* ------------------------------------------------------------------ */

/** A subtree ready to be inserted: `root` first, followed by its descendants. */
export interface NodeTree {
  root: DesignNode;
  nodes: DesignNode[];
}

function tree(root: DesignNode, children: DesignNode[]): NodeTree {
  root.childIds = children.filter((c) => c.parentId === root.id).map((c) => c.id);
  return { root, nodes: [root, ...children] };
}

const flow = { layoutPositioning: 'auto' as const };

export type UIPreset = 'button' | 'input' | 'card' | 'navbar' | 'section' | 'container';

export const UI_PRESETS: UIPreset[] = ['button', 'input', 'card', 'navbar', 'section', 'container'];

export function createPreset(kind: UIPreset, parentId: string, x: number, y: number): NodeTree {
  switch (kind) {
    case 'button': {
      const root = createFrame(
        { parentId, x, y, width: 140, height: 44, name: 'Button' },
        {
          role: 'button',
          fills: [solid('#6D5BFF')],
          radius: [10, 10, 10, 10],
          sizing: { horizontal: 'hug', vertical: 'hug' },
          layout: { mode: 'horizontal', gap: 8, padding: [12, 20, 12, 20], primaryAlign: 'center', counterAlign: 'center', wrap: false },
        },
      );
      const label = createText(
        { parentId: root.id, name: 'Label' },
        { ...flow, characters: 'Inizia ora', fontWeight: 600, fontSize: 15, fills: [solid('#FFFFFF')], lineHeight: { unit: 'percent', value: 130 }, role: 'span' },
      );
      return tree(root, [label]);
    }
    case 'input': {
      const root = createFrame(
        { parentId, x, y, width: 320, height: 72, name: 'Input field' },
        {
          fills: [],
          clipContent: false,
          sizing: { horizontal: 'fixed', vertical: 'hug' },
          layout: { mode: 'vertical', gap: 6, padding: [0, 0, 0, 0], primaryAlign: 'start', counterAlign: 'start', wrap: false },
        },
      );
      const label = createText(
        { parentId: root.id, name: 'Label' },
        { ...flow, characters: 'Email', fontSize: 13, fontWeight: 500, fills: [solid('#3A3B44')], role: 'label' },
      );
      const box = createFrame(
        { parentId: root.id, width: 320, height: 44, name: 'Field' },
        {
          ...flow,
          role: 'input',
          fills: [solid('#FFFFFF')],
          stroke: { color: '#C9CAD3', opacity: 1, width: 1, visible: true },
          radius: [8, 8, 8, 8],
          sizing: { horizontal: 'fill', vertical: 'fixed' },
          layout: { mode: 'horizontal', gap: 8, padding: [0, 14, 0, 14], primaryAlign: 'start', counterAlign: 'center', wrap: false },
        },
      );
      const placeholder = createText(
        { parentId: box.id, name: 'Placeholder' },
        { ...flow, characters: 'nome@esempio.it', fontSize: 15, fills: [solid('#8D8E99')], role: 'span' },
      );
      box.childIds = [placeholder.id];
      return tree(root, [label, box, placeholder]);
    }
    case 'card': {
      const root = createFrame(
        { parentId, x, y, width: 320, height: 360, name: 'Card' },
        {
          role: 'article',
          fills: [solid('#FFFFFF')],
          radius: [16, 16, 16, 16],
          stroke: { color: '#E4E5EB', opacity: 1, width: 1, visible: true },
          effects: [{ type: 'drop-shadow', x: 0, y: 8, blur: 24, spread: -8, color: '#101018', opacity: 0.14, visible: true }],
          sizing: { horizontal: 'fixed', vertical: 'hug' },
          layout: { mode: 'vertical', gap: 12, padding: [16, 16, 20, 16], primaryAlign: 'start', counterAlign: 'start', wrap: false },
        },
      );
      const img = createImage({ parentId: root.id, width: 288, height: 160, name: 'Cover' }, { ...flow, radius: [10, 10, 10, 10], sizing: { horizontal: 'fill', vertical: 'fixed' } });
      const title = createText(
        { parentId: root.id, name: 'Title' },
        { ...flow, characters: 'Titolo della card', fontSize: 20, fontWeight: 700, role: 'h3', lineHeight: { unit: 'percent', value: 125 } },
      );
      const body = createText(
        { parentId: root.id, name: 'Description' },
        {
          ...flow,
          characters: 'Una breve descrizione che spiega il contenuto della card.',
          fontSize: 15,
          fills: [solid('#5A5B66')],
          sizing: { horizontal: 'fill', vertical: 'hug' },
        },
      );
      return tree(root, [img, title, body]);
    }
    case 'navbar': {
      const root = createFrame(
        { parentId, x, y, width: 1200, height: 72, name: 'Navbar' },
        {
          role: 'nav',
          fills: [solid('#FFFFFF')],
          sizing: { horizontal: 'fixed', vertical: 'hug' },
          layout: { mode: 'horizontal', gap: 32, padding: [20, 32, 20, 32], primaryAlign: 'space-between', counterAlign: 'center', wrap: false },
        },
      );
      const logo = createText({ parentId: root.id, name: 'Logo' }, { ...flow, characters: 'Brand', fontSize: 22, fontWeight: 800, role: 'span' });
      const links = createFrame(
        { parentId: root.id, name: 'Links' },
        {
          ...flow,
          fills: [],
          clipContent: false,
          sizing: { horizontal: 'hug', vertical: 'hug' },
          layout: { mode: 'horizontal', gap: 28, padding: [0, 0, 0, 0], primaryAlign: 'start', counterAlign: 'center', wrap: false },
        },
      );
      const linkNodes = ['Prodotto', 'Prezzi', 'Chi siamo', 'Contatti'].map((label) =>
        createText({ parentId: links.id, name: label }, { ...flow, characters: label, fontSize: 15, fontWeight: 500, fills: [solid('#3A3B44')], role: 'a' }),
      );
      links.childIds = linkNodes.map((n) => n.id);
      return tree(root, [logo, links, ...linkNodes]);
    }
    case 'section': {
      const root = createFrame(
        { parentId, x, y, width: 1200, height: 480, name: 'Hero section' },
        {
          role: 'section',
          fills: [solid('#F5F5F8')],
          sizing: { horizontal: 'fixed', vertical: 'hug' },
          layout: { mode: 'vertical', gap: 20, padding: [96, 64, 96, 64], primaryAlign: 'start', counterAlign: 'center', wrap: false },
        },
      );
      const heading = createText(
        { parentId: root.id, name: 'Heading' },
        { ...flow, characters: 'Progetta interfacce più velocemente', fontSize: 56, fontWeight: 800, role: 'h1', textAlign: 'center', lineHeight: { unit: 'percent', value: 110 }, letterSpacing: -1.5 },
      );
      const sub = createText(
        { parentId: root.id, name: 'Supporting text' },
        {
          ...flow,
          characters: 'Un testo di supporto che descrive la proposta di valore in una o due frasi.',
          fontSize: 19,
          fills: [solid('#5A5B66')],
          textAlign: 'center',
        },
      );
      const cta = createPreset('button', root.id, 0, 0);
      cta.root.layoutPositioning = 'auto';
      return tree(root, [heading, sub, ...cta.nodes]);
    }
    case 'container': {
      const root = createFrame(
        { parentId, x, y, width: 400, height: 240, name: 'Container' },
        {
          fills: [solid('#FFFFFF')],
          radius: [12, 12, 12, 12],
          layout: { mode: 'vertical', gap: 16, padding: [24, 24, 24, 24], primaryAlign: 'start', counterAlign: 'start', wrap: false },
        },
      );
      return tree(root, []);
    }
  }
}
