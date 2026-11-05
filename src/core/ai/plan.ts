/**
 * AI design plan: the only format an AI provider may return to change a design.
 *
 * The plan is a flat list of actions (no recursion — required by structured-output JSON
 * schemas). Each action is validated, converted into regular document ops with fresh ids,
 * dry-run against the current document, and only then offered to the user for approval.
 * Arbitrary code is never executed.
 */
import { produce } from 'immer';
import { z } from 'zod';
import { createEllipse, createFrame, createIcon, createImage, createRect, createText, solid } from '../factory';
import { applyOps, type DocOp } from '../ops';
import {
  FrameRoleSchema,
  ICON_NAMES,
  isContainer,
  TextRoleSchema,
  type DesignNode,
  type FrameNode,
  type IconName,
  type Project,
} from '../schema';
import { FONTS } from '../style';
import { getPageOf } from '../tree';

const KINDS = ['frame', 'text', 'rect', 'ellipse', 'image', 'icon'] as const;
const ROLES = [...new Set([...FrameRoleSchema.options, ...TextRoleSchema.options])];

const n = z.number().finite().nullable();
export const AiActionSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  ref: z.string().max(64).nullable(),
  id: z.string().max(64).nullable(),
  parent: z.string().max(64).nullable(),
  kind: z.enum(KINDS).nullable(),
  name: z.string().max(200).nullable(),
  text: z.string().max(5000).nullable(),
  role: z.string().max(20).nullable(),
  layout: z.enum(['none', 'vertical', 'horizontal']).nullable(),
  gap: n,
  paddingX: n,
  paddingY: n,
  align: z.enum(['start', 'center', 'end', 'space-between']).nullable(),
  crossAlign: z.enum(['start', 'center', 'end']).nullable(),
  wrap: z.boolean().nullable(),
  x: n,
  y: n,
  width: n,
  height: n,
  widthMode: z.enum(['fixed', 'hug', 'fill']).nullable(),
  heightMode: z.enum(['fixed', 'hug', 'fill']).nullable(),
  fill: z.string().max(9).nullable(),
  stroke: z.string().max(9).nullable(),
  strokeWidth: n,
  radius: n,
  shadow: z.boolean().nullable(),
  opacity: n,
  fontSize: n,
  fontWeight: n,
  fontFamily: z.string().max(60).nullable(),
  textColor: z.string().max(9).nullable(),
  textAlign: z.enum(['left', 'center', 'right']).nullable(),
  icon: z.string().max(40).nullable(),
});

export const AiPlanSchema = z.object({
  summary: z.string().max(2000),
  actions: z.array(AiActionSchema).max(400),
});

export type AiAction = z.infer<typeof AiActionSchema>;
export type AiPlan = z.infer<typeof AiPlanSchema>;

/* ------------------------------------------------------------------ */
/* JSON schema sent to providers (no recursion, all fields required)  */
/* ------------------------------------------------------------------ */

const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] });
const num = nullable({ type: 'number' });
const str = nullable({ type: 'string' });
const enm = (values: readonly string[]) => nullable({ type: 'string', enum: [...values] });

export const AI_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(AiActionSchema.shape),
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          ref: str,
          id: str,
          parent: str,
          kind: enm(KINDS),
          name: str,
          text: str,
          role: enm(ROLES),
          layout: enm(['none', 'vertical', 'horizontal']),
          gap: num,
          paddingX: num,
          paddingY: num,
          align: enm(['start', 'center', 'end', 'space-between']),
          crossAlign: enm(['start', 'center', 'end']),
          wrap: nullable({ type: 'boolean' }),
          x: num,
          y: num,
          width: num,
          height: num,
          widthMode: enm(['fixed', 'hug', 'fill']),
          heightMode: enm(['fixed', 'hug', 'fill']),
          fill: str,
          stroke: str,
          strokeWidth: num,
          radius: num,
          shadow: nullable({ type: 'boolean' }),
          opacity: num,
          fontSize: num,
          fontWeight: num,
          fontFamily: str,
          textColor: str,
          textAlign: enm(['left', 'center', 'right']),
          icon: enm(ICON_NAMES),
        },
      },
    },
  },
};

/* ------------------------------------------------------------------ */
/* Conversion                                                          */
/* ------------------------------------------------------------------ */

