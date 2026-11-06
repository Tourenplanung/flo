/** Code export commands (React project as .zip, standalone HTML). */
import { exportReactProject, zipExport } from '@/core/export/react';
import { exportHtml } from '@/core/workflow/htmlExport';
import { t } from '@/i18n';
import { projectRepo } from '@/persistence/projectRepo';
import { getProject } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { downloadBlob, downloadText } from '@/ui/common/download';
import { createEditorHost } from './workflowHost';

/** Screens to export: top-level frames containing the selection, else every visible frame of the page. */
export function exportScope(): string[] {
  const project = getProject();
  const s = useEditorStore.getState();
  if (!project || !s.pageId) return [];
  const tops = new Set<string>();
  for (const id of s.selection) {
    let cur = project.nodes[id.split('__')[0]!];
    while (cur && project.nodes[cur.parentId]) cur = project.nodes[cur.parentId]!;
    if (cur?.type === 'frame') tops.add(cur.id);
  }
  if (tops.size) return [...tops];
  const page = project.pages.find((p) => p.id === s.pageId)!;
  return page.childIds.filter((id) => project.nodes[id]?.type === 'frame' && project.nodes[id]!.visible);
}

export const fileSlug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'flo-export';

async function assetBytes(assetId: string): Promise<Uint8Array | null> {
  const project = getProject();
  if (!project) return null;
  const blob = await projectRepo.getAssetBlob(project.id, assetId);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export async function exportReactZip(): Promise<void> {
  const project = getProject();
  const ids = exportScope();
  const toast = useEditorStore.getState().showToast;
  if (!project || !ids.length) return toast(t('exp.noFrames'), 'error');
  try {
    const lang = useSettingsStore.getState().language;
    const res = await exportReactProject(project, ids, { name: project.name, lang }, { getAssetBytes: assetBytes });
    const slug = fileSlug(project.name);
    const zip = await zipExport(res.files, slug);
    downloadBlob(`${slug}-react.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }));
    const issues = res.a11y.issues.filter((i) => i.severity !== 'info').length;
    toast(t('exp.reactDone', { n: res.screens.length, a: issues, w: res.warnings.length }));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

export async function exportHtmlFile(): Promise<void> {
  const project = getProject();
  const ids = exportScope();
  if (!project || !ids.length) return useEditorStore.getState().showToast(t('exp.noFrames'), 'error');
  const html = await exportHtml(project, ids, project.name, createEditorHost());
  downloadText(`${fileSlug(project.name)}.html`, html, 'text/html');
}
