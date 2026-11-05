/** Workflow-level editor commands (all mutations go through validated document ops). */
import { createId } from '@/core/ids';
import type { Workflow } from '@/core/schema';
import { getSpec } from '@/core/workflow/catalog';
import { BUILTIN_TEMPLATES, cloneWorkflow, instantiateTemplate, type TemplateDef } from '@/core/workflow/templates';
import { t } from '@/i18n';
import { workflowRepo } from '@/persistence/workflowRepo';
import { dispatch, getProject } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { zoomToSelection } from '@/ui/editor/viewportActions';

const lang = () => useSettingsStore.getState().language;
const toast = (m: string, tone: 'info' | 'error' = 'info') => useEditorStore.getState().showToast(m, tone);

function insertWorkflow(wf: Workflow): boolean {
  const res = dispatch([{ type: 'createWorkflow', workflow: wf }], { label: 'Create workflow' });
  if (!res.ok) {
    toast(res.error, 'error');
    return false;
  }
  useWorkflowStore.getState().setActive(wf.id);
  return true;
}

export function createEmptyWorkflow() {
  const n = (getProject()?.workflows.length ?? 0) + 1;
  insertWorkflow({ id: createId(), name: `${t('wf.untitled')} ${n}`, nodes: [], edges: [] });
}

export function createFromTemplate(tpl: TemplateDef) {
  const s = useEditorStore.getState();
  const project = getProject();
  // Templates that start from an existing design default to the page currently open in the editor.
  const pageWithFrames = project?.pages.find((p) => p.id === s.pageId && p.childIds.length) ?? project?.pages.find((p) => p.childIds.length);
  insertWorkflow(instantiateTemplate(tpl, tpl.name[lang()], lang(), pageWithFrames?.id));
}

export async function createFromUserTemplate(id: string) {
  const tpl = (await workflowRepo.listTemplates()).find((x) => x.id === id);
  if (!tpl) return;
  try {
    insertWorkflow(cloneWorkflow(tpl.workflow, tpl.name));
  } catch {
    toast('Template non valido / Invalid template', 'error');
  }
}

export function duplicateWorkflow(id: string) {
  const wf = getProject()?.workflows.find((w) => w.id === id);
  if (!wf) return;
  insertWorkflow(cloneWorkflow(wf, `${wf.name} · ${lang() === 'it' ? 'ramo' : 'branch'}`));
}

export function deleteWorkflow(id: string) {
  const project = getProject();
  const wf = project?.workflows.find((w) => w.id === id);
  if (!wf || !window.confirm(t('wf.confirmDelete', { name: wf.name }))) return;
  const res = dispatch([{ type: 'deleteWorkflow', id }], { label: 'Delete workflow' });
  if (res.ok) useWorkflowStore.getState().setActive(res.project.workflows[0]?.id ?? null);
}

export function renameWorkflow(id: string, name: string) {
  dispatch([{ type: 'updateWorkflow', id, props: { name } }], { label: 'Rename workflow' });
}

export async function saveAsTemplate(id: string) {
  const wf = getProject()?.workflows.find((w) => w.id === id);
  if (!wf) return;
  await workflowRepo.saveTemplate({ id: createId(), name: wf.name, createdAt: Date.now(), workflow: { nodes: wf.nodes, edges: wf.edges } });
  toast(t('wf.templateSaved'));
}

export function addNode(workflowId: string, kind: string, position: { x: number; y: number }) {
  const spec = getSpec(kind);
  if (!spec) return;
  const node = { id: createId(), kind, label: spec.label[lang()], position, params: { ...spec.defaults } };
  // Design inputs default to the page currently open in the design editor.
  if (kind === 'design-input') node.params.pageId = useEditorStore.getState().pageId;
  const res = dispatch([{ type: 'addWorkflowNodes', workflowId, nodes: [node] }], { label: 'Add workflow node' });
  if (res.ok) useWorkflowStore.getState().selectNode(node.id);
  else toast(res.error, 'error');
}

export function updateNodeParams(workflowId: string, nodeId: string, params: Record<string, unknown>, mergeKey?: string) {
  const res = dispatch([{ type: 'updateWorkflowNode', workflowId, id: nodeId, props: { params } }], {
    label: 'Edit workflow node',
    mergeKey: mergeKey ? `wfp:${nodeId}:${mergeKey}` : undefined,
  });
  if (res.ok) useWorkflowStore.getState().markStale(workflowId, nodeId);
  else toast(res.error, 'error');
}

export function renameNode(workflowId: string, nodeId: string, label: string) {
  dispatch([{ type: 'updateWorkflowNode', workflowId, id: nodeId, props: { label } }], { label: 'Rename workflow node' });
}

/** Switches to the design canvas showing (and selecting) the given frames or layer. */
export function openInCanvas(pageId: string, ids: string[]) {
  const project = getProject();
  if (!project?.pages.some((p) => p.id === pageId)) return;
  const s = useEditorStore.getState();
  s.setMode('design');
  s.setPage(pageId);
  s.select(ids.filter((id) => project.nodes[id]));
  requestAnimationFrame(() => requestAnimationFrame(() => zoomToSelection()));
}

export { BUILTIN_TEMPLATES };
