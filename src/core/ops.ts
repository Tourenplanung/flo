/**
 * Reversible document operations.
 *
 * Every change to a project goes through `applyOps`, which validates each op against the
 * schema and structural invariants (valid parents, no cycles, leaf nodes have no children).
 * Undo/redo is provided by the store via Immer patches produced while applying ops, so each
 * op only needs a forward implementation. Ops are plain serializable data validated with Zod,
 * which makes them the contract for future AI-generated patches.
 */
import { z } from 'zod';
import {
  AssetMetaSchema,
  ComponentSourceSchema,
  DesignNodeSchema,
  GuideSchema,
  HexColorSchema,
  IdSchema,
  PageSchema,
  STRUCTURAL_KEYS,
  isContainer,
  BreakpointSchema,
  ColorTokenSchema,
  InstanceOverrideSchema,
  InteractionSchema,
  NumberTokenSchema,
  ResponsiveOverrideSchema,
  ShadowTokenSchema,
  TextTokenSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  WorkflowSchema,
  type DesignNode,
  type FrameNode,
  type InstanceNode,
  type Interaction,
  type Project,
  type TokenKind,
  type Workflow,
} from './schema';
import { createId } from './ids';
import { bakeInstance, componentDependencies, enclosingComponents, instancesOf } from './instance';
import { applyResponsive, applyTokens } from './resolve';
import { getPage } from './tree';
import { parseParams } from './workflow/catalog';
import { validateConnection } from './workflow/graph';

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

const IndexSchema = z.number().int().min(0).optional();

export const DocOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('insertTree'), nodes: z.array(DesignNodeSchema).min(1).max(5000), index: IndexSchema }),
  z.object({ type: z.literal('updateNode'), id: IdSchema, props: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('deleteNode'), id: IdSchema }),
  z.object({ type: z.literal('moveNode'), id: IdSchema, parentId: IdSchema, index: IndexSchema }),
  z.object({ type: z.literal('createPage'), page: PageSchema, index: IndexSchema }),
  z.object({
    type: z.literal('updatePage'),
    id: IdSchema,
    props: z
      .object({ name: z.string().max(200), background: HexColorSchema, guides: z.array(GuideSchema).max(500) })
      .partial(),
  }),
  z.object({ type: z.literal('deletePage'), id: IdSchema }),
  z.object({ type: z.literal('movePage'), id: IdSchema, index: z.number().int().min(0) }),
  z.object({ type: z.literal('addAsset'), asset: AssetMetaSchema }),
  z.object({ type: z.literal('removeAsset'), id: IdSchema }),
  z.object({ type: z.literal('renameProject'), name: z.string().max(200) }),
  // Design tokens
  z.object({
    type: z.literal('upsertToken'),
    token: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('colors'), value: ColorTokenSchema }),
      z.object({ kind: z.literal('text'), value: TextTokenSchema }),
      z.object({ kind: z.literal('spacing'), value: NumberTokenSchema }),
      z.object({ kind: z.literal('radius'), value: NumberTokenSchema }),
      z.object({ kind: z.literal('shadows'), value: ShadowTokenSchema }),
    ]),
  }),
  z.object({ type: z.literal('deleteToken'), kind: z.enum(['colors', 'text', 'spacing', 'radius', 'shadows']), id: IdSchema }),
  // Breakpoints & responsive overrides
  z.object({ type: z.literal('setBreakpoints'), breakpoints: z.array(BreakpointSchema).max(12) }),
  z.object({ type: z.literal('setResponsive'), id: IdSchema, breakpointId: IdSchema, props: ResponsiveOverrideSchema }),
  z.object({ type: z.literal('clearResponsive'), id: IdSchema, breakpointId: IdSchema, keys: z.array(z.string()).optional() }),
  // Components & instances
  z.object({
    type: z.literal('setComponent'),
    id: IdSchema,
    component: z.object({ set: z.string().max(100), variant: z.record(z.string().min(1).max(40), z.string().max(40)), description: z.string().max(500), source: ComponentSourceSchema.optional() }).nullable(),
  }),
  z.object({ type: z.literal('setInstanceComponent'), id: IdSchema, componentId: IdSchema }),
  z.object({ type: z.literal('setInstanceOverride'), id: IdSchema, sourceId: IdSchema, props: InstanceOverrideSchema }),
  z.object({ type: z.literal('resetInstanceOverride'), id: IdSchema, sourceId: IdSchema.optional() }),
  z.object({ type: z.literal('detachInstance'), id: IdSchema }),
  // Prototype
  z.object({ type: z.literal('setInteractions'), id: IdSchema, interactions: z.array(InteractionSchema).max(20) }),
  z.object({ type: z.literal('setPrototypeStart'), frameId: IdSchema.nullable() }),
  // Workflows
  z.object({ type: z.literal('createWorkflow'), workflow: WorkflowSchema, index: IndexSchema }),
  z.object({ type: z.literal('updateWorkflow'), id: IdSchema, props: z.object({ name: z.string().max(200) }).partial() }),
  z.object({ type: z.literal('deleteWorkflow'), id: IdSchema }),
  z.object({ type: z.literal('addWorkflowNodes'), workflowId: IdSchema, nodes: z.array(WorkflowNodeSchema).min(1).max(500) }),
  z.object({
    type: z.literal('updateWorkflowNode'),
    workflowId: IdSchema,
    id: IdSchema,
    props: WorkflowNodeSchema.pick({ label: true, position: true, params: true }).partial(),
  }),
  z.object({ type: z.literal('removeWorkflowNodes'), workflowId: IdSchema, ids: z.array(IdSchema).min(1) }),
  z.object({ type: z.literal('addWorkflowEdge'), workflowId: IdSchema, edge: WorkflowEdgeSchema }),
  z.object({ type: z.literal('removeWorkflowEdges'), workflowId: IdSchema, ids: z.array(IdSchema).min(1) }),
]);

