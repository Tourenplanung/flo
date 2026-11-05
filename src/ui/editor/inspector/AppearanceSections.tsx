import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import { updateNodes } from '@/editor/actions';
import { useT } from '@/i18n';
import type { DesignNode, Effect, Paint, Stroke } from '@/core/schema';
import { solid } from '@/core/factory';
import { ColorField, IconButton, MIXED, NumberField, Section, SelectField } from '@/ui/common/controls';
import { common } from './helpers';
import { TokenPicker } from './SystemSections';

/* ---------------------------------------------------------------- Layer */

export function LayerSection({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const hasRadius = nodes.every((n) => ['frame', 'rect', 'image', 'group'].includes(n.type));
  const radius = common(nodes, (n) => n.radius);
  const uniform = radius !== MIXED && radius.every((r) => r === radius[0]);
  const opacity = common(nodes, (n) => Math.round(n.opacity * 100));
  return (
    <Section title={t('insp.layer')}>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="%"
          title={t('insp.opacity')}
          testId="insp-opacity"
          min={0}
          max={100}
          precision={0}
          value={opacity}
          onChange={(v) => updateNodes(ids, { opacity: v / 100 }, 'opacity')}
        />
        {hasRadius && (
          <NumberField
            label="◜"
            title={t('insp.radius')}
            testId="insp-radius"
            min={0}
            value={uniform ? radius[0]! : MIXED}
            mixedLabel={t('insp.mixed')}
            onChange={(v) => updateNodes(ids, { radius: [v, v, v, v] }, 'radius')}
          />
        )}
      </div>
      {hasRadius && <TokenPicker nodes={nodes} binding="radius" />}
      {hasRadius && (
        <div className="grid grid-cols-4 gap-1.5">
          {['◤', '◥', '◢', '◣'].map((l, i) => (
            <NumberField
              key={i}
              label={l}
              min={0}
              precision={0}
              value={radius === MIXED ? MIXED : radius[i]!}
              onChange={(v) =>
                updateNodes(
                  ids,
                  (n) => {
                    const r = [...n.radius] as DesignNode['radius'];
                    r[i] = v;
                    return { radius: r };
                  },
                  `radius${i}`,
                )
              }
            />
          ))}
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Fill */

export function FillSection({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const fills = common(nodes, (n) => n.fills);
  const setFills = (fn: (fills: Paint[]) => Paint[], key?: string) => updateNodes(ids, (n) => ({ fills: fn(n.fills) }), key);
  const title = nodes.every((n) => n.type === 'text' || n.type === 'icon') ? `${t('insp.fill.title')} · ${t('insp.text')}` : t('insp.fill.title');
  return (
    <Section
      title={title}
      action={
        <IconButton label={t('insp.add')} testId="fill-add" onClick={() => setFills((f) => [...f, solid(f.length ? '#000000' : '#D9D9DE', f.length ? 0.2 : 1)])}>
          <Plus size={14} />
        </IconButton>
      }
    >
      <TokenPicker nodes={nodes} binding="fill" />
      {fills === MIXED ? (
        <p className="text-[11px] text-fg-subtle">{t('insp.mixed')}</p>
      ) : (
        [...fills.keys()].reverse().map((i) => {
          const p = fills[i]!;
          const update = (np: Paint, key?: string) => setFills((f) => f.map((x, j) => (j === i ? np : x)), key);
          return (
            <div key={i} className="flex flex-col gap-1.5" data-testid={`fill-${i}`}>
              <div className="flex items-center gap-1">
                {p.type === 'solid' ? (
                  <ColorField
                    testId={`fill-color-${i}`}
                    color={p.color}
                    opacity={p.opacity}
                    onChange={(color, opacity) => update({ ...p, color, opacity: opacity ?? p.opacity }, `fill${i}`)}
                  />
                ) : (
                  <div
                    className="h-7 flex-1 rounded-md border border-line"
                    style={{ background: `linear-gradient(90deg, ${p.stops.map((s) => `${s.color} ${s.position * 100}%`).join(', ')})` }}
                  />
                )}
                <IconButton label={p.visible ? t('left.hide') : t('left.show')} onClick={() => update({ ...p, visible: !p.visible })}>
                  {p.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </IconButton>
                <IconButton label={t('insp.remove')} onClick={() => setFills((f) => f.filter((_, j) => j !== i))}>
                  <Minus size={14} />
                </IconButton>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <SelectField
                  value={p.type}
                  options={[
                    { value: 'solid', label: t('insp.solid') },
                    { value: 'linear-gradient', label: t('insp.gradient') },
                  ]}
                  onChange={(type) => {
                    if (type === p.type) return;
                    if (type === 'solid') {
                      update({ type: 'solid', color: p.type === 'linear-gradient' ? p.stops[0]!.color : '#000000', opacity: p.opacity, visible: p.visible });
                    } else {
                      const base = p.type === 'solid' ? p.color : '#000000';
                      update({
                        type: 'linear-gradient',
                        angle: 180,
                        opacity: p.opacity,
                        visible: p.visible,
                        stops: [
                          { color: base, position: 0 },
                          { color: '#FFFFFF', position: 1 },
                        ],
                      });
                    }
                  }}
                />
                {p.type === 'linear-gradient' && (
                  <NumberField label="∠" title="Angle" value={p.angle} suffix="°" onChange={(v) => update({ ...p, angle: v }, `angle${i}`)} />
                )}
              </div>
              {p.type === 'linear-gradient' &&
                p.stops.map((s, si) => (
                  <div key={si} className="flex gap-1.5">
                    <ColorField
                      color={s.color}
                      onChange={(color) => update({ ...p, stops: p.stops.map((x, k) => (k === si ? { ...x, color } : x)) }, `stop${i}-${si}`)}
                    />
                    <div className="w-20 shrink-0">
                      <NumberField
                        label="%"
                        min={0}
                        max={100}
                        precision={0}
                        value={Math.round(s.position * 100)}
                        onChange={(v) => update({ ...p, stops: p.stops.map((x, k) => (k === si ? { ...x, position: v / 100 } : x)) }, `stoppos${i}-${si}`)}
                      />
                    </div>
                  </div>
                ))}
            </div>
          );
        })
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Stroke */

const DEFAULT_STROKE: Stroke = { color: '#1B1C22', opacity: 1, width: 1, visible: true };

export function StrokeSection({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const stroke = common(nodes, (n) => n.stroke);
  const isLine = nodes.every((n) => n.type === 'line');
  return (
    <Section
      title={isLine ? t('insp.line') : t('insp.stroke')}
      action={
        stroke === null ? (
          <IconButton label={t('insp.add')} testId="stroke-add" onClick={() => updateNodes(ids, { stroke: DEFAULT_STROKE })}>
            <Plus size={14} />
          </IconButton>
        ) : null
      }
    >
      {stroke && <TokenPicker nodes={nodes} binding="stroke" />}
      {stroke === MIXED && <p className="text-[11px] text-fg-subtle">{t('insp.mixed')}</p>}
      {stroke && stroke !== MIXED && (
        <div className="flex items-center gap-1">
          <ColorField
            testId="stroke-color"
            color={stroke.color}
            opacity={stroke.opacity}
            onChange={(color, opacity) => updateNodes(ids, (n) => ({ stroke: { ...(n.stroke ?? DEFAULT_STROKE), color, opacity: opacity ?? 1 } }), 'stroke')}
          />
          <div className="w-16 shrink-0">
            <NumberField
              label="≡"
              title={t('insp.strokeWidth')}
              testId="stroke-width"
              min={0}
              value={stroke.width}
              onChange={(v) => updateNodes(ids, (n) => ({ stroke: { ...(n.stroke ?? DEFAULT_STROKE), width: v } }), 'strokew')}
            />
          </div>
          {!isLine && (
            <IconButton label={t('insp.remove')} onClick={() => updateNodes(ids, { stroke: null })}>
              <Minus size={14} />
            </IconButton>
          )}
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Effects */

const DEFAULT_EFFECT: Effect = { type: 'drop-shadow', x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.18, visible: true };

export function EffectsSection({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const ids = nodes.map((n) => n.id);
  const effects = common(nodes, (n) => n.effects);
  const setEffects = (fn: (e: Effect[]) => Effect[], key?: string) => updateNodes(ids, (n) => ({ effects: fn(n.effects) }), key);
  return (
    <Section
      title={t('insp.effects')}
      action={
        <IconButton label={t('insp.add')} testId="effect-add" onClick={() => setEffects((e) => [...e, { ...DEFAULT_EFFECT }])}>
          <Plus size={14} />
        </IconButton>
      }
    >
      <TokenPicker nodes={nodes} binding="shadow" />
      {effects === MIXED && <p className="text-[11px] text-fg-subtle">{t('insp.mixed')}</p>}
      {effects !== MIXED &&
        effects.map((fx, i) => {
          const update = (patch: Partial<Effect>, key?: string) => setEffects((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)), key);
          return (
            <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line p-1.5">
              <div className="flex items-center gap-1">
                <SelectField
                  value={fx.type}
                  options={(['drop-shadow', 'inner-shadow', 'layer-blur'] as const).map((v) => ({ value: v, label: t(`effect.${v}`) }))}
                  onChange={(type) => update({ type })}
                />
                <IconButton label={fx.visible ? t('left.hide') : t('left.show')} onClick={() => update({ visible: !fx.visible })}>
                  {fx.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </IconButton>
                <IconButton label={t('insp.remove')} onClick={() => setEffects((all) => all.filter((_, j) => j !== i))}>
                  <Minus size={14} />
                </IconButton>
              </div>
              {fx.type === 'layer-blur' ? (
                <NumberField label="◌" title="Blur" min={0} value={fx.blur} onChange={(v) => update({ blur: v }, `fxb${i}`)} />
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1">
                    <NumberField label="X" value={fx.x} onChange={(v) => update({ x: v }, `fxx${i}`)} />
                    <NumberField label="Y" value={fx.y} onChange={(v) => update({ y: v }, `fxy${i}`)} />
                    <NumberField label="◌" title="Blur" min={0} value={fx.blur} onChange={(v) => update({ blur: v }, `fxb${i}`)} />
                    <NumberField label="±" title="Spread" value={fx.spread} onChange={(v) => update({ spread: v }, `fxs${i}`)} />
                  </div>
                  <ColorField color={fx.color} opacity={fx.opacity} onChange={(color, opacity) => update({ color, opacity: opacity ?? fx.opacity }, `fxc${i}`)} />
                </>
              )}
            </div>
          );
        })}
    </Section>
  );
}
