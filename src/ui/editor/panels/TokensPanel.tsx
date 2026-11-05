import { Plus, Trash2, Wand2 } from 'lucide-react';
import { createId } from '@/core/ids';
import type { DocOp } from '@/core/ops';
import type { ColorToken, NumberToken, ShadowToken, TextToken, TokenKind } from '@/core/schema';
import { FONTS } from '@/core/style';
import { effectiveNode } from '@/editor/effective';
import { useT, type MessageKey } from '@/i18n';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { ColorField, IconButton, NumberField, SelectField } from '@/ui/common/controls';

function run(ops: DocOp[], label: string, mergeKey?: string) {
  const res = dispatch(ops, { label, mergeKey });
  if (!res.ok) useEditorStore.getState().showToast(res.error, 'error');
}

function upsert(kind: TokenKind, value: ColorToken | TextToken | NumberToken | ShadowToken, mergeKey?: string) {
  run([{ type: 'upsertToken', token: { kind, value } as never }], 'Edit token', mergeKey);
}

function uniqueName(kind: TokenKind, base: string) {
  const list = (getProject()?.tokens[kind] ?? []) as { name: string }[];
  let name = base;
  let i = 2;
  while (list.some((x) => x.name === name)) name = `${base} ${i++}`;
  return name;
}

function NameInput({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <input
      key={value}
      defaultValue={value}
      data-testid={testId}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onChange(v);
        else e.target.value = value;
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-6 w-full min-w-0 rounded bg-transparent px-1 text-[11px] text-fg outline-none hover:bg-field focus:bg-field"
    />
  );
}

function DeleteBtn({ kind, id, name }: { kind: TokenKind; id: string; name: string }) {
  const t = useT();
  return (
    <button
      aria-label={t('tok.delete')}
      title={t('tok.delete')}
      className="invisible shrink-0 text-fg-subtle hover:text-danger group-hover:visible"
      onClick={() => window.confirm(t('tok.deleteConfirm', { name })) && run([{ type: 'deleteToken', kind, id }], 'Delete token')}
    >
      <Trash2 size={11} />
    </button>
  );
}

