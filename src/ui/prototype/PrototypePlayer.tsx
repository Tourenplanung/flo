import { ArrowLeft, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { expandInstance } from '@/core/instance';
import { applyAction, interactionsFor, restart, revertHover, screensOf, startState, type ActionContext, type PlayerState } from '@/core/prototype';
import { resolveNode } from '@/core/resolve';
import type { DesignNode, Project } from '@/core/schema';
import { nodeStyle } from '@/core/style';
import { useT } from '@/i18n';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { NodeContent } from '@/ui/editor/canvas/NodeView';

type Lookup = (id: string) => DesignNode | undefined;

interface Handlers {
  state: PlayerState;
  onClick: (node: DesignNode, e: React.MouseEvent) => void;
  onHover: (node: DesignNode, enter: boolean) => void;
}

/** Renders a layer for the player: resolved styles, visibility overrides, interactions. */
function PlayerNode({ node: raw, lookup, parent, h, root }: { node: DesignNode; lookup: Lookup; parent: DesignNode | null; h: Handlers; root?: boolean }) {
  const project = useDocStore((s) => s.project)!;
  if (raw.type === 'instance') {
    const exp = expandInstance(project, raw);
    if (!exp) return null;
    const local: Lookup = (id) => exp.nodes[id] ?? lookup(id);
    return <PlayerNode node={exp.root} lookup={local} parent={parent} h={h} root={root} />;
  }
  const resolved = resolveNode(raw, project.tokens, []);
  const visible = h.state.visibility[raw.id] ?? resolved.visible;
  const node = visible === resolved.visible ? resolved : { ...resolved, visible };
  const style = nodeStyle(node, { parent }) as CSSProperties;
  if (root) Object.assign(style, { position: 'relative', left: 0, top: 0, right: 'auto', bottom: 'auto' });
  const clicks = interactionsFor(raw.interactions, 'click');
  const hovers = interactionsFor(raw.interactions, 'hover');
  if (clicks.length) style.cursor = 'pointer';
  return (
    <div
      data-proto-id={raw.id}
      data-base-visible={resolved.visible ? '1' : '0'}
      data-hotspot={clicks.length || hovers.length ? '' : undefined}
      data-name={raw.name}
      style={style}
      onClick={clicks.length ? (e) => h.onClick(raw, e) : undefined}
      onPointerEnter={hovers.length ? () => h.onHover(raw, true) : undefined}
      onPointerLeave={hovers.length ? () => h.onHover(raw, false) : undefined}
    >
      <NodeContent node={node} editing={false} />
      {node.childIds.map((c) => {
        const child = lookup(c);
        return child ? <PlayerNode key={c} node={child} lookup={lookup} parent={node} h={h} /> : null;
      })}
    </div>
  );
}

/** Scales a screen to fit the available area (never upscales). */
function useFitScale(width: number, height: number, ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, (el.clientWidth - 48) / Math.max(width, 1), (el.clientHeight - 48) / Math.max(height, 1)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, ref]);
  return scale;
}

function animationFor(state: PlayerState): string | undefined {
  const tr = state.transition;
  if (!tr || tr.type === 'instant' || tr.durationMs === 0 || state.navCount === 0) return undefined;
  const reverse: Record<string, string> = { 'slide-left': 'slide-right', 'slide-right': 'slide-left', 'slide-up': 'slide-down', 'slide-down': 'slide-up' };
  const type = state.direction === 'back' ? (reverse[tr.type] ?? tr.type) : tr.type;
  return `flo-${type} ${tr.durationMs}ms cubic-bezier(0.2, 0.7, 0.2, 1) both`;
}

const OVERLAY_ALIGN: Record<string, CSSProperties> = {
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { alignItems: 'flex-start', justifyContent: 'center' },
  bottom: { alignItems: 'flex-end', justifyContent: 'center' },
  left: { alignItems: 'center', justifyContent: 'flex-start' },
  right: { alignItems: 'center', justifyContent: 'flex-end' },
};

export function PrototypePlayer() {
  const player = useEditorStore((s) => s.player);
  const project = useDocStore((s) => s.project);
  if (!player || !project) return null;
  return <Player project={project} startId={player.startId} />;
}

