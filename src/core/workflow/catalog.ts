/**
 * Workflow node catalog: kinds, typed ports and parameter schemas.
 * Pure data + Zod — no execution code, so `core/ops.ts` can validate graphs without cycles.
 */
import { z } from 'zod';
import { HexColorSchema, IdSchema } from '../schema';

/* ------------------------------------------------------------------ */
/* Port types and the values that flow through them                    */
/* ------------------------------------------------------------------ */

export type PortType = 'brief' | 'sitemap' | 'flow' | 'design' | 'styles' | 'report' | 'image' | 'code' | 'any';

export interface BriefValue {
  type: 'brief';
  text: string;
}
export interface SitemapValue {
  type: 'sitemap';
  pages: { name: string; depth: number; children: string[] }[];
}
export interface FlowValue {
  type: 'flow';
  steps: string[];
}
export interface DesignValue {
  type: 'design';
  pageId: string;
  frameIds: string[];
}
export interface StylesValue {
  type: 'styles';
  colors: { primary: string; onPrimary: string; background: string; surface: string; text: string; muted: string; border: string };
  fonts: { heading: string; body: string };
  sizes: { h1: number; h2: number; h3: number; body: number; small: number };
  radius: number;
  spacing: number;
  /** Ids of project tokens written by the design-system node (when enabled). */
  tokenIds?: { colors: Record<string, string>; text: Record<string, string>; radius?: string };
}
export interface ReportIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
}
export interface ReportValue {
  type: 'report';
  title: string;
  checked: number;
  issues: ReportIssue[];
}
export interface ImageValue {
  type: 'image';
  assetId: string;
  notes: string;
}
export interface CodeValue {
  type: 'code';
  files: { path: string; content: string }[];
}

export type PortValue = BriefValue | SitemapValue | FlowValue | DesignValue | StylesValue | ReportValue | ImageValue | CodeValue;

export function portsCompatible(from: PortType, to: PortType): boolean {
  return from === to || to === 'any' || from === 'any';
}

/* ------------------------------------------------------------------ */
/* Node specs                                                          */
/* ------------------------------------------------------------------ */

export type Category = 'input' | 'ux' | 'design' | 'validation' | 'logic' | 'output';

export interface L10n {
  it: string;
  en: string;
}

export interface PortSpec {
  id: string;
  type: PortType;
  label: L10n;
  optional?: boolean;
}

export type FieldSpec =
  | { key: string; kind: 'text' | 'textarea' | 'color' | 'font' | 'asset' | 'page' | 'frames' | 'checkbox'; label: L10n; help?: L10n }
  | { key: string; kind: 'number'; label: L10n; min?: number; max?: number; step?: number; help?: L10n }
  | { key: string; kind: 'select'; label: L10n; options: { value: string; label: L10n }[]; help?: L10n };

export interface NodeSpec {
  kind: string;
  category: Category;
  label: L10n;
  description: L10n;
  inputs: PortSpec[];
  outputs: PortSpec[];
  params: z.ZodType<Record<string, unknown>>;
  defaults: Record<string, unknown>;
  fields: FieldSpec[];
  /** 'ai' nodes need a configured AI provider; 'planned' nodes ship in a later milestone. */
  availability: 'ready' | 'ai' | 'planned';
  /** Nodes that write to the design document. */
  sideEffects?: boolean;
}

const l = (it: string, en: string): L10n => ({ it, en });

const DEVICE = z.enum(['desktop', 'tablet', 'mobile']);
const deviceOptions = [
  { value: 'desktop', label: l('Desktop · 1440', 'Desktop · 1440') },
  { value: 'tablet', label: l('Tablet · 768', 'Tablet · 768') },
  { value: 'mobile', label: l('Mobile · 390', 'Mobile · 390') },
];
const FONT = z.string().min(1).max(100).regex(/^[A-Za-z0-9 _-]+$/);
const text = (max = 20_000) => z.string().max(max);

const spec = <S extends z.ZodObject<z.ZodRawShape>>(s: Omit<NodeSpec, 'params' | 'defaults'> & { params: S; defaults: z.infer<S> }): NodeSpec =>
  s as unknown as NodeSpec;

const noParams = z.object({});

