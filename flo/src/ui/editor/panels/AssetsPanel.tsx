import { Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import type { AssetMeta } from '@/core/schema';
import { useAssetUrl } from '@/editor/assetUrls';
import { ACCEPTED_IMAGE_TYPES, importAndInsertImages, insertImageAsset, removeAsset } from '@/editor/imageImport';
import { useT } from '@/i18n';
import { useDocStore } from '@/store/docStore';

function AssetTile({ asset, projectId }: { asset: AssetMeta; projectId: string }) {
  const t = useT();
  const url = useAssetUrl(projectId, asset.id);
  return (
    <div className="group relative overflow-hidden rounded-md border border-line bg-field/40">
      <button
        className="block aspect-square w-full"
        title={`${t('assets.insert')}: ${asset.name}`}
        onClick={() => insertImageAsset(asset.id)}
      >
        {url && <img src={url} alt={asset.name} className="h-full w-full object-contain p-1" draggable={false} />}
      </button>
      <div className="flex items-center justify-between gap-1 border-t border-line px-1.5 py-1 text-[10px] text-fg-muted">
        <span className="truncate">{asset.name}</span>
        <button title={t('assets.remove')} aria-label={t('assets.remove')} className="hidden text-fg-subtle hover:text-danger group-hover:block" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export function AssetsPanel() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const project = useDocStore((s) => s.project);
  if (!project) return null;
  const assets = Object.values(project.assets);
  return (
    <div className="flex flex-col gap-3 p-3">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        data-testid="asset-input"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          await importAndInsertImages(files);
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="flex h-8 items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-[11px] text-fg-muted hover:border-accent hover:text-fg"
      >
        <Upload size={14} /> {t('assets.upload')}
      </button>
      {assets.length === 0 ? (
        <p className="text-[11px] leading-4 text-fg-subtle">{t('assets.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {assets.map((a) => (
            <AssetTile key={a.id} asset={a} projectId={project.id} />
          ))}
        </div>
      )}
    </div>
  );
}
