import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Italic, Upload } from 'lucide-react';
import { useRef } from 'react';
import { updateNodes } from '@/editor/actions';
import { ACCEPTED_IMAGE_TYPES, addImageAssets } from '@/editor/imageImport';
import { useT } from '@/i18n';
import { ICON_NAMES, type DesignNode, type IconNode, type ImageNode, type LineHeight, type LineNode, type TextNode, type TextRole } from '@/core/schema';
import { FONTS } from '@/core/style';
import { useDocStore } from '@/store/docStore';
import { Checkbox, IconButton, MIXED, NumberField, Section, Segmented, SelectField, TextField } from '@/ui/common/controls';
import { DESIGN_ICONS } from '@/ui/common/icons';
import { common } from './helpers';

const WEIGHTS = [
  { value: 100, label: 'Thin 100' },
  { value: 200, label: 'Extra Light 200' },
  { value: 300, label: 'Light 300' },
  { value: 400, label: 'Regular 400' },
  { value: 500, label: 'Medium 500' },
  { value: 600, label: 'Semibold 600' },
  { value: 700, label: 'Bold 700' },
  { value: 800, label: 'Extra Bold 800' },
  { value: 900, label: 'Black 900' },
];

const TEXT_ROLES: TextRole[] = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a'];

export function TypographySection({ nodes }: { nodes: TextNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const set = (props: Partial<TextNode>, key?: string) => updateNodes(ids, props as Partial<DesignNode>, key);
  const lh = common(nodes, (n) => n.lineHeight);
  const lhValue = lh === MIXED ? MIXED : lh.unit === 'auto' ? MIXED : lh.value;
  const lhUnit = lh === MIXED ? MIXED : lh.unit;
  const family = common(nodes, (n) => n.fontFamily);
  const fontOptions = FONTS.map((f) => ({ value: f.family, label: f.family }));
  if (family !== MIXED && !FONTS.some((f) => f.family === family)) fontOptions.push({ value: family, label: family });
  const single = nodes.length === 1 ? nodes[0]! : null;

  return (
    <Section title={t('insp.typography')}>
      {single && (
        <TextField multiline testId="insp-characters" value={single.characters} onChange={(v) => set({ characters: v })} />
      )}
      <SelectField testId="insp-font" title={t('insp.font')} value={family} options={fontOptions} onChange={(v) => set({ fontFamily: v })} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          testId="insp-weight"
          title={t('insp.weight')}
          value={common(nodes, (n) => n.fontWeight)}
          options={WEIGHTS}
          onChange={(v) => set({ fontWeight: v })}
        />
        <NumberField
          label="Aa"
          title={t('insp.fontSize')}
          testId="insp-font-size"
          min={1}
          max={2000}
          value={common(nodes, (n) => n.fontSize)}
          onChange={(v) => set({ fontSize: v }, 'fontSize')}
        />
        <div className="flex gap-1">
          <NumberField
            label="↕"
            title={t('insp.lineHeight')}
            testId="insp-line-height"
            min={0}
            value={lhValue}
            mixedLabel="Auto"
            onChange={(v) => set({ lineHeight: { unit: lhUnit === 'px' ? 'px' : 'percent', value: v } as LineHeight }, 'lh')}
            onClear={() => set({ lineHeight: { unit: 'auto' } })}
          />
          <div className="w-14 shrink-0">
            <SelectField
              value={lhUnit}
              options={[
                { value: 'percent', label: '%' },
                { value: 'px', label: 'px' },
                { value: 'auto', label: 'auto' },
              ]}
              onChange={(u) => {
                if (u === 'auto') set({ lineHeight: { unit: 'auto' } });
                else
                  updateNodes(ids, (n) => {
                    const tn = n as TextNode;
                    const cur = tn.lineHeight;
                    const px = cur.unit === 'px' ? cur.value : cur.unit === 'percent' ? (cur.value / 100) * tn.fontSize : tn.fontSize * 1.2;
                    const value = u === 'px' ? Math.round(px * 10) / 10 : Math.round((px / tn.fontSize) * 1000) / 10;
                    return { lineHeight: { unit: u, value } } as Partial<DesignNode>;
                  });
              }}
            />
          </div>
        </div>
        <NumberField
          label="|A|"
          title={t('insp.letterSpacing')}
          testId="insp-letter-spacing"
          step={0.1}
          value={common(nodes, (n) => n.letterSpacing)}
          suffix="px"
          onChange={(v) => set({ letterSpacing: v }, 'ls')}
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Segmented
          value={common(nodes, (n) => n.textAlign)}
          onChange={(v) => set({ textAlign: v })}
          options={[
            { value: 'left', label: 'Left', icon: <AlignLeft size={14} /> },
            { value: 'center', label: 'Center', icon: <AlignCenter size={14} /> },
            { value: 'right', label: 'Right', icon: <AlignRight size={14} /> },
            { value: 'justify', label: 'Justify', icon: <AlignJustify size={14} /> },
          ]}
        />
        <IconButton label="Italic" active={nodes.every((n) => n.italic)} onClick={() => set({ italic: !nodes.every((n) => n.italic) })}>
          <Italic size={14} />
        </IconButton>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <SelectField
          title={t('insp.textCase')}
          value={common(nodes, (n) => n.textCase)}
          onChange={(v) => set({ textCase: v })}
          options={[
            { value: 'none', label: 'Aa' },
            { value: 'upper', label: 'AA' },
            { value: 'lower', label: 'aa' },
            { value: 'title', label: 'Aa Bb' },
          ]}
        />
        <SelectField
          title={t('insp.decoration')}
          value={common(nodes, (n) => n.textDecoration)}
          onChange={(v) => set({ textDecoration: v })}
          options={[
            { value: 'none', label: '—' },
            { value: 'underline', label: 'U̲' },
            { value: 'line-through', label: 'S̶' },
          ]}
        />
        <SelectField
          title={t('insp.role')}
          testId="insp-text-role"
          value={common(nodes, (n) => n.role)}
          onChange={(v) => set({ role: v })}
          options={TEXT_ROLES.map((r) => ({ value: r, label: `<${r}>` }))}
        />
      </div>
    </Section>
  );
}

export function ImageSection({ nodes }: { nodes: ImageNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const assets = useDocStore((s) => s.project?.assets ?? {});
  const fileRef = useRef<HTMLInputElement>(null);
  const assetId = common(nodes, (n) => n.assetId);
  return (
    <Section
      title={t('insp.image')}
      action={
        <IconButton label={t('assets.upload')} onClick={() => fileRef.current?.click()}>
          <Upload size={14} />
        </IconButton>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          const [id] = await addImageAssets(files.slice(0, 1));
          if (id) updateNodes(ids, { assetId: id } as Partial<DesignNode>);
        }}
      />
      <SelectField
        title={t('insp.chooseImage')}
        value={assetId === null ? '' : assetId}
        options={[{ value: '', label: t('insp.noImage') }, ...Object.values(assets).map((a) => ({ value: a.id, label: a.name }))]}
        onChange={(v) => updateNodes(ids, { assetId: v || null } as Partial<DesignNode>)}
      />
      <SelectField
        title={t('insp.imageFit')}
        value={common(nodes, (n) => n.fit)}
        options={[
          { value: 'cover', label: 'Cover' },
          { value: 'contain', label: 'Contain' },
          { value: 'fill', label: 'Stretch' },
        ]}
        onChange={(v) => updateNodes(ids, { fit: v } as Partial<DesignNode>)}
      />
      <TextField placeholder={t('insp.alt')} value={nodes.length === 1 ? nodes[0]!.alt : ''} onChange={(v) => updateNodes(ids, { alt: v } as Partial<DesignNode>)} />
    </Section>
  );
}

export function IconSection({ nodes }: { nodes: IconNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const current = common(nodes, (n) => n.icon);
  return (
    <Section title={t('insp.icon')}>
      <div className="grid grid-cols-8 gap-0.5">
        {ICON_NAMES.map((name) => {
          const Icon = DESIGN_ICONS[name];
          return (
            <IconButton key={name} label={name} active={current === name} onClick={() => updateNodes(ids, { icon: name, name } as Partial<DesignNode>)}>
              <Icon size={14} />
            </IconButton>
          );
        })}
      </div>
      <NumberField
        label="≡"
        title={t('insp.strokeWidth')}
        min={0.25}
        max={8}
        step={0.25}
        value={common(nodes, (n) => n.strokeWidth)}
        onChange={(v) => updateNodes(ids, { strokeWidth: v } as Partial<DesignNode>, 'iconStroke')}
      />
    </Section>
  );
}

export function LineSection({ nodes }: { nodes: LineNode[] }) {
  const t = useT();
  return (
    <Section title={t('insp.line')}>
      <Checkbox
        label={t('insp.flip')}
        checked={nodes.every((n) => n.flip)}
        onChange={(v) => updateNodes(nodes.map((n) => n.id), { flip: v } as Partial<DesignNode>)}
      />
    </Section>
  );
}