export type DocOp = z.infer<typeof DocOpSchema>;

/** Returns the child-id list of a page or container node, throwing if the parent is invalid. */
function childListOf(draft: Project, parentId: string): string[] {
  const node = draft.nodes[parentId];
  if (node) {
    if (!isContainer(node)) throw new OpError(`Node "${node.name}" (${node.type}) cannot contain children`);
    return node.childIds;
  }
  const page = getPage(draft, parentId);
  if (!page) throw new OpError(`Parent ${parentId} not found`);
  return page.childIds;
}

function insertAt(list: string[], id: string, index: number | undefined) {
  const i = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(i, 0, id);
}

function removeFrom(list: string[], id: string): number {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  return i;
}

function wouldCreateCycle(draft: Project, nodeId: string, newParentId: string): boolean {
  let cur: string | undefined = newParentId;
  let guard = 0;
  while (cur && guard++ < 10_000) {
    if (cur === nodeId) return true;
    cur = draft.nodes[cur]?.parentId;
  }
  return false;
}

const TOKEN_KIND_OF_BINDING: Record<string, TokenKind> = { fill: 'colors', stroke: 'colors', text: 'text', radius: 'radius', gap: 'spacing', padding: 'spacing', shadow: 'shadows' };

function checkBindings(draft: Project, node: DesignNode) {
  for (const [key, tokenId] of Object.entries(node.bindings ?? {})) {
    const kind = TOKEN_KIND_OF_BINDING[key];
    if (!kind) throw new OpError(`Unknown binding "${key}"`);
    if (!(draft.tokens[kind] as { id: string }[]).some((t) => t.id === tokenId)) throw new OpError(`Token ${tokenId} not found`);
  }
  for (const bp of Object.keys(node.responsive ?? {})) {
    if (!draft.breakpoints.some((b) => b.id === bp)) throw new OpError(`Breakpoint ${bp} not found`);
  }
}