export interface PlanResult {
  ops: DocOp[];
  /** Ids of created layers whose parent is not another created layer (for selection/preview). */
  createdRoots: string[];
  updatedIds: string[];
  deletedIds: string[];
  /** One message per rejected action. */
  errors: string[];
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function hex(v: string | null, field: string): string | undefined {
  if (v === null) return undefined;
  let h = v.trim();
  if (!h.startsWith('#')) h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) h = `#${h.slice(1).split('').map((c) => c + c).join('')}`;
  if (/^#[0-9a-fA-F]{8}$/.test(h)) h = h.slice(0, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) throw new Error(`invalid color for ${field}: ${v}`);
  return h.toUpperCase();
}

const safeFont = (f: string | null) => (f && FONTS.some((x) => x.family === f) ? f : f && /^[A-Za-z0-9 _-]+$/.test(f) ? f : undefined);

/** Properties shared by create and update (only fields the action actually sets). */
function propsFrom(a: AiAction, node: DesignNode): Partial<DesignNode> {
  const p: Record<string, unknown> = {};
  if (a.name !== null) p.name = a.name.slice(0, 200);
  if (a.x !== null) p.x = Math.round(a.x);
  if (a.y !== null) p.y = Math.round(a.y);
  if (a.width !== null) p.width = clamp(Math.round(a.width), 0, 20_000);
  if (a.height !== null) p.height = clamp(Math.round(a.height), 0, 20_000);
  if (a.widthMode !== null || a.heightMode !== null) {
    p.sizing = { horizontal: a.widthMode ?? node.sizing.horizontal, vertical: a.heightMode ?? node.sizing.vertical };
  }
  if (a.opacity !== null) p.opacity = clamp(a.opacity, 0, 1);
  const fill = hex(a.fill, 'fill');
  if (fill && node.type !== 'text') p.fills = [solid(fill)];
  const stroke = hex(a.stroke, 'stroke');
  if (stroke) p.stroke = { color: stroke, opacity: 1, width: clamp(a.strokeWidth ?? 1, 0, 50), visible: true };
  else if (a.strokeWidth !== null && node.stroke) p.stroke = { ...node.stroke, width: clamp(a.strokeWidth, 0, 50) };
  if (a.radius !== null && node.type !== 'text') {
    const r = clamp(a.radius, 0, 1000);
    p.radius = [r, r, r, r];
  }
  if (a.shadow !== null) {
    p.effects = a.shadow ? [{ type: 'drop-shadow', x: 0, y: 8, blur: 24, spread: -8, color: '#101018', opacity: 0.16, visible: true }] : [];
  }
  if (node.type === 'frame') {
    const l = { ...node.layout };
    let touched = false;
    if (a.layout !== null) ((l.mode = a.layout), (touched = true));
    if (a.gap !== null) ((l.gap = clamp(a.gap, 0, 1000)), (touched = true));
    if (a.paddingX !== null || a.paddingY !== null) {
      const px = clamp(a.paddingX ?? l.padding[1], 0, 1000);
      const py = clamp(a.paddingY ?? l.padding[0], 0, 1000);
      l.padding = [py, px, py, px];
      touched = true;
    }
    if (a.align !== null) ((l.primaryAlign = a.align), (touched = true));
    if (a.crossAlign !== null) ((l.counterAlign = a.crossAlign), (touched = true));
    if (a.wrap !== null) ((l.wrap = a.wrap), (touched = true));
    if (touched) p.layout = l;
    if (a.role !== null && FrameRoleSchema.safeParse(a.role).success) p.role = a.role;
  }
  if (node.type === 'text') {
    if (a.text !== null) p.characters = a.text;
    if (a.fontSize !== null) p.fontSize = clamp(a.fontSize, 6, 400);
    if (a.fontWeight !== null) p.fontWeight = clamp(Math.round(a.fontWeight / 100) * 100, 100, 900);
    const ff = safeFont(a.fontFamily);
    if (ff) p.fontFamily = ff;
    const tc = hex(a.textColor ?? a.fill, 'textColor');
    if (tc) p.fills = [solid(tc)];
    if (a.textAlign !== null) p.textAlign = a.textAlign;
    if (a.role !== null && TextRoleSchema.safeParse(a.role).success) p.role = a.role;
  }
  if (node.type === 'icon') {
    if (a.icon !== null && (ICON_NAMES as readonly string[]).includes(a.icon)) p.icon = a.icon as IconName;
    const c = hex(a.textColor ?? a.fill, 'icon color');
    if (c) p.fills = [solid(c)];
  }
  if (node.type === 'image' && a.text !== null) p.alt = a.text.slice(0, 1000);
  return p as Partial<DesignNode>;
}

function createNode(a: AiAction, parentId: string): DesignNode {
  const box = { parentId, name: a.name ?? undefined };
  switch (a.kind) {
    case 'frame':
      return createFrame({ ...box, width: 400, height: 300 }, { fills: [] , clipContent: false });
    case 'text':
      return createText(box, { characters: a.text ?? 'Testo' });
    case 'rect':
      return createRect(box);
    case 'ellipse':
      return createEllipse(box);
    case 'image':
      return createImage(box);
    case 'icon':
      return createIcon(box, ((ICON_NAMES as readonly string[]).includes(a.icon ?? '') ? a.icon : 'star') as IconName);
    default:
      throw new Error('create requires "kind"');
  }
}

/** Default sizing for created layers inside auto layout when the plan does not specify it. */
function defaultSizing(node: DesignNode, a: AiAction, parent: DesignNode | undefined): DesignNode['sizing'] {
  const flow = parent?.type === 'frame' && parent.layout.mode !== 'none';
  const canHug = node.type === 'text' || (node.type === 'frame' && (a.layout ?? 'none') !== 'none');
  // Defaults: in vertical stacks frames fill the width (block layout); in rows they hug their content.
  const vertical = parent?.type === 'frame' && parent.layout.mode === 'vertical';
  const h =
    a.widthMode ??
    (node.type === 'text'
      ? a.width !== null
        ? 'fixed'
        : 'hug'
      : flow && node.type === 'frame' && a.width === null
        ? vertical
          ? 'fill'
          : canHug
            ? 'hug'
            : 'fixed'
        : 'fixed');
  const v = a.heightMode ?? (canHug && a.height === null ? 'hug' : 'fixed');
  return {
    horizontal: h === 'fill' && !flow ? 'fixed' : h === 'hug' && !canHug ? 'fixed' : h,
    vertical: v === 'fill' && !flow ? 'fixed' : v === 'hug' && !canHug ? 'fixed' : v,
  };
}

/**
 * Converts a plan into validated ops. Every action is dry-run cumulatively; invalid actions
 * (and creates depending on them) are rejected with a message instead of failing the whole plan.
 */
export function planToOps(project: Project, plan: AiPlan, defaultParentId: string, newId: () => string): PlanResult {
  const res: PlanResult = { ops: [], createdRoots: [], updatedIds: [], deletedIds: [], errors: [] };
  const refs = new Map<string, string>();
  const created = new Set<string>();
  let draft = project;
  const pageId = project.nodes[defaultParentId] ? getPageOf(project, defaultParentId)?.id : defaultParentId;
  let nextX = (() => {
    const page = project.pages.find((p) => p.id === pageId);
    let x = 0;
    for (const id of page?.childIds ?? []) {
      const nn = project.nodes[id];
      if (nn) x = Math.max(x, nn.x + nn.width + 160);
    }
    return x;
  })();

  /** Applies ops to the running draft (throws when invalid) and records them. */
  const tryOps = (ops: DocOp[]) => {
    draft = produce(draft, (d) => applyOps(d, ops));
    res.ops.push(...ops);
  };

  plan.actions.forEach((a, i) => {
    const label = `#${i + 1} ${a.action}${a.name ? ` “${a.name}”` : a.id ? ` ${a.id}` : ''}`;
    try {
      if (a.action === 'create') {
        const parentId = a.parent ? (refs.get(a.parent) ?? a.parent) : defaultParentId;
        const parent = draft.nodes[parentId];
        const parentIsPage = draft.pages.some((p) => p.id === parentId);
        if (!parent && !parentIsPage) throw new Error(`unknown parent "${a.parent}"`);
        if (parent && !isContainer(parent)) throw new Error(`parent "${parent.name}" cannot contain layers`);
        const node = createNode(a, parentId);
        node.id = newId();
        const flow = parent?.type === 'frame' && parent.layout.mode !== 'none';
        node.layoutPositioning = flow ? 'auto' : 'absolute';
        Object.assign(node, propsFrom(a, node));
        node.sizing = defaultSizing(node, a, parent);
        if (parentIsPage && a.x === null) {
          node.x = nextX;
          node.y = 0;
          nextX += (a.width ?? node.width) + 160;
        }
        if (node.type === 'frame' && parentIsPage && !node.fills.length) (node as FrameNode).fills = [solid('#FFFFFF')];
        tryOps([{ type: 'insertTree', nodes: [node] }]);
        if (a.ref) refs.set(a.ref, node.id);
        created.add(node.id);
        if (!created.has(parentId)) res.createdRoots.push(node.id);
      } else if (a.action === 'update') {
        const id = a.id ?? '';
        const node = draft.nodes[refs.get(id) ?? id];
        if (!node) throw new Error(`unknown layer "${a.id}"`);
        const props = propsFrom(a, node);
        if (!Object.keys(props).length) throw new Error('no changes');
        tryOps([{ type: 'updateNode', id: node.id, props: props as Record<string, unknown> }]);
        if (!res.createdRoots.includes(node.id)) res.updatedIds.push(node.id);
      } else {
        const id = a.id ?? '';
        const node = draft.nodes[refs.get(id) ?? id];
        if (!node) throw new Error(`unknown layer "${a.id}"`);
        tryOps([{ type: 'deleteNode', id: node.id }]);
        res.deletedIds.push(node.id);
      }
    } catch (e) {
      res.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  res.updatedIds = res.updatedIds.filter((id) => !res.deletedIds.includes(id));
  return res;
}

/** Parses provider output (string or object) into a validated plan. */
export function parsePlan(input: unknown): AiPlan {
  let value = input;
  if (typeof value === 'string') {
    const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    value = JSON.parse(text);
  }
  // Be lenient with providers that omit null fields: fill them in before validating.
  if (value && typeof value === 'object' && Array.isArray((value as { actions?: unknown }).actions)) {
    const keys = Object.keys(AiActionSchema.shape);
    (value as { actions: Record<string, unknown>[] }).actions = (value as { actions: Record<string, unknown>[] }).actions.map((a) => {
      const full: Record<string, unknown> = {};
      for (const k of keys) full[k] = a && typeof a === 'object' && k in a ? a[k] : null;
      return full;
    });
  }
  const r = AiPlanSchema.safeParse(value);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`Invalid AI plan: ${i?.path.join('.')} ${i?.message}`);
  }
  return r.data;
}
