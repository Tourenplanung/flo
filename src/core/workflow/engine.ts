/**
 * Workflow execution engine (framework-independent).
 *
 * - Runs nodes in topological order (optionally only the upstream of a target node).
 * - Caches each node's outputs under a key derived from its kind, params and inputs; design
 *   inputs are fingerprinted from the live document, so editing a design invalidates
 *   downstream results automatically.
 * - Nodes that write to the document (wireframe, apply styles, responsive) replace the
 *   frames they generated on the previous run instead of duplicating them.
 * - Never fabricates results: AI nodes without a provider and planned nodes report
 *   'unavailable'.
 */
import type { DocOp } from '../ops';
import type { Project, Workflow, WorkflowNode } from '../schema';
import { collectSubtree } from '../tree';
import { getSpec, type DesignValue, type NodeSpec, type PortValue } from './catalog';
import { topoOrder, upstreamOf } from './graph';
import { RUNNERS } from './runners';
import type { GenerateRequest, GenerateResult } from '../ai/provider';

export type NodeStatus = 'idle' | 'running' | 'done' | 'cached' | 'error' | 'skipped' | 'unavailable';

export interface EngineHost {
  getProject(): Project;
  /** Applies ops as one undoable transaction; throws on validation errors. */
  apply(ops: DocOp[], label: string): Project;
  getAssetDataUrl?(assetId: string): Promise<string | null>;
  iconSvg?(name: string, strokeWidth: number): Promise<string>;
  /** True when an AI provider is configured. */
  aiAvailable: boolean;
  /** AI access (provider + user authorization for billable calls). */
  ai?: { generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> };
  lang: 'it' | 'en';
}

export interface CacheEntry {
  key: string;
  inputs: Record<string, PortValue | undefined>;
  outputs: Record<string, PortValue | undefined>;
  /** Frames this node created in the document on its last run. */
  generated?: DesignValue;
  summary?: string;
  finishedAt: number;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  nodeId: string;
  kind: string;
  label: string;
  startedAt: number;
  durationMs: number;
  status: NodeStatus;
  cached: boolean;
  error?: string;
  summary?: string;
}

export interface RunnerContext {
  node: WorkflowNode;
  params: Record<string, unknown>;
  inputs: Record<string, PortValue | undefined>;
  host: EngineHost;
  previous?: CacheEntry;
}

export interface RunnerResult {
  outputs: Record<string, PortValue | undefined>;
  generated?: DesignValue;
  summary?: string;
}

export type Runner = (ctx: RunnerContext) => Promise<RunnerResult> | RunnerResult;

export class NodeRunError extends Error {}

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprint of the current content of a design value (changes when the frames are edited). */
export function designFingerprint(project: Project, d: DesignValue): string {
  const parts = d.frameIds.map((id) => (project.nodes[id] ? stableStringify(collectSubtree(project, id)) : `missing:${id}`));
  return hash(parts.join('|'));
}

