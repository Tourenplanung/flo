/** Built-in workflow templates and instantiation with fresh ids. */
import { z } from 'zod';
import { createId } from '../ids';
import { WorkflowEdgeSchema, WorkflowNodeSchema, type Workflow, type WorkflowNode } from '../schema';
import { getSpec, type L10n } from './catalog';

export interface TemplateNode {
  key: string;
  kind: string;
  x: number;
  y: number;
  params?: Record<string, unknown>;
}

export interface TemplateDef {
  id: string;
  name: L10n;
  description: L10n;
  nodes: TemplateNode[];
  edges: [string, string, string, string][]; // [sourceKey, sourcePort, targetKey, targetPort]
}

const BRIEF = `Sito per un servizio di concierge automobilistico premium.
Obiettivo: prenotare ritiro e consegna dell'auto per manutenzione.

- Home
- Servizi
- Prezzi
- Chi siamo
- Contatti`;

export const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    id: 'brief-to-design',
    name: { it: 'Dal brief al design', en: 'From brief to design' },
    description: {
      it: 'Brief → sitemap → wireframe → design system → alta fedeltà → mobile → verifiche → export.',
      en: 'Brief → sitemap → wireframe → design system → high fidelity → mobile → checks → export.',
    },
    nodes: [
      { key: 'brief', kind: 'brief-input', x: 0, y: 120, params: { text: BRIEF } },
      { key: 'sitemap', kind: 'sitemap', x: 300, y: 120 },
      { key: 'wire', kind: 'wireframe', x: 600, y: 60 },
      { key: 'ds', kind: 'design-system', x: 600, y: 300 },
      { key: 'style', kind: 'apply-styles', x: 900, y: 140 },
      { key: 'mobile', kind: 'responsive-adapter', x: 1200, y: 0 },
      { key: 'a11y', kind: 'a11y-check', x: 1200, y: 200 },
      { key: 'cond', kind: 'condition', x: 1500, y: 200, params: { maxErrors: 0, maxWarnings: 20 } },
      { key: 'canvas', kind: 'canvas-output', x: 1500, y: 0 },
      { key: 'html', kind: 'html-export', x: 1200, y: 380 },
    ],
    edges: [
      ['brief', 'brief', 'sitemap', 'brief'],
      ['sitemap', 'sitemap', 'wire', 'sitemap'],
      ['wire', 'design', 'style', 'design'],
      ['ds', 'styles', 'style', 'styles'],
      ['style', 'design', 'mobile', 'design'],
      ['style', 'design', 'a11y', 'design'],
      ['a11y', 'report', 'cond', 'report'],
      ['mobile', 'design', 'canvas', 'design'],
      ['style', 'design', 'html', 'design'],
    ],
  },
  {
    id: 'audit-existing',
    name: { it: 'Verifica design esistente', en: 'Audit an existing design' },
    description: {
      it: 'Accessibilità, coerenza e responsive sui frame già presenti nel progetto.',
      en: 'Accessibility, consistency and responsive checks on frames already in the project.',
    },
    nodes: [
      { key: 'design', kind: 'design-input', x: 0, y: 160 },
      { key: 'a11y', kind: 'a11y-check', x: 320, y: 0 },
      { key: 'consistency', kind: 'consistency-check', x: 320, y: 160 },
      { key: 'responsive', kind: 'responsive-check', x: 320, y: 320 },
    ],
    edges: [
      ['design', 'design', 'a11y', 'design'],
      ['design', 'design', 'consistency', 'design'],
      ['design', 'design', 'responsive', 'design'],
    ],
  },
  {
    id: 'style-variants',
    name: { it: 'Esplora varianti di stile', en: 'Explore style variants' },
    description: {
      it: 'Due design system applicati allo stesso design, confronto e scelta.',
      en: 'Two design systems applied to the same design, compared and chosen.',
    },
    nodes: [
      { key: 'design', kind: 'design-input', x: 0, y: 160 },
      { key: 'dsA', kind: 'design-system', x: 0, y: 360, params: { primary: '#0B5FFF', headingFont: 'Space Grotesk' } },
      { key: 'dsB', kind: 'design-system', x: 0, y: 560, params: { primary: '#C2185B', headingFont: 'Playfair Display', radius: 2 } },
      { key: 'branch', kind: 'branch', x: 300, y: 160 },
      { key: 'a', kind: 'apply-styles', x: 600, y: 100 },
      { key: 'b', kind: 'apply-styles', x: 600, y: 360 },
      { key: 'cmp', kind: 'compare', x: 900, y: 220 },
      { key: 'canvas', kind: 'canvas-output', x: 1200, y: 220 },
    ],
    edges: [
      ['design', 'design', 'branch', 'in'],
      ['branch', 'a', 'a', 'design'],
      ['branch', 'b', 'b', 'design'],
      ['dsA', 'styles', 'a', 'styles'],
      ['dsB', 'styles', 'b', 'styles'],
      ['a', 'design', 'cmp', 'a'],
      ['b', 'design', 'cmp', 'b'],
      ['cmp', 'design', 'canvas', 'design'],
    ],
  },
];

export function instantiateTemplate(t: TemplateDef, name: string, lang: 'it' | 'en', designPageId?: string): Workflow {
  const ids = new Map(t.nodes.map((n) => [n.key, createId()]));
  const nodes: WorkflowNode[] = t.nodes.map((n) => {
    const spec = getSpec(n.kind)!;
    const params = { ...spec.defaults, ...(n.params ?? {}) };
    if (n.kind === 'design-input' && designPageId) params.pageId = designPageId;
    return { id: ids.get(n.key)!, kind: n.kind, label: spec.label[lang], position: { x: n.x, y: n.y }, params };
  });
  const edges = t.edges.map(([s, sp, tg, tp]) => ({ id: createId(), source: ids.get(s)!, sourcePort: sp, target: ids.get(tg)!, targetPort: tp }));
  return { id: createId(), name, nodes, edges };
}

const StoredWorkflowShape = z.object({ nodes: z.array(WorkflowNodeSchema), edges: z.array(WorkflowEdgeSchema) });

/** Re-ids a stored (user) template or an existing workflow so it can be inserted again. */
export function cloneWorkflow(source: unknown, name: string): Workflow {
  const parsed = StoredWorkflowShape.parse(source);
  const ids = new Map(parsed.nodes.map((n) => [n.id, createId()]));
  return {
    id: createId(),
    name,
    nodes: parsed.nodes.map((n) => ({ ...n, id: ids.get(n.id)! })),
    edges: parsed.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e, id: createId(), source: ids.get(e.source)!, target: ids.get(e.target)! })),
  };
}
