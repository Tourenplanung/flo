/**
 * Prototype player state machine (framework-independent).
 * Screens are top-level frames; interactions reference layers by stable id.
 */
import { VSEP } from './instance';
import type { Interaction, InteractionAction, Project, Transition } from './schema';

export interface OverlayState {
  frameId: string;
  position: 'center' | 'top' | 'bottom' | 'left' | 'right';
  closeOnOutsideClick: boolean;
  dimBackground: boolean;
}

export interface PlayerState {
  screenId: string;
  history: string[];
  overlays: OverlayState[];
  /** Visibility overrides set by toggle-visibility actions (layer id → visible). */
  visibility: Record<string, boolean>;
  /** Transition of the last navigation (for animation) and a counter to re-key it. */
  transition: Transition | null;
  direction: 'forward' | 'back';
  navCount: number;
}

/** Top-level frames of the project, page by page. */
export function screensOf(project: Project): { id: string; name: string; pageId: string }[] {
  const out: { id: string; name: string; pageId: string }[] = [];
  for (const p of project.pages) {
    for (const id of p.childIds) {
      const n = project.nodes[id];
      if (n?.type === 'frame' && n.visible) out.push({ id, name: n.name, pageId: p.id });
    }
  }
  return out;
}

export function isScreen(project: Project, id: string): boolean {
  const n = project.nodes[id];
  return !!n && n.type === 'frame' && project.pages.some((p) => p.id === n.parentId);
}

/** Chooses where the prototype starts: an explicit screen, the project start screen, or the first screen. */
export function startState(project: Project, preferredId?: string | null): PlayerState | null {
  const candidates = [preferredId, project.prototype.startFrameId].filter((x): x is string => !!x && isScreen(project, x));
  const screenId = candidates[0] ?? screensOf(project)[0]?.id;
  if (!screenId) return null;
  return { screenId, history: [], overlays: [], visibility: {}, transition: null, direction: 'forward', navCount: 0 };
}

/**
 * A layer inside an instance is addressed as `instanceId__sourceId`; an interaction defined in
 * the main component that targets `targetId` must address the copy inside the same instance.
 */
export function resolveTarget(sourceId: string, targetId: string, exists: (id: string) => boolean): string {
  const cut = sourceId.lastIndexOf(VSEP);
  if (cut > 0) {
    const scoped = `${sourceId.slice(0, cut)}${VSEP}${targetId}`;
    if (exists(scoped)) return scoped;
  }
  return targetId;
}

export interface ActionContext {
  project: Project;
  sourceId: string;
  /** Whether a (possibly virtual) layer is currently rendered. */
  exists: (id: string) => boolean;
  /** Base visibility of a rendered layer. */
  baseVisible: (id: string) => boolean;
}

function isVisible(state: PlayerState, id: string, ctx: ActionContext) {
  return state.visibility[id] ?? ctx.baseVisible(id);
}

export function applyAction(state: PlayerState, action: InteractionAction, ctx: ActionContext): PlayerState {
  switch (action.type) {
    case 'navigate':
      if (!isScreen(ctx.project, action.destinationId) || action.destinationId === state.screenId) return state;
      return {
        screenId: action.destinationId,
        history: [...state.history, state.screenId],
        overlays: [],
        visibility: {},
        transition: action.transition,
        direction: 'forward',
        navCount: state.navCount + 1,
      };
    case 'back': {
      if (state.overlays.length) return { ...state, overlays: state.overlays.slice(0, -1) };
      const prev = state.history[state.history.length - 1];
      if (!prev) return state;
      return { ...state, screenId: prev, history: state.history.slice(0, -1), overlays: [], visibility: {}, direction: 'back', navCount: state.navCount + 1 };
    }
    case 'open-overlay':
      if (!isScreen(ctx.project, action.destinationId) || state.overlays.some((o) => o.frameId === action.destinationId)) return state;
      return {
        ...state,
        overlays: [...state.overlays, { frameId: action.destinationId, position: action.position, closeOnOutsideClick: action.closeOnOutsideClick, dimBackground: action.dimBackground }],
      };
    case 'close-overlay':
      return state.overlays.length ? { ...state, overlays: state.overlays.slice(0, -1) } : state;
    case 'toggle-visibility': {
      const target = resolveTarget(ctx.sourceId, action.targetId, ctx.exists);
      if (!ctx.exists(target)) return state;
      return { ...state, visibility: { ...state.visibility, [target]: !isVisible(state, target, ctx) } };
    }
  }
}

/** Undo of a hover action when the pointer leaves (navigation is not reverted). */
export function revertHover(state: PlayerState, action: InteractionAction, ctx: ActionContext): PlayerState {
  if (action.type === 'toggle-visibility') return applyAction(state, action, ctx);
  if (action.type === 'open-overlay') return { ...state, overlays: state.overlays.filter((o) => o.frameId !== action.destinationId) };
  return state;
}

export function restart(state: PlayerState, project: Project): PlayerState {
  const first = state.history[0] ?? state.screenId;
  return startState(project, first) ?? state;
}

/** Interactions for a trigger on a layer. */
export function interactionsFor(interactions: Interaction[], trigger: Interaction['trigger']): Interaction[] {
  return interactions.filter((i) => i.trigger === trigger);
}
