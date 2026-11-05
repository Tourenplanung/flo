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
  DesignNodeSchema,
  GuideSchema,
  HexColorSchema,
  IdSchema,
  PageSchema,
  STRUCTURAL_KEYS,
  isContainer,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  WorkflowSchema,
  type DesignNode,
  type Project,
  type Workflow,
} from './schema';
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
      return;
    }
    case 'deleteNode': {
      const node = draft.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      removeFrom(childListOf(draft, node.parentId), op.id);
      deleteSubtree(draft, op.id);
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
      for (const c of page.childIds) deleteSubtree(draft, c);
      draft.pages.splice(i, 1);
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
