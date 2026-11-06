/** Structural integrity checks beyond what the Zod schema can express. */
import { ProjectSchema, isContainer, type Project, type Workflow } from './schema';
import { componentDependencies, enclosingComponents } from './instance';
import { parseParams } from './workflow/catalog';
import { validateConnection } from './workflow/graph';

export interface IntegrityIssue {
  severity: 'error' | 'warning';
  message: string;
}

export function checkIntegrity(project: Project): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', message });
  const pageIds = new Set(project.pages.map((p) => p.id));
  if (pageIds.size !== project.pages.length) err('Duplicate page ids');

  const seen = new Map<string, string>(); // child -> parent that lists it
  const claim = (parentId: string, childId: string) => {
    if (seen.has(childId)) err(`Node ${childId} is listed by multiple parents`);
    seen.set(childId, parentId);
    const child = project.nodes[childId];
    if (!child) return err(`Parent ${parentId} lists missing child ${childId}`);
    if (child.parentId !== parentId) err(`Node ${childId} parentId mismatch (${child.parentId} vs ${parentId})`);
  };

  for (const page of project.pages) {
    if (project.nodes[page.id]) err(`Id ${page.id} used by both a page and a node`);
    page.childIds.forEach((c) => claim(page.id, c));
  }
  for (const node of Object.values(project.nodes)) {
    if (node.childIds.length && !isContainer(node)) err(`${node.type} ${node.id} cannot have children`);
    node.childIds.forEach((c) => claim(node.id, c));
    if (node.type === 'image' && node.assetId && !project.assets[node.assetId]) {
      issues.push({ severity: 'warning', message: `Image ${node.id} references missing asset ${node.assetId}` });
    }
  }
  for (const id of Object.keys(project.nodes)) {
    if (!seen.has(id)) err(`Node ${id} is orphaned`);
  }
  // Cycle detection: walking parents from any node must reach a page.
  for (const node of Object.values(project.nodes)) {
    let cur: string = node.id;
    const visited = new Set<string>();
    while (!pageIds.has(cur)) {
      if (visited.has(cur)) {
        err(`Cycle detected at ${node.id}`);
        break;
      }
      visited.add(cur);
      const n = project.nodes[cur];
      if (!n) break; // already reported as mismatch/orphan
      cur = n.parentId;
    }
  }
  // Tokens, bindings, breakpoints, components.
  const bpIds = new Set(project.breakpoints.map((b) => b.id));
  if (bpIds.size !== project.breakpoints.length) err('Duplicate breakpoint ids');
  const tokenIds: Record<string, Set<string>> = {};
  for (const [kind, list] of Object.entries(project.tokens)) {
    tokenIds[kind] = new Set((list as { id: string }[]).map((t) => t.id));
    if (tokenIds[kind]!.size !== (list as unknown[]).length) err(`Duplicate ${kind} token ids`);
  }
  const bindingKind: Record<string, string> = { fill: 'colors', stroke: 'colors', text: 'text', radius: 'radius', gap: 'spacing', padding: 'spacing', shadow: 'shadows' };
  for (const node of Object.values(project.nodes)) {
    for (const [k, id] of Object.entries(node.bindings)) {
      if (!tokenIds[bindingKind[k] ?? '']?.has(id as string)) issues.push({ severity: 'warning', message: `Node ${node.id} is bound to missing token ${id}` });
    }
    for (const bp of Object.keys(node.responsive)) if (!bpIds.has(bp)) err(`Node ${node.id} has overrides for unknown breakpoint ${bp}`);
    for (const it of node.interactions) {
      const a = it.action;
      const ref = a.type === 'navigate' || a.type === 'open-overlay' ? a.destinationId : a.type === 'toggle-visibility' ? a.targetId : null;
      if (ref && !project.nodes[ref]) issues.push({ severity: 'warning', message: `Interaction on ${node.id} points to missing layer ${ref}` });
    }
    if (node.type === 'instance') {
      const main = project.nodes[node.componentId];
      if (!main || main.type !== 'frame' || !main.component) err(`Instance ${node.id} references a missing component`);
      else {
        const enclosing = enclosingComponents(project, node.parentId);
        const deps = componentDependencies(project, node.componentId);
        if (enclosing.some((c) => deps.has(c))) err(`Instance ${node.id} creates a component cycle`);
      }
    }
  }

  // Workflows: known node kinds, valid params, valid typed acyclic connections.
  const wfIds = new Set<string>();
  for (const wf of project.workflows) {
    if (wfIds.has(wf.id)) err(`Duplicate workflow id ${wf.id}`);
    wfIds.add(wf.id);
    const rebuilt: Workflow = { ...wf, edges: [] };
    const nodeIds = new Set<string>();
    for (const n of wf.nodes) {
      if (nodeIds.has(n.id)) err(`Duplicate workflow node ${n.id}`);
      nodeIds.add(n.id);
      const res = parseParams(n.kind, n.params);
      if (!res.ok) err(`Workflow node ${n.id}: ${res.error}`);
    }
    for (const e of wf.edges) {
      const problem = validateConnection(rebuilt, e);
      if (problem) err(`Workflow edge ${e.id}: ${problem}`);
      else rebuilt.edges.push(e);
    }
  }
  return issues;
}

export class ProjectValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(`Invalid project: ${details.slice(0, 3).join('; ')}`);
    this.name = 'ProjectValidationError';
  }
}

/** Validates untrusted data as a Project (schema + integrity). Throws on failure. */
export function parseProject(data: unknown): Project {
  const res = ProjectSchema.safeParse(data);
  if (!res.success) {
    throw new ProjectValidationError(res.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const errors = checkIntegrity(res.data).filter((i) => i.severity === 'error');
  if (errors.length) throw new ProjectValidationError(errors.map((e) => e.message));
  return res.data;
}
