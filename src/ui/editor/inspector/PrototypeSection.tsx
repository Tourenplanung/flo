import { Minus, Play, Plus } from 'lucide-react';
import { createId } from '@/core/ids';
import { isVirtualId } from '@/core/instance';
import { isScreen, screensOf } from '@/core/prototype';
import type { DesignNode, Interaction, InteractionAction, Transition } from '@/core/schema';
import { collectSubtree, getNodePath } from '@/core/tree';
import { useT, type MessageKey } from '@/i18n';
import { dispatch, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { Checkbox, IconButton, NumberField, Section, SelectField } from '@/ui/common/controls';

const ACTIONS: InteractionAction['type'][] = ['navigate', 'back', 'open-overlay', 'close-overlay', 'toggle-visibility'];
const TRANSITIONS: Transition['type'][] = ['instant', 'dissolve', 'slide-left', 'slide-right', 'slide-up', 'slide-down'];
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;

function save(id: string, interactions: Interaction[]) {
  const res = dispatch([{ type: 'setInteractions', id, interactions }], { label: 'Edit prototype', mergeKey: `proto:${id}` });
  if (!res.ok) useEditorStore.getState().showToast(res.error, 'error');
}

function defaultAction(type: InteractionAction['type'], firstScreen: string | undefined, firstLayer: string | undefined): InteractionAction | null {
  switch (type) {
    case 'navigate':
      return firstScreen ? { type, destinationId: firstScreen, transition: { type: 'dissolve', durationMs: 250 } } : null;
    case 'open-overlay':
      return firstScreen ? { type, destinationId: firstScreen, position: 'center', closeOnOutsideClick: true, dimBackground: true } : null;
    case 'toggle-visibility':
      return firstLayer ? { type, targetId: firstLayer } : null;
    case 'back':
    case 'close-overlay':
      return { type };
  }
}

export function PrototypeSection({ node }: { node: DesignNode }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const raw = project.nodes[node.id];
  if (!raw || isVirtualId(node.id)) return null;
  const screen = getNodePath(project, raw.id)[0];
  const screens = screensOf(project).filter((s) => s.id !== screen?.id);
  // Toggle targets: other layers of the same screen.
  const layers = screen ? collectSubtree(project, screen.id).filter((n) => n.id !== screen.id && n.id !== raw.id) : [];
  const list = raw.interactions;
  const update = (i: number, next: Interaction) => save(raw.id, list.map((x, j) => (j === i ? next : x)));
  const screenOptions = screens.map((s) => ({ value: s.id, label: s.name }));
  const isTop = isScreen(project, raw.id);

  return (
    <Section
      title={t('proto.title')}
      action={
        <IconButton
          label={t('proto.add')}
          testId="proto-add"
          onClick={() => {
            const action = defaultAction(screens[0] ? 'navigate' : layers[0] ? 'toggle-visibility' : 'back', screens[0]?.id, layers[0]?.id)!;
            save(raw.id, [...list, { id: createId(), trigger: 'click', action }]);
          }}
        >
          <Plus size={14} />
        </IconButton>
      }
    >
      {isTop && (
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            label={t('proto.start')}
            testId="proto-start"
            checked={project.prototype.startFrameId === raw.id}
            onChange={(v) => dispatch([{ type: 'setPrototypeStart', frameId: v ? raw.id : null }], { label: 'Prototype start' })}
          />
          <IconButton label={t('proto.play')} onClick={() => useEditorStore.getState().openPlayer(raw.id)}>
            <Play size={13} />
          </IconButton>
        </div>
      )}
      {list.length === 0 && <p className="text-[11px] text-fg-subtle">{t('proto.none')}</p>}
      {list.map((it, i) => {
        const a = it.action;
        return (
          <div key={it.id} className="flex flex-col gap-1.5 rounded-md border border-line p-1.5" data-testid="proto-interaction">
            <div className="flex items-center gap-1">
              <SelectField
                testId="proto-trigger"
                value={it.trigger}
                options={(['click', 'hover'] as const).map((v) => ({ value: v, label: t(`proto.trigger.${v}`) }))}
                onChange={(trigger) => update(i, { ...it, trigger })}
              />
              <IconButton label={t('insp.remove')} onClick={() => save(raw.id, list.filter((_, j) => j !== i))}>
                <Minus size={14} />
              </IconButton>
            </div>
            <SelectField
              testId="proto-action"
              value={a.type}
              options={ACTIONS.map((v) => ({ value: v, label: t(`proto.action.${v}` as MessageKey) }))}
              onChange={(type) => {
                const next = defaultAction(type, screens[0]?.id, layers[0]?.id);
                if (next) update(i, { ...it, action: next });
              }}
            />
            {(a.type === 'navigate' || a.type === 'open-overlay') && (
              <SelectField
                testId="proto-destination"
                title={t('proto.destination')}
                value={a.destinationId}
                options={screenOptions.length ? screenOptions : [{ value: a.destinationId, label: t('proto.choose') }]}
                onChange={(destinationId) => update(i, { ...it, action: { ...a, destinationId } })}
              />
            )}
            {a.type === 'navigate' && (
              <div className="grid grid-cols-[1fr_72px] gap-1">
                <SelectField
                  testId="proto-transition"
                  value={a.transition.type}
                  options={TRANSITIONS.map((v) => ({ value: v, label: t(`proto.t.${v}` as MessageKey) }))}
                  onChange={(type) => update(i, { ...it, action: { ...a, transition: { ...a.transition, type } } })}
                />
                <NumberField
                  label="ms"
                  title={t('proto.duration')}
                  value={a.transition.durationMs}
                  min={0}
                  max={5000}
                  precision={0}
                  onChange={(durationMs, final) => final && update(i, { ...it, action: { ...a, transition: { ...a.transition, durationMs: Math.round(durationMs) } } })}
                />
              </div>
            )}
            {a.type === 'open-overlay' && (
              <>
                <SelectField
                  title={t('proto.position')}
                  value={a.position}
                  options={POSITIONS.map((v) => ({ value: v, label: t(`proto.p.${v}`) }))}
                  onChange={(position) => update(i, { ...it, action: { ...a, position } })}
                />
                <Checkbox label={t('proto.closeOutside')} checked={a.closeOnOutsideClick} onChange={(closeOnOutsideClick) => update(i, { ...it, action: { ...a, closeOnOutsideClick } })} />
                <Checkbox label={t('proto.dim')} checked={a.dimBackground} onChange={(dimBackground) => update(i, { ...it, action: { ...a, dimBackground } })} />
              </>
            )}
            {a.type === 'toggle-visibility' && (
              <SelectField
                testId="proto-target"
                title={t('proto.target')}
                value={a.targetId}
                options={layers.map((n) => ({ value: n.id, label: `${n.name}${n.visible ? '' : ' (hidden)'}` }))}
                onChange={(targetId) => update(i, { ...it, action: { ...a, targetId } })}
              />
            )}
          </div>
        );
      })}
    </Section>
  );
}