function Group({ title, onAdd, onFromSelection, children, testId }: { title: string; onAdd: () => void; onFromSelection?: () => void; children: React.ReactNode; testId: string }) {
  const t = useT();
  return (
    <section className="border-b border-line px-2 py-2" data-testid={testId}>
      <div className="mb-1 flex items-center justify-between pl-1">
        <h4 className="text-[11px] font-semibold">{title}</h4>
        <div className="flex">
          {onFromSelection && (
            <IconButton label={t('tok.fromSel')} onClick={onFromSelection} testId={`${testId}-from-selection`}>
              <Wand2 size={12} />
            </IconButton>
          )}
          <IconButton label={t('tok.add')} onClick={onAdd} testId={`${testId}-add`}>
            <Plus size={13} />
          </IconButton>
        </div>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function selectedEffective() {
  const project = getProject();
  const s = useEditorStore.getState();
  return project ? s.selection.map((id) => effectiveNode(project, id, [])).filter(Boolean) : [];
}

export function TokensPanel() {
  const t = useT();
  const tokens = useDocStore((s) => s.project?.tokens);
  if (!tokens) return null;
  const empty = <p className="px-1 text-[10.5px] text-fg-subtle">{t('tok.empty')}</p>;

  return (
    <div data-testid="tokens-panel">
      <p className="border-b border-line px-3 py-2 text-[10.5px] leading-4 text-fg-subtle">{t('tok.help')}</p>
      <Group
        title={t('tok.colors')}
        testId="tok-colors"
        onAdd={() => upsert('colors', { id: createId(), name: uniqueName('colors', 'color'), value: '#6D5BFF', opacity: 1 })}
        onFromSelection={() => {
          for (const n of selectedEffective()) {
            const f = [...n!.fills].reverse().find((x) => x.type === 'solid' && x.visible);
            if (f && f.type === 'solid') upsert('colors', { id: createId(), name: uniqueName('colors', n!.name.toLowerCase().replace(/[^a-z0-9 _./-]/g, '') || 'color'), value: f.color, opacity: f.opacity });
          }
        }}
      >
        {tokens.colors.length === 0 && empty}
        {tokens.colors.map((c) => (
          <div key={c.id} className="group flex items-center gap-1" data-testid="token-color">
            <div className="min-w-0 flex-1">
              <NameInput value={c.name} onChange={(name) => upsert('colors', { ...c, name })} />
            </div>
            <div className="flex w-[132px] shrink-0">
              <ColorField color={c.value} onChange={(value, _o, final) => upsert('colors', { ...c, value }, final ? undefined : `tok:${c.id}`)} />
            </div>
            <DeleteBtn kind="colors" id={c.id} name={c.name} />
          </div>
        ))}
      </Group>

      <Group
        title={t('tok.text')}
        testId="tok-text"
        onAdd={() => upsert('text', { id: createId(), name: uniqueName('text', 'Body'), fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: { unit: 'percent', value: 150 }, letterSpacing: 0 })}
        onFromSelection={() => {
          for (const n of selectedEffective()) {
            if (n!.type !== 'text') continue;
            upsert('text', { id: createId(), name: uniqueName('text', n!.role.startsWith('h') ? n!.role.toUpperCase() : 'Text'), fontFamily: n!.fontFamily, fontSize: n!.fontSize, fontWeight: n!.fontWeight, lineHeight: n!.lineHeight, letterSpacing: n!.letterSpacing });
          }
        }}
      >
        {tokens.text.length === 0 && empty}
        {tokens.text.map((x) => (
          <div key={x.id} className="group flex flex-col gap-1 rounded border border-line p-1">
            <div className="flex items-center gap-1">
              <NameInput value={x.name} onChange={(name) => upsert('text', { ...x, name })} />
              <DeleteBtn kind="text" id={x.id} name={x.name} />
            </div>
            <div className="truncate px-1 text-fg" style={{ fontFamily: FONTS.find((f) => f.family === x.fontFamily)?.stack, fontSize: Math.min(x.fontSize, 22), fontWeight: x.fontWeight }}>
              Aa {x.fontFamily}
            </div>
            <div className="grid grid-cols-[1fr_56px_64px] gap-1">
              <SelectField value={x.fontFamily} options={FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(fontFamily) => upsert('text', { ...x, fontFamily })} />
              <NumberField label="px" value={x.fontSize} min={1} onChange={(fontSize, final) => upsert('text', { ...x, fontSize }, final ? undefined : `tok:${x.id}:s`)} />
              <SelectField value={x.fontWeight} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} onChange={(fontWeight) => upsert('text', { ...x, fontWeight })} />
            </div>
          </div>
        ))}
      </Group>

      {(['spacing', 'radius'] as const).map((kind) => (
        <Group
          key={kind}
          title={t(`tok.${kind}` as MessageKey)}
          testId={`tok-${kind}`}
          onAdd={() => upsert(kind, { id: createId(), name: uniqueName(kind, kind === 'spacing' ? 'space' : 'radius'), value: kind === 'spacing' ? 16 : 8 })}
        >
          {tokens[kind].length === 0 && empty}
          {tokens[kind].map((x) => (
            <div key={x.id} className="group flex items-center gap-1">
              <NameInput value={x.name} onChange={(name) => upsert(kind, { ...x, name })} />
              <div className="w-20 shrink-0">
                <NumberField label="px" value={x.value} min={0} onChange={(value, final) => upsert(kind, { ...x, value }, final ? undefined : `tok:${x.id}`)} />
              </div>
              <DeleteBtn kind={kind} id={x.id} name={x.name} />
            </div>
          ))}
        </Group>
      ))}

      <Group
        title={t('tok.shadows')}
        testId="tok-shadows"
        onAdd={() =>
          upsert('shadows', { id: createId(), name: uniqueName('shadows', 'shadow'), effect: { type: 'drop-shadow', x: 0, y: 8, blur: 24, spread: -8, color: '#101018', opacity: 0.18, visible: true } })
        }
      >
        {tokens.shadows.length === 0 && empty}
        {tokens.shadows.map((x) => (
          <div key={x.id} className="group flex items-center gap-1">
            <div className="h-5 w-5 shrink-0 rounded bg-white" style={{ boxShadow: `${x.effect.x / 2}px ${x.effect.y / 2}px ${x.effect.blur / 2}px rgba(0,0,0,${x.effect.opacity * 2})` }} />
            <NameInput value={x.name} onChange={(name) => upsert('shadows', { ...x, name })} />
            <div className="w-16 shrink-0">
              <NumberField label="◌" value={x.effect.blur} min={0} onChange={(blur, final) => upsert('shadows', { ...x, effect: { ...x.effect, blur } }, final ? undefined : `tok:${x.id}`)} />
            </div>
            <DeleteBtn kind="shadows" id={x.id} name={x.name} />
          </div>
        ))}
      </Group>
    </div>
  );
}