/** Ensures an instance may reference `componentId` from its position in the tree. */
function checkInstanceTarget(draft: Project, inst: { id: string; parentId: string }, componentId: string) {
  const main = draft.nodes[componentId];
  if (!main || main.type !== 'frame' || !main.component) throw new OpError('Instance must reference a main component');
  const enclosing = enclosingComponents(draft, inst.parentId);
  if (enclosing.includes(componentId)) throw new OpError('A component cannot contain an instance of itself');
  const deps = componentDependencies(draft, componentId);
  if (enclosing.some((c) => deps.has(c))) throw new OpError('Instance would create a component cycle');
}

/** Replaces instances (of components in `componentIds`) outside `excluded` with baked layers. */
function detachInstancesOf(draft: Project, componentIds: Set<string>, excluded: Set<string> = new Set()) {
  for (const inst of instancesOf(draft, componentIds)) {
    if (excluded.has(inst.id)) continue;
    detachInDraft(draft, inst.id);
  }
}

function detachInDraft(draft: Project, id: string) {
  const inst = draft.nodes[id];
  if (!inst || inst.type !== 'instance') throw new OpError('Not an instance');
  const baked = bakeInstance(draft, JSON.parse(JSON.stringify(inst)) as InstanceNode, () => createId());
  if (!baked) throw new OpError('Main component not found');
  for (const n of baked) draft.nodes[n.id] = n;
}

/** Ids an interaction points to. */
export function interactionRefs(i: Interaction): string[] {
  const a = i.action;
  if (a.type === 'navigate' || a.type === 'open-overlay') return [a.destinationId];
  if (a.type === 'toggle-visibility') return [a.targetId];
  return [];
}

const isScreen = (draft: Project, id: string) => {
  const n = draft.nodes[id];
  return !!n && n.type === 'frame' && draft.pages.some((p) => p.id === n.parentId);
};

/** Validates interaction references (destinations must be top-level frames). */
function checkInteractions(draft: Project, node: DesignNode, interactions: Interaction[]) {
  const ids = new Set<string>();
  for (const i of interactions) {
    if (ids.has(i.id)) throw new OpError('Duplicate interaction id');
    ids.add(i.id);
    const a = i.action;
    if ((a.type === 'navigate' || a.type === 'open-overlay') && !isScreen(draft, a.destinationId)) {
      throw new OpError('The destination must be a top-level frame (screen)');
    }
    if (a.type === 'navigate' && a.destinationId === node.id) throw new OpError('A screen cannot navigate to itself');
    if (a.type === 'toggle-visibility') {
      if (!draft.nodes[a.targetId]) throw new OpError('Target layer not found');
      if (a.targetId === node.id && i.trigger === 'click') throw new OpError('A layer cannot hide itself on click');
    }
  }
}

/** Removes interactions that point to any of the given (deleted) ids. */
function pruneInteractions(draft: Project, removed: Set<string>) {
  for (const n of Object.values(draft.nodes)) {
    if (n.interactions.some((i) => interactionRefs(i).some((r) => removed.has(r)))) {
      n.interactions = n.interactions.filter((i) => !interactionRefs(i).some((r) => removed.has(r)));
    }
  }
  if (draft.prototype.startFrameId && removed.has(draft.prototype.startFrameId)) draft.prototype.startFrameId = null;
}

function getWorkflow(draft: Project, id: string): Workflow {
  const wf = draft.workflows.find((w) => w.id === id);
  if (!wf) throw new OpError(`Workflow ${id} not found`);
  return wf;
}

function checkedParams(kind: string, params: unknown): Record<string, unknown> {
  const res = parseParams(kind, params);
  if (!res.ok) throw new OpError(`Invalid parameters for ${kind}: ${res.error}`);
  return res.params;
}

function deleteSubtree(draft: Project, id: string) {
  const node = draft.nodes[id];
  if (!node) return;
  for (const c of [...node.childIds]) deleteSubtree(draft, c);
  delete draft.nodes[id];
}