export const NODE_SPECS: NodeSpec[] = [
  /* ---------------- INPUT ---------------- */
  spec({
    kind: 'brief-input',
    category: 'input',
    label: l('Brief', 'Brief'),
    description: l('Il brief di progetto scritto a mano.', 'The project brief, written by hand.'),
    inputs: [],
    outputs: [{ id: 'brief', type: 'brief', label: l('Brief', 'Brief') }],
    params: z.object({ text: text() }),
    defaults: { text: '' },
    fields: [{ key: 'text', kind: 'textarea', label: l('Testo del brief', 'Brief text'), help: l('Gli elenchi puntati (- Pagina) vengono usati dalla Sitemap.', 'Bullet lists (- Page) are used by the Sitemap node.') }],
    availability: 'ready',
  }),
  spec({
    kind: 'screenshot-input',
    category: 'input',
    label: l('Screenshot', 'Screenshot'),
    description: l('Uno screenshot di un’interfaccia esistente (risorsa immagine del progetto).', 'A screenshot of an existing interface (project image asset).'),
    inputs: [],
    outputs: [{ id: 'image', type: 'image', label: l('Immagine', 'Image') }],
    params: z.object({ assetId: IdSchema.nullable(), notes: text(2000) }),
    defaults: { assetId: null, notes: '' },
    fields: [
      { key: 'assetId', kind: 'asset', label: l('Immagine', 'Image') },
      { key: 'notes', kind: 'textarea', label: l('Note', 'Notes') },
    ],
    availability: 'ready',
  }),
  spec({
    kind: 'reference-input',
    category: 'input',
    label: l('Riferimento', 'Reference'),
    description: l('Un’immagine di riferimento o moodboard.', 'A reference image or moodboard.'),
    inputs: [],
    outputs: [{ id: 'image', type: 'image', label: l('Immagine', 'Image') }],
    params: z.object({ assetId: IdSchema.nullable(), notes: text(2000) }),
    defaults: { assetId: null, notes: '' },
    fields: [
      { key: 'assetId', kind: 'asset', label: l('Immagine', 'Image') },
      { key: 'notes', kind: 'textarea', label: l('Note', 'Notes') },
    ],
    availability: 'ready',
  }),
  spec({
    kind: 'design-input',
    category: 'input',
    label: l('Design esistente', 'Existing design'),
    description: l('Uno o più frame del documento di design.', 'One or more frames from the design document.'),
    inputs: [],
    outputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    params: z.object({ pageId: IdSchema.nullable(), frameIds: z.array(IdSchema).max(200) }),
    defaults: { pageId: null, frameIds: [] },
    fields: [
      { key: 'pageId', kind: 'page', label: l('Pagina', 'Page') },
      { key: 'frameIds', kind: 'frames', label: l('Frame', 'Frames'), help: l('Nessuna selezione = tutti i frame della pagina.', 'No selection = all frames on the page.') },
    ],
    availability: 'ready',
  }),

  /* ---------------- UX ---------------- */
  spec({
    kind: 'ux-analysis',
    category: 'ux',
    label: l('Analisi UX', 'UX analysis'),
    description: l('Analizza il brief: utenti, obiettivi, requisiti.', 'Analyses the brief: users, goals, requirements.'),
    inputs: [{ id: 'brief', type: 'brief', label: l('Brief', 'Brief') }],
    outputs: [{ id: 'report', type: 'report', label: l('Analisi', 'Analysis') }],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ai',
  }),
  spec({
    kind: 'sitemap',
    category: 'ux',
    label: l('Sitemap', 'Sitemap'),
    description: l('Struttura delle pagine. Indenta con due spazi per le sottopagine.', 'Page structure. Indent with two spaces for subpages.'),
    inputs: [{ id: 'brief', type: 'brief', label: l('Brief', 'Brief'), optional: true }],
    outputs: [{ id: 'sitemap', type: 'sitemap', label: l('Sitemap', 'Sitemap') }],
    params: z.object({ outline: text(10_000) }),
    defaults: { outline: '' },
    fields: [
      {
        key: 'outline',
        kind: 'textarea',
        label: l('Pagine', 'Pages'),
        help: l('Vuoto = usa gli elenchi puntati del brief.', 'Empty = use the bullet lists from the brief.'),
      },
    ],
    availability: 'ready',
  }),
  spec({
    kind: 'user-flow',
    category: 'ux',
    label: l('User flow', 'User flow'),
    description: l('Passi del percorso utente, uno per riga.', 'User journey steps, one per line.'),
    inputs: [{ id: 'sitemap', type: 'sitemap', label: l('Sitemap', 'Sitemap'), optional: true }],
    outputs: [{ id: 'flow', type: 'flow', label: l('Flusso', 'Flow') }],
    params: z.object({ steps: text(10_000) }),
    defaults: { steps: '' },
    fields: [{ key: 'steps', kind: 'textarea', label: l('Passi', 'Steps'), help: l('Vuoto = segue l’ordine della sitemap.', 'Empty = follows the sitemap order.') }],
    availability: 'ready',
  }),
  spec({
    kind: 'info-architecture',
    category: 'ux',
    label: l('Architettura informativa', 'Information architecture'),
    description: l('Organizza contenuti e navigazione a partire dal brief.', 'Organises content and navigation from the brief.'),
    inputs: [{ id: 'brief', type: 'brief', label: l('Brief', 'Brief') }],
    outputs: [{ id: 'sitemap', type: 'sitemap', label: l('Sitemap', 'Sitemap') }],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ai',
  }),

  /* ---------------- DESIGN ---------------- */
  spec({
    kind: 'wireframe',
    category: 'design',
    label: l('Wireframe', 'Wireframe'),
    description: l('Genera un frame wireframe modificabile per ogni pagina della sitemap.', 'Generates an editable wireframe frame for each sitemap page.'),
    inputs: [{ id: 'sitemap', type: 'sitemap', label: l('Sitemap', 'Sitemap') }],
    outputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    params: z.object({ device: DEVICE, pageName: z.string().min(1).max(200), brand: z.string().max(60) }),
    defaults: { device: 'desktop', pageName: 'Wireframe', brand: 'Brand' },
    fields: [
      { key: 'device', kind: 'select', label: l('Dispositivo', 'Device'), options: deviceOptions },
      { key: 'pageName', kind: 'text', label: l('Pagina di destinazione', 'Target page') },
      { key: 'brand', kind: 'text', label: l('Nome del brand', 'Brand name') },
    ],
    availability: 'ready',
    sideEffects: true,
  }),
  spec({
    kind: 'design-system',
    category: 'design',
    label: l('Design system', 'Design system'),
    description: l('Palette, tipografia, raggi e spaziature derivati da pochi parametri.', 'Palette, typography, radii and spacing derived from a few parameters.'),
    inputs: [],
    outputs: [{ id: 'styles', type: 'styles', label: l('Stili', 'Styles') }],
    params: z.object({
      primary: HexColorSchema,
      background: HexColorSchema,
      text: HexColorSchema,
      headingFont: FONT,
      bodyFont: FONT,
      baseSize: z.number().min(10).max(32),
      scale: z.number().min(1.05).max(1.8),
      radius: z.number().min(0).max(64),
      spacing: z.number().min(2).max(32),
      writeTokens: z.boolean(),
    }),
    defaults: {
      primary: '#6D5BFF',
      background: '#FFFFFF',
      text: '#14151A',
      headingFont: 'Inter',
      bodyFont: 'Inter',
      baseSize: 16,
      scale: 1.25,
      radius: 10,
      spacing: 8,
      writeTokens: false,
    },
    fields: [
      { key: 'primary', kind: 'color', label: l('Colore primario', 'Primary color') },
      { key: 'background', kind: 'color', label: l('Sfondo', 'Background') },
      { key: 'text', kind: 'color', label: l('Testo', 'Text') },
      { key: 'headingFont', kind: 'font', label: l('Font titoli', 'Heading font') },
      { key: 'bodyFont', kind: 'font', label: l('Font testo', 'Body font') },
      { key: 'baseSize', kind: 'number', label: l('Corpo base', 'Base size'), min: 10, max: 32 },
      { key: 'scale', kind: 'number', label: l('Scala tipografica', 'Type scale'), min: 1.05, max: 1.8, step: 0.05 },
      { key: 'radius', kind: 'number', label: l('Raggio', 'Radius'), min: 0, max: 64 },
      { key: 'spacing', kind: 'number', label: l('Unità di spaziatura', 'Spacing unit'), min: 2, max: 32 },
      {
        key: 'writeTokens',
        kind: 'checkbox',
        label: l('Scrivi come token del progetto', 'Write as project tokens'),
        help: l('Crea/aggiorna i token “ds/…”: i livelli stilizzati restano collegati e seguono le modifiche ai token.', 'Creates/updates “ds/…” tokens: styled layers stay bound and follow token edits.'),
      },
    ],
    availability: 'ready',
  }),
  spec({
    kind: 'apply-styles',
    category: 'design',
    label: l('Applica stile', 'Apply styles'),
    description: l('Trasforma un design (es. wireframe) in alta fedeltà usando il design system.', 'Turns a design (e.g. a wireframe) into high fidelity using the design system.'),
    inputs: [
      { id: 'design', type: 'design', label: l('Design', 'Design') },
      { id: 'styles', type: 'styles', label: l('Stili', 'Styles') },
    ],
    outputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    params: z.object({ mode: z.enum(['copy', 'in-place']) }),
    defaults: { mode: 'copy' },
    fields: [
      {
        key: 'mode',
        kind: 'select',
        label: l('Modalità', 'Mode'),
        options: [
          { value: 'copy', label: l('Crea una copia (variante)', 'Create a copy (variant)') },
          { value: 'in-place', label: l('Modifica l’originale', 'Edit the original') },
        ],
      },
    ],
    availability: 'ready',
    sideEffects: true,
  }),
  spec({
    kind: 'responsive-adapter',
    category: 'design',
    label: l('Adattatore responsive', 'Responsive adapter'),
    description: l('Crea una variante per un altro dispositivo adattando layout, spaziature e tipografia.', 'Creates a variant for another device by adapting layout, spacing and type.'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    params: z.object({ device: DEVICE }),
    defaults: { device: 'mobile' },
    fields: [{ key: 'device', kind: 'select', label: l('Dispositivo', 'Device'), options: deviceOptions }],
    availability: 'ready',
    sideEffects: true,
  }),
  spec({
    kind: 'component-generator',
    category: 'design',
    label: l('Generatore componenti', 'Component generator'),
    description: l('Genera componenti riutilizzabili da una descrizione.', 'Generates reusable components from a description.'),
    inputs: [
      { id: 'brief', type: 'brief', label: l('Brief', 'Brief') },
      { id: 'styles', type: 'styles', label: l('Stili', 'Styles'), optional: true },
    ],
    outputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    params: z.object({ device: DEVICE, pageName: z.string().min(1).max(200), instructions: text(4000) }),
    defaults: { device: 'desktop', pageName: 'AI', instructions: '' },
    fields: [
      { key: 'device', kind: 'select', label: l('Dispositivo', 'Device'), options: deviceOptions },
      { key: 'pageName', kind: 'text', label: l('Pagina di destinazione', 'Target page') },
      { key: 'instructions', kind: 'textarea', label: l('Istruzioni aggiuntive', 'Extra instructions') },
    ],
    availability: 'ai',
    sideEffects: true,
  }),
  spec({
    kind: 'ui-generator',
    category: 'design',
    label: l('Generatore schermate UI', 'UI screen generator'),
    description: l('Genera schermate ad alta fedeltà dal brief.', 'Generates high-fidelity screens from the brief.'),
    inputs: [
      { id: 'brief', type: 'brief', label: l('Brief', 'Brief') },
      { id: 'styles', type: 'styles', label: l('Stili', 'Styles'), optional: true },
    ],
    outputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    params: z.object({ device: DEVICE, pageName: z.string().min(1).max(200), instructions: text(4000) }),
    defaults: { device: 'desktop', pageName: 'AI', instructions: '' },
    fields: [
      { key: 'device', kind: 'select', label: l('Dispositivo', 'Device'), options: deviceOptions },
      { key: 'pageName', kind: 'text', label: l('Pagina di destinazione', 'Target page') },
      { key: 'instructions', kind: 'textarea', label: l('Istruzioni aggiuntive', 'Extra instructions') },
    ],
    availability: 'ai',
    sideEffects: true,
  }),

  /* ---------------- VALIDATION ---------------- */
  spec({
    kind: 'a11y-check',
    category: 'validation',
    label: l('Controllo accessibilità', 'Accessibility check'),
    description: l('Contrasto WCAG, dimensioni minime del testo, testo alternativo, target touch, gerarchia titoli.', 'WCAG contrast, minimum text size, alt text, touch targets, heading hierarchy.'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [{ id: 'report', type: 'report', label: l('Report', 'Report') }],
    params: z.object({ level: z.enum(['AA', 'AAA']) }),
    defaults: { level: 'AA' },
    fields: [
      {
        key: 'level',
        kind: 'select',
        label: l('Livello WCAG', 'WCAG level'),
        options: [
          { value: 'AA', label: l('AA', 'AA') },
          { value: 'AAA', label: l('AAA', 'AAA') },
        ],
      },
    ],
    availability: 'ready',
  }),
  spec({
    kind: 'consistency-check',
    category: 'validation',
    label: l('Coerenza del design', 'Design consistency'),
    description: l('Conta stili diversi (font, colori, raggi) e i colori fuori palette.', 'Counts distinct styles (fonts, colors, radii) and off-palette colors.'),
    inputs: [
      { id: 'design', type: 'design', label: l('Design', 'Design') },
      { id: 'styles', type: 'styles', label: l('Stili', 'Styles'), optional: true },
    ],
    outputs: [{ id: 'report', type: 'report', label: l('Report', 'Report') }],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ready',
  }),
  spec({
    kind: 'responsive-check',
    category: 'validation',
    label: l('Controllo responsive', 'Responsive check'),
    description: l('Trova elementi che escono dal frame e layout che non si adattano.', 'Finds elements overflowing the frame and layouts that do not adapt.'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [{ id: 'report', type: 'report', label: l('Report', 'Report') }],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ready',
  }),

  /* ---------------- LOGIC ---------------- */
  spec({
    kind: 'branch',
    category: 'logic',
    label: l('Diramazione', 'Branch'),
    description: l('Invia lo stesso valore a due rami per esplorare varianti.', 'Sends the same value to two branches to explore variants.'),
    inputs: [{ id: 'in', type: 'any', label: l('Ingresso', 'Input') }],
    outputs: [
      { id: 'a', type: 'any', label: l('Ramo A', 'Branch A') },
      { id: 'b', type: 'any', label: l('Ramo B', 'Branch B') },
    ],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ready',
  }),
  spec({
    kind: 'condition',
    category: 'logic',
    label: l('Condizione', 'Condition'),
    description: l('Instrada un report su “superato” o “non superato” in base alle soglie.', 'Routes a report to “pass” or “fail” based on thresholds.'),
    inputs: [{ id: 'report', type: 'report', label: l('Report', 'Report') }],
    outputs: [
      { id: 'pass', type: 'report', label: l('Superato', 'Pass') },
      { id: 'fail', type: 'report', label: l('Non superato', 'Fail') },
    ],
    params: z.object({ maxErrors: z.number().int().min(0).max(10_000), maxWarnings: z.number().int().min(0).max(10_000) }),
    defaults: { maxErrors: 0, maxWarnings: 10 },
    fields: [
      { key: 'maxErrors', kind: 'number', label: l('Errori massimi', 'Max errors'), min: 0 },
      { key: 'maxWarnings', kind: 'number', label: l('Avvisi massimi', 'Max warnings'), min: 0 },
    ],
    availability: 'ready',
  }),
  spec({
    kind: 'merge',
    category: 'logic',
    label: l('Unisci', 'Merge'),
    description: l('Prosegue con il primo ingresso disponibile (A, poi B).', 'Continues with the first available input (A, then B).'),
    inputs: [
      { id: 'a', type: 'any', label: l('A', 'A'), optional: true },
      { id: 'b', type: 'any', label: l('B', 'B'), optional: true },
    ],
    outputs: [{ id: 'out', type: 'any', label: l('Uscita', 'Output') }],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ready',
  }),
  spec({
    kind: 'compare',
    category: 'logic',
    label: l('Confronta varianti', 'Compare variants'),
    description: l('Mette a confronto due design e prosegue con quello scelto.', 'Compares two designs and continues with the chosen one.'),
    inputs: [
      { id: 'a', type: 'design', label: l('Variante A', 'Variant A') },
      { id: 'b', type: 'design', label: l('Variante B', 'Variant B') },
    ],
    outputs: [{ id: 'design', type: 'design', label: l('Scelta', 'Chosen') }],
    params: z.object({ choice: z.enum(['a', 'b']) }),
    defaults: { choice: 'a' },
    fields: [
      {
        key: 'choice',
        kind: 'select',
        label: l('Variante scelta', 'Chosen variant'),
        options: [
          { value: 'a', label: l('A', 'A') },
          { value: 'b', label: l('B', 'B') },
        ],
      },
    ],
    availability: 'ready',
  }),

  /* ---------------- OUTPUT ---------------- */
  spec({
    kind: 'canvas-output',
    category: 'output',
    label: l('Mostra nel canvas', 'Show in canvas'),
    description: l('Apre il risultato nel canvas di design per continuare a modificarlo.', 'Opens the result in the design canvas to keep editing it.'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ready',
  }),
  spec({
    kind: 'html-export',
    category: 'output',
    label: l('Esporta HTML/CSS', 'HTML/CSS export'),
    description: l('Genera una pagina HTML semantica con CSS (flexbox) dai frame.', 'Generates a semantic HTML page with CSS (flexbox) from the frames.'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [{ id: 'code', type: 'code', label: l('Codice', 'Code') }],
    params: z.object({ title: z.string().max(200) }),
    defaults: { title: 'flö export' },
    fields: [{ key: 'title', kind: 'text', label: l('Titolo pagina', 'Page title') }],
    availability: 'ready',
  }),
  spec({
    kind: 'prototype',
    category: 'output',
    label: l('Prototipo interattivo', 'Interactive prototype'),
    description: l('Apre il design come prototipo navigabile (le interazioni si definiscono nell’inspector).', 'Opens the design as a navigable prototype (interactions are defined in the inspector).'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'ready',
  }),
  spec({
    kind: 'react-export',
    category: 'output',
    label: l('Esporta React', 'React export'),
    description: l('Progetto React + TypeScript. In arrivo con la Milestone 6.', 'React + TypeScript project. Coming with Milestone 6.'),
    inputs: [{ id: 'design', type: 'design', label: l('Design', 'Design') }],
    outputs: [{ id: 'code', type: 'code', label: l('Codice', 'Code') }],
    params: noParams,
    defaults: {},
    fields: [],
    availability: 'planned',
  }),
];

const BY_KIND = new Map(NODE_SPECS.map((s) => [s.kind, s]));

export function getSpec(kind: string): NodeSpec | undefined {
  return BY_KIND.get(kind);
}

export const CATEGORIES: { id: Category; label: L10n; color: string }[] = [
  { id: 'input', label: l('Input', 'Input'), color: '#4FB7FF' },
  { id: 'ux', label: l('UX', 'UX'), color: '#F5A524' },
  { id: 'design', label: l('Design', 'Design'), color: '#8B7BFF' },
  { id: 'validation', label: l('Validazione', 'Validation'), color: '#3DDC97' },
  { id: 'logic', label: l('Logica', 'Logic'), color: '#B0B3C0' },
  { id: 'output', label: l('Output', 'Output'), color: '#FF7AB6' },
];

export const PORT_COLORS: Record<PortType, string> = {
  brief: '#4FB7FF',
  sitemap: '#F5A524',
  flow: '#F5C55B',
  design: '#8B7BFF',
  styles: '#E86BFF',
  report: '#3DDC97',
  image: '#5BD1D7',
  code: '#FF7AB6',
  any: '#B0B3C0',
};

/** Validates and completes node params (unknown keys dropped, missing keys defaulted). */
export function parseParams(kind: string, params: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const s = getSpec(kind);
  if (!s) return { ok: false, error: `Unknown node kind "${kind}"` };
  const merged = { ...s.defaults, ...(typeof params === 'object' && params ? params : {}) };
  const res = s.params.safeParse(merged);
  if (!res.success) {
    const i = res.error.issues[0];
    return { ok: false, error: `${i?.path.join('.') || 'params'}: ${i?.message}` };
  }
  return { ok: true, params: res.data };
}
