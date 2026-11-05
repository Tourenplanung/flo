/** Design agent: builds context and prompts, calls a provider, returns a validated plan. */
import { createId } from '../ids';
import { resolveNode } from '../resolve';
import { ICON_NAMES, type DesignNode, type Project } from '../schema';
import { getPageOf } from '../tree';
import { AI_PLAN_JSON_SCHEMA, parsePlan, planToOps, type AiPlan, type PlanResult } from './plan';
import { AiError, type AiProvider, type GenerateResult } from './provider';

const MAX_CONTEXT_NODES = 350;

const hexOf = (n: DesignNode) => {
  const f = [...n.fills].reverse().find((x) => x.visible && x.type === 'solid');
  return f && f.type === 'solid' ? f.color : null;
};

/** Compact, indented outline of layers (ids are needed for update/delete actions). */
export function describeLayers(project: Project, rootIds: string[]): string {
  const lines: string[] = [];
  let count = 0;
  const visit = (id: string, depth: number) => {
    const raw = project.nodes[id];
    if (!raw || count >= MAX_CONTEXT_NODES) return;
    count++;
    const n = resolveNode(raw, project.tokens, []);
    const parts: string[] = [`${n.type}`, `id=${n.id}`, `"${n.name.slice(0, 60)}"`];
    if (n.type === 'frame') {
      if (n.role !== 'div') parts.push(`role=${n.role}`);
      if (n.layout.mode !== 'none') parts.push(`layout=${n.layout.mode} gap=${n.layout.gap} pad=${n.layout.padding.join(',')} align=${n.layout.primaryAlign}/${n.layout.counterAlign}`);
      if (n.component) parts.push('component');
    }
    if (n.type === 'text') parts.push(`text="${n.characters.slice(0, 120).replace(/\n/g, ' ')}" size=${n.fontSize} weight=${n.fontWeight} role=${n.role}`);
    if (n.type === 'icon') parts.push(`icon=${n.icon}`);
    if (n.type === 'instance') parts.push(`instance-of=${n.componentId}`);
    parts.push(`${Math.round(n.width)}x${Math.round(n.height)}`, `size=${n.sizing.horizontal}/${n.sizing.vertical}`);
    if (n.layoutPositioning === 'absolute' && project.nodes[n.parentId]) parts.push(`at=${Math.round(n.x)},${Math.round(n.y)}`);
    const c = hexOf(n);
    if (c) parts.push(`${n.type === 'text' ? 'color' : 'fill'}=${c}`);
    if (n.radius.some((r) => r > 0)) parts.push(`radius=${n.radius[0]}`);
    if (!n.visible) parts.push('hidden');
    lines.push(`${'  '.repeat(depth)}- ${parts.join(' ')}`);
    n.childIds.forEach((cid) => visit(cid, depth + 1));
  };
  rootIds.forEach((id) => visit(id, 0));
  if (count >= MAX_CONTEXT_NODES) lines.push(`… (truncated after ${MAX_CONTEXT_NODES} layers)`);
  return lines.join('\n');
}

export function describeTokens(project: Project): string {
  const t = project.tokens;
  const parts: string[] = [];
  if (t.colors.length) parts.push(`colors: ${t.colors.map((c) => `${c.name}=${c.value}`).join(', ')}`);
  if (t.text.length) parts.push(`text styles: ${t.text.map((x) => `${x.name}=${x.fontFamily} ${x.fontSize}/${x.fontWeight}`).join(', ')}`);
  if (t.spacing.length) parts.push(`spacing: ${t.spacing.map((x) => `${x.name}=${x.value}`).join(', ')}`);
  if (t.radius.length) parts.push(`radius: ${t.radius.map((x) => `${x.name}=${x.value}`).join(', ')}`);
  return parts.length ? parts.join('\n') : '(no design tokens defined)';
}