function inputKey(project: Project, v: PortValue | undefined): string {
  if (!v) return '∅';
  if (v.type === 'design') return `design:${designFingerprint(project, v)}`;
  return hash(stableStringify(v));
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export interface RunOptions {
  /** Run only this node and its upstream dependencies. */
  targetId?: string;
  /** Node ids to re-execute even when cached (or true for all). */
  force?: boolean | Set<string>;
  onStatus?: (nodeId: string, status: NodeStatus, error?: string) => void;
  signal?: AbortSignal;
  newId?: () => string;
}

export interface RunResult {
  records: ExecutionRecord[];
  statuses: Record<string, NodeStatus>;
  errors: Record<string, string>;
}

const UNAVAILABLE = {
  ai: { it: 'Richiede un provider AI: configura Ollama o Claude nelle impostazioni (Milestone 4).', en: 'Requires an AI provider: configure Ollama or Claude in settings (Milestone 4).' },
  planned: { it: 'Non ancora disponibile in questa versione di flö.', en: 'Not available yet in this version of flö.' },
};

export function unavailableReason(spec: NodeSpec, host: Pick<EngineHost, 'aiAvailable' | 'lang'>): string | null {
  if (spec.availability === 'planned') return UNAVAILABLE.planned[host.lang];
  if (spec.availability === 'ai' && !host.aiAvailable) return UNAVAILABLE.ai[host.lang];
  return null;
}

function generatedStillExists(project: Project, g: DesignValue | undefined): boolean {
  return !g || g.frameIds.every((id) => !!project.nodes[id]);
}

export async function runWorkflow(wf: Workflow, cache: Map<string, CacheEntry>, host: EngineHost, opts: RunOptions = {}): Promise<RunResult> {
  const subset = opts.targetId ? upstreamOf(wf, opts.targetId) : undefined;
  const order = topoOrder(wf, subset);
  const records: ExecutionRecord[] = [];
  const statuses: Record<string, NodeStatus> = {};
  const errors: Record<string, string> = {};
  const outputs = new Map<string, Record<string, PortValue | undefined>>();
  const newId = opts.newId ?? (() => Math.random().toString(36).slice(2));
  const set = (id: string, status: NodeStatus, error?: string) => {
    statuses[id] = status;
    if (error) errors[id] = error;
    opts.onStatus?.(id, status, error);
  };

  for (const id of order) {
    if (opts.signal?.aborted) break;
    const node = wf.nodes.find((n) => n.id === id)!;
    const spec = getSpec(node.kind);
    const started = Date.now();
    const record = (status: NodeStatus, extra: Partial<ExecutionRecord> = {}) =>
      records.push({
        id: newId(),
        workflowId: wf.id,
        nodeId: id,
        kind: node.kind,
        label: node.label,
        startedAt: started,
        durationMs: Date.now() - started,
        status,
        cached: false,
        ...extra,
      });

    if (!spec) {
      const error = `Unknown node kind ${node.kind}`;
      set(id, 'error', error);
      record('error', { error });
      continue;
    }
    const reason = unavailableReason(spec, host);
    if (reason) {
      set(id, 'unavailable', reason);
      record('unavailable', { error: reason });
      continue;
    }

    // Gather inputs.
    const inputs: Record<string, PortValue | undefined> = {};
    let missing: string | null = null;
    let inactive = false;
    for (const port of spec.inputs) {
      const edge = wf.edges.find((e) => e.target === id && e.targetPort === port.id);
      if (!edge) {
        if (!port.optional) missing = port.label[host.lang];
        continue;
      }
      const v = outputs.get(edge.source)?.[edge.sourcePort];
      if (v === undefined && !port.optional) inactive = true;
      inputs[port.id] = v;
    }
    if (missing) {
      const error = host.lang === 'it' ? `Ingresso “${missing}” non collegato` : `Input “${missing}” is not connected`;
      set(id, 'error', error);
      record('error', { error });
      continue;
    }
    if (inactive || (spec.inputs.length > 0 && spec.inputs.every((p) => p.optional) && Object.values(inputs).every((v) => v === undefined) && wf.edges.some((e) => e.target === id))) {
      set(id, 'skipped');
      record('skipped');
      continue;
    }

    const project = host.getProject();
    const runner = RUNNERS[node.kind];
    if (!runner) {
      const error = `No runner for ${node.kind}`;
      set(id, 'error', error);
      record('error', { error });
      continue;
    }
    const extra = node.kind === 'design-input' ? designInputFingerprint(project, node.params) : '';
    const key = hash(stableStringify({ kind: node.kind, params: node.params, extra, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, inputKey(project, v)])) }));
    const prev = cache.get(id);
    const forced = opts.force === true || (opts.force instanceof Set && opts.force.has(id));
    if (!forced && prev && prev.key === key && generatedStillExists(project, prev.generated)) {
      outputs.set(id, prev.outputs);
      set(id, 'cached');
      record('cached', { cached: true, summary: prev.summary });
      continue;
    }

    set(id, 'running');
    try {
      const res = await runner({ node, params: node.params, inputs, host, previous: prev });
      outputs.set(id, res.outputs);
      // Key must reflect the document state *after* side effects for downstream fingerprints,
      // but this node's own key is based on its inputs, which did not change.
      cache.set(id, { key, inputs, outputs: res.outputs, generated: res.generated, summary: res.summary, finishedAt: Date.now() });
      set(id, 'done');
      record('done', { summary: res.summary });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      cache.delete(id);
      set(id, 'error', error);
      record('error', { error });
    }
  }
  return { records, statuses, errors };
}

function designInputFingerprint(project: Project, params: Record<string, unknown>): string {
  const pageId = params.pageId as string | null;
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return 'nopage';
  const frameIds = (params.frameIds as string[]).length ? (params.frameIds as string[]) : page.childIds;
  return designFingerprint(project, { type: 'design', pageId: page.id, frameIds });
}