export function applyOp(draft: Project, op: DocOp): void {
  switch (op.type) {
    case 'insertTree': {
      const [root, ...rest] = op.nodes;
      if (!root) throw new OpError('Empty tree');
      const ids = new Set<string>();
      for (const n of op.nodes) {
        if (draft.nodes[n.id] || ids.has(n.id)) throw new OpError(`Duplicate node id ${n.id}`);
        ids.add(n.id);
      }
      // Every descendant must be referenced by exactly its parent within the tree.
      const byId = new Map(op.nodes.map((n) => [n.id, n] as const));
      for (const n of rest) {
        const parent = byId.get(n.parentId);
        if (!parent) throw new OpError(`Node ${n.id} references a parent outside the inserted tree`);
        if (!parent.childIds.includes(n.id)) throw new OpError(`Parent ${parent.id} does not list child ${n.id}`);
      }
      for (const n of op.nodes) {
        if (n.childIds.length && !isContainer(n)) throw new OpError(`${n.type} cannot contain children`);
        for (const c of n.childIds) if (!byId.has(c)) throw new OpError(`Missing child ${c}`);
      }
      const list = childListOf(draft, root.parentId);
      for (const n of op.nodes) draft.nodes[n.id] = structuredClone(n);
      insertAt(list, root.id, op.index);
      for (const n of op.nodes) {
        const node = draft.nodes[n.id]!;
        // Interactions pasted from elsewhere may point to layers that do not exist here: drop them.
        node.interactions = node.interactions.filter((i) => {
          try {
            checkInteractions(draft, node, [i]);
            return true;
          } catch {
            return false;
          }
        });
        checkBindings(draft, n);
        if (n.type === 'instance') checkInstanceTarget(draft, n, n.componentId);
        if (n.type === 'instance' && op.nodes.some((x) => x.id === n.componentId)) throw new OpError('An instance cannot reference a component inserted in the same tree');
      }
      return;
    }
    case 'updateNode': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      for (const k of STRUCTURAL_KEYS) {
        if (k in op.props) throw new OpError(`Property "${k}" cannot be updated directly`);
      }
      // JSON clone works on Immer drafts (structuredClone does not accept proxies).
      const next = { ...JSON.parse(JSON.stringify(node)), ...JSON.parse(JSON.stringify(op.props)) };
      const parsed = DesignNodeSchema.safeParse(next);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new OpError(`Invalid update on ${node.name}: ${issue?.path.join('.')} ${issue?.message}`);
      }
      // Assign only changed keys so Immer patches stay minimal.
      const target = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed.data)) {
        if (JSON.stringify(target[k]) !== JSON.stringify(v)) target[k] = v;
      }
      checkBindings(draft, node);
      if ('interactions' in op.props) checkInteractions(draft, node, node.interactions);
      return;
    }
    case 'deleteNode': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      const subtree = new Set<string>();
      const walk = (id: string) => {
        subtree.add(id);
        draft.nodes[id]?.childIds.forEach(walk);
      };
      walk(op.id);
      const components = new Set([...subtree].filter((id) => { const n = draft.nodes[id]; return n?.type === 'frame' && !!n.component; }));
      if (components.size) detachInstancesOf(draft, components, subtree);
      removeFrom(childListOf(draft, node.parentId), op.id);
      deleteSubtree(draft, op.id);
      pruneInteractions(draft, subtree);
      return;
    }
    case 'moveNode': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      if (wouldCreateCycle(draft, op.id, op.parentId)) throw new OpError('A node cannot be moved inside itself');
      const target = childListOf(draft, op.parentId);
      removeFrom(childListOf(draft, node.parentId), op.id);
      insertAt(target, op.id, op.index);
      node.parentId = op.parentId;
      const movedInstances: InstanceNode[] = [];
      const collect = (id: string) => {
        const n = draft.nodes[id];
        if (!n) return;
        if (n.type === 'instance') movedInstances.push(n);
        n.childIds.forEach(collect);
      };
      collect(op.id);
      for (const inst of movedInstances) checkInstanceTarget(draft, inst, inst.componentId);
      return;
    }
    case 'createPage': {
      if (draft.pages.some((p) => p.id === op.page.id) || draft.nodes[op.page.id]) throw new OpError('Duplicate page id');
      if (op.page.childIds.length) throw new OpError('New pages must be empty');
      const i = op.index ?? draft.pages.length;
      draft.pages.splice(Math.min(i, draft.pages.length), 0, structuredClone(op.page));
      return;
    }
    case 'updatePage': {
      const page = getPage(draft, op.id);
      if (!page) throw new OpError(`Page ${op.id} not found`);
      Object.assign(page, structuredClone(op.props));
      return;
    }
    case 'deletePage': {
      if (draft.pages.length <= 1) throw new OpError('A project must contain at least one page');
      const i = draft.pages.findIndex((p) => p.id === op.id);
      const page = draft.pages[i];
      if (!page) throw new OpError(`Page ${op.id} not found`);
      const removed = new Set<string>();
      const walk = (id: string) => {
        removed.add(id);
        draft.nodes[id]?.childIds.forEach(walk);
      };
      page.childIds.forEach(walk);
      for (const c of page.childIds) deleteSubtree(draft, c);
      draft.pages.splice(i, 1);
      pruneInteractions(draft, removed);
      return;
    }
    case 'movePage': {
      const i = draft.pages.findIndex((p) => p.id === op.id);
      if (i < 0) throw new OpError(`Page ${op.id} not found`);
      const [page] = draft.pages.splice(i, 1);
      draft.pages.splice(Math.min(op.index, draft.pages.length), 0, page!);
      return;
    }
    case 'addAsset': {
      draft.assets[op.asset.id] = structuredClone(op.asset);
      return;
    }
    case 'removeAsset': {
      const used = Object.values(draft.nodes).some((n) => n.type === 'image' && n.assetId === op.id);
      if (used) throw new OpError('Asset is still used by an image layer');
      delete draft.assets[op.id];
      return;
    }
    case 'renameProject': {
      draft.name = op.name;
      return;
    }
    case 'upsertToken': {
      const { kind, value } = op.token;
      const list = draft.tokens[kind] as { id: string; name: string }[];
      if (list.some((t) => t.id !== value.id && t.name === value.name)) throw new OpError(`A ${kind} token named "${value.name}" already exists`);
      const i = list.findIndex((t) => t.id === value.id);
      if (i >= 0) list[i] = structuredClone(value);
      else list.push(structuredClone(value));
      return;
    }
    case 'deleteToken': {
      const list = draft.tokens[op.kind] as { id: string }[];
      const i = list.findIndex((t) => t.id === op.id);
      if (i < 0) throw new OpError(`Token ${op.id} not found`);
      // Bake the token's current value into every bound layer before removing it.
      const tokens = JSON.parse(JSON.stringify(draft.tokens));
      for (const n of Object.values(draft.nodes)) {
        const keys = Object.entries(n.bindings ?? {}).filter(([k, id]) => id === op.id && TOKEN_KIND_OF_BINDING[k] === op.kind).map(([k]) => k);
        if (!keys.length) continue;
        const plain = JSON.parse(JSON.stringify(n)) as DesignNode;
        const resolved = applyTokens({ ...plain, bindings: Object.fromEntries(keys.map((k) => [k, op.id])) } as DesignNode, tokens);
        const target = n as Record<string, unknown>;
        for (const k of ['fills', 'stroke', 'radius', 'effects', 'layout', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) {
          if (k in resolved) target[k] = (resolved as Record<string, unknown>)[k];
        }
        const b = { ...plain.bindings };
        for (const k of keys) delete (b as Record<string, unknown>)[k];
        n.bindings = b;
      }
      list.splice(i, 1);
      return;
    }
    case 'setBreakpoints': {
      const ids = new Set(op.breakpoints.map((b) => b.id));
      if (ids.size !== op.breakpoints.length) throw new OpError('Duplicate breakpoint ids');
      draft.breakpoints = structuredClone(op.breakpoints);
      for (const n of Object.values(draft.nodes)) {
        for (const bp of Object.keys(n.responsive)) if (!ids.has(bp)) delete n.responsive[bp];
      }
      return;
    }
    case 'setResponsive': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      if (!draft.breakpoints.some((b) => b.id === op.breakpointId)) throw new OpError('Breakpoint not found');
      const merged = { ...(JSON.parse(JSON.stringify(node.responsive[op.breakpointId] ?? {}))), ...structuredClone(op.props) };
      const plain = JSON.parse(JSON.stringify(node)) as DesignNode;
      const check = DesignNodeSchema.safeParse(applyResponsive({ ...plain, responsive: { [op.breakpointId]: merged } } as DesignNode, [op.breakpointId]));
      if (!check.success) throw new OpError(`Invalid responsive override: ${check.error.issues[0]?.path.join('.')} ${check.error.issues[0]?.message}`);
      node.responsive[op.breakpointId] = merged;
      return;
    }
    case 'clearResponsive': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      const o = node.responsive[op.breakpointId];
      if (!o) return;
      if (!op.keys) delete node.responsive[op.breakpointId];
      else {
        for (const k of op.keys) delete (o as Record<string, unknown>)[k];
        if (!Object.keys(o).length) delete node.responsive[op.breakpointId];
      }
      return;
    }
    case 'setComponent': {
      const node = draft.nodes[op.id];
      if (!node || node.type !== 'frame') throw new OpError('Only frames can become components');
      if (op.component === null && node.component) detachInstancesOf(draft, new Set([node.id]));
      if (op.component && enclosingComponents(draft, node.parentId).length) throw new OpError('Components cannot be nested inside other components');
      (node as FrameNode).component = op.component ? structuredClone(op.component) : null;
      return;
    }
    case 'setInstanceComponent': {
      const node = draft.nodes[op.id];
      if (!node || node.type !== 'instance') throw new OpError('Not an instance');
      checkInstanceTarget(draft, node, op.componentId);
      node.componentId = op.componentId;
      return;
    }
    case 'setInstanceOverride': {
      const node = draft.nodes[op.id];
      if (!node || node.type !== 'instance') throw new OpError('Not an instance');
      const src = draft.nodes[op.sourceId];
      if (!src) throw new OpError('Layer not found in the main component');
      const merged = { ...(JSON.parse(JSON.stringify(node.overrides[op.sourceId] ?? {}))), ...structuredClone(op.props) };
      const check = DesignNodeSchema.safeParse({ ...JSON.parse(JSON.stringify(src)), ...merged });
      if (!check.success) throw new OpError(`Invalid override: ${check.error.issues[0]?.path.join('.')} ${check.error.issues[0]?.message}`);
      node.overrides[op.sourceId] = merged;
      return;
    }
    case 'resetInstanceOverride': {
      const node = draft.nodes[op.id];
      if (!node || node.type !== 'instance') throw new OpError('Not an instance');
      if (op.sourceId) delete node.overrides[op.sourceId];
      else node.overrides = {};
      return;
    }
    case 'setInteractions': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      checkInteractions(draft, node, op.interactions);
      node.interactions = structuredClone(op.interactions);
      return;
    }
    case 'setPrototypeStart': {
      if (op.frameId && !isScreen(draft, op.frameId)) throw new OpError('The start screen must be a top-level frame');
      draft.prototype.startFrameId = op.frameId;
      return;
    }
    case 'detachInstance': {
      detachInDraft(draft, op.id);
      return;
    }
    case 'createWorkflow': {
      if (draft.workflows.some((w) => w.id === op.workflow.id)) throw new OpError('Duplicate workflow id');
      const wf: Workflow = { ...structuredClone(op.workflow), nodes: [], edges: [] };
      for (const n of op.workflow.nodes) {
        if (wf.nodes.some((x) => x.id === n.id)) throw new OpError(`Duplicate workflow node ${n.id}`);
        wf.nodes.push({ ...structuredClone(n), params: checkedParams(n.kind, n.params) });
      }
      for (const e of op.workflow.edges) {
        const err = validateConnection(wf, e);
        if (err) throw new OpError(err);
        wf.edges.push(structuredClone(e));
      }
      draft.workflows.splice(Math.min(op.index ?? draft.workflows.length, draft.workflows.length), 0, wf);
      return;
    }
    case 'updateWorkflow': {
      Object.assign(getWorkflow(draft, op.id), structuredClone(op.props));
      return;
    }
    case 'deleteWorkflow': {
      const i = draft.workflows.findIndex((w) => w.id === op.id);
      if (i < 0) throw new OpError(`Workflow ${op.id} not found`);
      draft.workflows.splice(i, 1);
      return;
    }
    case 'addWorkflowNodes': {
      const wf = getWorkflow(draft, op.workflowId);
      for (const n of op.nodes) {
        if (wf.nodes.some((x) => x.id === n.id)) throw new OpError(`Duplicate workflow node ${n.id}`);
        wf.nodes.push({ ...structuredClone(n), params: checkedParams(n.kind, n.params) });
      }
      return;
    }
    case 'updateWorkflowNode': {
      const wf = getWorkflow(draft, op.workflowId);
      const n = wf.nodes.find((x) => x.id === op.id);
      if (!n) throw new OpError(`Workflow node ${op.id} not found`);
      if (op.props.label !== undefined) n.label = op.props.label;
      if (op.props.position) n.position = { ...op.props.position };
      if (op.props.params) n.params = checkedParams(n.kind, { ...JSON.parse(JSON.stringify(n.params)), ...structuredClone(op.props.params) });
      return;
    }
    case 'removeWorkflowNodes': {
      const wf = getWorkflow(draft, op.workflowId);
      const ids = new Set(op.ids);
      wf.nodes = wf.nodes.filter((n) => !ids.has(n.id));
      wf.edges = wf.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
      return;
    }
    case 'addWorkflowEdge': {
      const wf = getWorkflow(draft, op.workflowId);
      if (wf.edges.some((e) => e.id === op.edge.id)) throw new OpError('Duplicate edge id');
      const err = validateConnection(wf, op.edge);
      if (err) throw new OpError(err);
      wf.edges.push(structuredClone(op.edge));
      return;
    }
    case 'removeWorkflowEdges': {
      const wf = getWorkflow(draft, op.workflowId);
      const ids = new Set(op.ids);
      wf.edges = wf.edges.filter((e) => !ids.has(e.id));
      return;
    }
  }
}

/** Parses untrusted ops (e.g. from AI or imports) and applies them. */
export function parseOps(input: unknown): DocOp[] {
  const res = z.array(DocOpSchema).safeParse(input);
  if (!res.success) throw new OpError(`Malformed operations: ${res.error.issues[0]?.message ?? 'unknown error'}`);
  return res.data;
}

export function applyOps(draft: Project, ops: DocOp[]): void {
  for (const op of ops) applyOp(draft, op);
}

/** Convenience op builders. */
export const op = {
  insert: (nodes: DesignNode[], index?: number): DocOp => ({ type: 'insertTree', nodes, index }),
  update: (id: string, props: Partial<DesignNode>): DocOp => ({ type: 'updateNode', id, props: props as Record<string, unknown> }),
  remove: (id: string): DocOp => ({ type: 'deleteNode', id }),
  move: (id: string, parentId: string, index?: number): DocOp => ({ type: 'moveNode', id, parentId, index }),
};
