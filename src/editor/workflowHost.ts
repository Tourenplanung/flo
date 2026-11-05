/** Connects the framework-independent workflow engine to the editor's stores. */
import { createElement } from 'react';
import { blobToDataUrl } from '@/core/fileFormat';
import type { IconName } from '@/core/schema';
import type { EngineHost } from '@/core/workflow/engine';
import { projectRepo } from '@/persistence/projectRepo';
import { dispatch, getProject } from '@/store/docStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DESIGN_ICONS } from '@/ui/common/icons';

export function createEditorHost(): EngineHost {
  return {
    aiAvailable: false,
    lang: useSettingsStore.getState().language,
    getProject: () => {
      const p = getProject();
      if (!p) throw new Error('No project open');
      return p;
    },
    apply: (ops, label) => {
      const res = dispatch(ops, { label });
      if (!res.ok) throw new Error(res.error);
      return res.project;
    },
    getAssetDataUrl: async (assetId) => {
      const p = getProject();
      if (!p) return null;
      const blob = await projectRepo.getAssetBlob(p.id, assetId);
      return blob ? blobToDataUrl(blob) : null;
    },
    iconSvg: async (name, strokeWidth) => {
      const Icon = DESIGN_ICONS[name as IconName];
      if (!Icon) return '';
      const { renderToStaticMarkup } = await import('react-dom/server');
      return renderToStaticMarkup(createElement(Icon, { width: '100%', height: '100%', strokeWidth }));
    },
  };
}