export const DESIGN_SYSTEM_PROMPT = `You are the design agent of flö, a professional UI/UX design tool.
You change designs ONLY by returning a JSON plan of actions. Never return code, HTML or explanations outside the JSON.

Document model:
- Layers: frame (container; may use auto layout), text, rect, ellipse, image (placeholder), icon.
- Frames with layout "vertical" or "horizontal" behave like CSS flexbox: gap, paddingX/paddingY, align (main axis), crossAlign.
- Children of auto-layout frames are positioned by the layout (do not set x/y). widthMode/heightMode: "fixed", "hug" (fit content) or "fill" (fill parent; only inside auto layout).
- Top-level frames are screens (e.g. desktop 1440 wide, tablet 768, mobile 390).
- Use semantic roles: frames header, nav, main, section, footer, article, button, input, link; texts h1-h6, p, span, label, a.

Plan rules:
- "create": set "kind"; give each created layer a short unique "ref"; set "parent" to the ref of a layer created earlier in the plan, to an existing layer id, or null for the default target. List parents before children.
- "update": set "id" of an existing layer and only the properties to change.
- "delete": set "id".
- Every action object must contain every field; use null for fields you do not set.
- Colors are hex (#RRGGBB). Icons must be one of: ${ICON_NAMES.join(', ')}.
- Prefer auto layout over absolute positioning; build complete, realistic, accessible screens with real copy (WCAG AA contrast, 44px touch targets).
- Write user-facing copy in the user's language.
- Preserve layers the user did not ask to change.
- "summary": one or two sentences describing what you did, in the user's language.`;

export interface AgentScope {
  /** Container that receives new layers by default (page id or frame id). */
  targetId: string;
  /** Layers given as context (selection or page). */
  contextIds: string[];
}

export function buildDesignPrompt(project: Project, scope: AgentScope, request: string): string {
  const page = project.pages.find((p) => p.id === scope.targetId) ?? getPageOf(project, scope.targetId);
  const target = project.nodes[scope.targetId];
  return [
    `Project: ${project.name}`,
    `Current page: ${page?.name ?? '?'}`,
    `Default target for new layers: ${target ? `${target.type} id=${target.id} "${target.name}" (${target.type === 'frame' ? `layout=${target.layout.mode}` : ''})` : 'the page (new top-level screens)'}`,
    '',
    'Design tokens:',
    describeTokens(project),
    '',
    scope.contextIds.length ? 'Relevant layers:' : 'The page is empty.',
    describeLayers(project, scope.contextIds),
    '',
    `User request: ${request}`,
  ].join('\n');
}

export interface AgentOutcome {
  plan: AiPlan;
  result: PlanResult;
  generation: GenerateResult;
}

/** Asks the provider for a plan and converts it into validated document ops (nothing is applied). */
export async function runDesignAgent(provider: AiProvider, project: Project, scope: AgentScope, request: string, signal?: AbortSignal): Promise<AgentOutcome> {
  const generation = await provider.generate(
    { system: DESIGN_SYSTEM_PROMPT, prompt: buildDesignPrompt(project, scope, request), schema: AI_PLAN_JSON_SCHEMA, maxTokens: 32_000 },
    signal,
  );
  let plan: AiPlan;
  try {
    plan = parsePlan(generation.json ?? generation.text);
  } catch (e) {
    throw new AiError(e instanceof Error ? e.message : String(e), 'invalid_output');
  }
  const result = planToOps(project, plan, scope.targetId, () => createId());
  if (!result.ops.length) {
    throw new AiError(`Nessuna modifica valida nel piano${result.errors.length ? `: ${result.errors.slice(0, 3).join('; ')}` : ''}`, 'invalid_output');
  }
  return { plan, result, generation };
}

/* ------------------------------------------------------------------ */
/* Workflow AI node prompts                                            */
/* ------------------------------------------------------------------ */

export const UX_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'findings'],
  properties: {
    title: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: { kind: { type: 'string', enum: ['user', 'goal', 'requirement', 'risk', 'opportunity'] }, text: { type: 'string' } },
      },
    },
  },
};

export const IA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pages'],
  properties: {
    pages: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'depth'], properties: { name: { type: 'string' }, depth: { type: 'integer' } } },
    },
  },
};

export const UX_SYSTEM = `You are a senior UX researcher. Analyse the product brief and return JSON only: a short title and findings (users, goals, requirements, risks, opportunities). Be specific and concise. Answer in the brief's language.`;
export const IA_SYSTEM = `You are an information architect. From the product brief, return JSON only: the site's pages in navigation order with depth (0 = top level, 1 = sub page). 4-10 top-level pages maximum. Use the brief's language for page names.`;