function Player({ project, startId }: { project: Project; startId: string | null }) {
  const t = useT();
  const [state, setState] = useState<PlayerState | null>(() => startState(project, startId));
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(id);
  }, [flash]);
  const stageRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => useEditorStore.getState().closePlayer(), []);
  const screens = useMemo(() => screensOf(project), [project]);

  const ctxFor = useCallback(
    (sourceId: string): ActionContext => ({
      project,
      sourceId,
      exists: (id) => !!stageRef.current?.querySelector(`[data-proto-id="${CSS.escape(id)}"]`),
      baseVisible: (id) => stageRef.current?.querySelector(`[data-proto-id="${CSS.escape(id)}"]`)?.getAttribute('data-base-visible') !== '0',
    }),
    [project],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setState((s) => (s && s.overlays.length ? { ...s, overlays: s.overlays.slice(0, -1) } : (close(), s)));
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        setState((s) => (s ? applyAction(s, { type: 'back' }, ctxFor('')) : s));
      } else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        setState((s) => (s ? restart(s, project) : s));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, ctxFor, project]);

  const lookup: Lookup = useCallback((id) => project.nodes[id], [project]);
  const h: Handlers | null = state && {
    state,
    onClick: (node, e) => {
      e.stopPropagation();
      setState((s) => interactionsFor(node.interactions, 'click').reduce((acc, i) => (acc ? applyAction(acc, i.action, ctxFor(node.id)) : acc), s));
    },
    onHover: (node, enter) =>
      setState((s) =>
        interactionsFor(node.interactions, 'hover').reduce((acc, i) => (acc ? (enter ? applyAction(acc, i.action, ctxFor(node.id)) : revertHover(acc, i.action, ctxFor(node.id))) : acc), s),
      ),
  };

  const screen = state ? project.nodes[state.screenId] : undefined;
  // Screens may hug their content: use the rendered height, not the stored one.
  const [measuredH, setMeasuredH] = useState<number | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = viewRef.current?.firstElementChild as HTMLElement | null;
    setMeasuredH(el ? el.offsetHeight : null);
  }, [state?.screenId, state?.visibility, project]);
  const screenH = measuredH ?? screen?.height ?? 1;
  const scale = useFitScale(screen?.width ?? 1, screenH, stageRef);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b0c10]" data-testid="prototype-player" role="dialog" aria-label="Prototype">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[12px]">
        <button title={t('proto.back')} aria-label={t('proto.back')} data-testid="proto-back" onClick={() => setState((s) => (s ? applyAction(s, { type: 'back' }, ctxFor('')) : s))} className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-field-hover hover:text-fg">
          <ArrowLeft size={15} />
        </button>
        <button title={t('proto.restart')} aria-label={t('proto.restart')} onClick={() => setState((s) => (s ? restart(s, project) : s))} className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-field-hover hover:text-fg">
          <RotateCcw size={14} />
        </button>
        <select
          aria-label={t('proto.screen')}
          data-testid="proto-screen"
          value={state?.screenId ?? ''}
          onChange={(e) => setState(startState(project, e.target.value))}
          className="h-7 max-w-64 rounded-md bg-field px-2 text-[12px] text-fg outline-none"
        >
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="flex-1 truncate text-center text-[11px] text-fg-subtle">{t('proto.hint')}</span>
        <button title={t('proto.close')} aria-label={t('proto.close')} data-testid="proto-close" onClick={close} className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-field-hover hover:text-fg">
          <X size={16} />
        </button>
      </div>
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onClick={() => setFlash(true)}
      >
        {!state || !screen || !h ? (
          <p className="text-[13px] text-fg-muted">{t('proto.noScreens')}</p>
        ) : (
          <div style={{ width: screen.width * scale, height: screenH * scale, position: 'relative', overflow: 'hidden' }}>
            <div key={`${state.screenId}-${state.navCount}`} style={{ position: 'absolute', inset: 0, animation: animationFor(state) }}>
              <div
                ref={viewRef}
                data-testid="proto-screen-view"
                data-screen={screen.name}
                className={flash ? 'flo-hotspot-flash' : undefined}
                style={{ width: screen.width, transform: `scale(${scale})`, transformOrigin: '0 0' }}
              >
                <PlayerNode node={screen} lookup={lookup} parent={null} h={h} root />
              </div>
            </div>
            {state.overlays.map((o, i) => {
              const frame = project.nodes[o.frameId];
              if (!frame) return null;
              return (
                <div
                  key={`${o.frameId}-${i}`}
                  data-testid="proto-overlay"
                  className="absolute inset-0 flex"
                  style={{ ...OVERLAY_ALIGN[o.position], background: o.dimBackground ? 'rgba(0,0,0,0.45)' : 'transparent', animation: 'flo-dissolve 160ms ease-out both' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (o.closeOnOutsideClick) setState((s) => (s ? { ...s, overlays: s.overlays.filter((x) => x !== o) } : s));
                  }}
                >
                  <div style={{ width: frame.width * scale, height: frame.height * scale }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ width: frame.width, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                      <PlayerNode node={frame} lookup={lookup} parent={null} h={h} root />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
