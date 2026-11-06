/**
 * Natural-language prototyping (framework-independent, deterministic, offline).
 *
 * Turns prompts such as "al click scorri da destra in 300 ms" or
 * "dal pulsante Scopri di Home vai a Dettaglio con dissolvenza; Indietro torna indietro"
 * into validated prototype interactions. Italian and English are understood. Nothing is
 * applied here: callers preview the result and dispatch `setInteractions` themselves.
 * An optional AI interpretation (editor side) produces the same `LinkSpec`s through
 * `aiLinksToSpecs`, which validates every id and value.
 */
import { createId } from './ids';
import { isScreen } from './prototype';
import { InteractionSchema, type Interaction, type InteractionAction, type Project, type Transition } from './schema';
import { getNodePath } from './tree';

export type Lang = 'it' | 'en';

export interface LinkSpec {
  sourceId: string;
  interaction: Interaction;
}

export interface FlowResult {
  links: LinkSpec[];
  /** Statements that could not be turned into an interaction. */
  unresolved: string[];
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

/** Lowercase, accent-free, apostrophes as spaces. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (s: string, re: RegExp) => re.test(s);

/* ------------------------------------------------------------------ */
/* Single interaction (source and destination already known)          */
/* ------------------------------------------------------------------ */

const HOVER = /\b(hover\w*|passaggio del (mouse|cursore)|al passaggio|pass\w* sopra|sorvol\w*|mouse ?over|mouse sopra|on mouse enter|while hovering)\b/;
const BACK = /\b(torna\w* indietro|vai indietro|indietro|go back|back|schermata precedente|previous screen)\b/;
const CLOSE = /\b(chiud\w*|close\w*|dismiss\w*)\b/;
const OVERLAY = /\b(overlay|popup|pop up|pop-up|modal\w*|finestr\w*|dialog\w*|sovrappost\w*|in sovrimpressione|sheet|bottom sheet|drawer|cassetto|tendina|menu laterale|side ?menu|lightbox)\b/;
const TOGGLE = /\b(mostra\w*|nascond\w*|visualizz\w*|toggle|show|hide|espand\w*|compri\w*|collapse|expand)\b/;
const INSTANT = /\b(istantane\w*|immediat\w*|senza animazion\w*|nessuna animazion\w*|instant\w*|no animation|without animation|subito|di colpo)\b/;
const DISSOLVE = /\b(dissolven\w*|dissolv\w*|fade\w*|sfum\w*|cross ?fade|transizione morbida)\b/;
const SLIDE = /\b(slide|scorr\w*|scivol\w*|push|spin\w*|swipe|trasl\w*|carosello|entra\w*|arriv\w*|sliding)\b/;

/** Direction of a slide, using flö's naming: slide-left = the new screen moves leftwards (enters from the right). */
function slideDirection(s: string): Transition['type'] | null {
  if (has(s, /\b(da|dalla) destra\b|\bfrom (the )?right\b/)) return 'slide-left';
  if (has(s, /\b(da|dalla) sinistra\b|\bfrom (the )?left\b/)) return 'slide-right';
  if (has(s, /\bdal basso\b|\bda sotto\b|\bfrom (the )?bottom\b|\bfrom below\b/)) return 'slide-up';
  if (has(s, /\bdall alto\b|\bda sopra\b|\bfrom (the )?top\b|\bfrom above\b/)) return 'slide-down';
  if (has(s, /\b(verso|a) sinistra\b|\b(to the |towards the )?left\b/)) return 'slide-left';
  if (has(s, /\b(verso|a) destra\b|\b(to the |towards the )?right\b/)) return 'slide-right';
  if (has(s, /\bverso l alto\b|\bin alto\b|\bverso su\b|\bupwards?\b|\b(slide|scorr\w*|swipe) (up|su)\b/)) return 'slide-up';
  if (has(s, /\bverso il basso\b|\bin basso\b|\bverso giu\b|\bdownwards?\b|\b(slide|scorr\w*|swipe) (down|giu)\b/)) return 'slide-down';
  return null;
}

function duration(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(ms|millisecond\w*|millisec\w*|s|sec|secs|second\w*|secondi|secondo)\b/.exec(s);
  if (m) {
    const v = Number(m[1]!.replace(',', '.'));
    const ms = m[2]!.startsWith('m') ? v : v * 1000;
    return Math.max(0, Math.min(5000, Math.round(ms)));
  }
  if (has(s, /\b(molto|super|very) (veloc\w*|rapid\w*|fast|quick)\b/)) return 120;
  if (has(s, /\b(molto|very) (lent\w*|slow)\b/)) return 800;
  if (has(s, /\b(veloc\w*|rapid\w*|fast|quick\w*|scattante|snappy)\b/)) return 200;
  if (has(s, /\b(lent\w*|slow\w*|morbid\w*|smooth\w*|gentle|calm\w*)\b/)) return 500;
  return null;
}

export const DEFAULT_TRANSITION: Transition = { type: 'dissolve', durationMs: 300 };

function transitionOf(s: string): Transition {
  const d = duration(s);
  if (has(s, INSTANT)) return { type: 'instant', durationMs: 0 };
  let type: Transition['type'] = DEFAULT_TRANSITION.type;
  const dir = slideDirection(s);
  if (has(s, DISSOLVE)) type = 'dissolve';
  else if (has(s, SLIDE) || dir) type = dir ?? 'slide-left';
  return { type, durationMs: d ?? DEFAULT_TRANSITION.durationMs };
}

function overlayOptions(s: string) {
  const position: 'center' | 'top' | 'bottom' | 'left' | 'right' = has(s, /\b(in basso|dal basso|bottom|sotto|bottom sheet|sheet)\b/)
    ? 'bottom'
    : has(s, /\b(in alto|dall alto|top|sopra)\b/)
      ? 'top'
      : has(s, /\b(sinistra|left|drawer|cassetto|menu laterale|side ?menu)\b/)
        ? 'left'
        : has(s, /\b(destra|right)\b/)
          ? 'right'
          : 'center';
  const dimBackground = !has(s, /\bsenza (oscurare|scurire|sfondo scuro|oscuramento|velo)\b|\b(no|without) (dim\w*|backdrop)\b|\bnon (oscurare|scurire)\b/);
  const closeOnOutsideClick = !has(s, /\bnon (si )?chiud\w* (cliccando|toccando|clic\w*) fuori\b|\bsenza chiudere\b|\b(don t|do not|not) close (on|when) (outside|clicking outside)\b|\bmodal\w* bloccant\w*\b/);
  return { position, dimBackground, closeOnOutsideClick };
}

/** Trigger and action for a link whose destination is already known (drag-to-connect). */
export function interpretLink(prompt: string, destinationId: string): Pick<Interaction, 'trigger' | 'action'> {
  const s = norm(prompt);
  const trigger: Interaction['trigger'] = has(s, HOVER) ? 'hover' : 'click';
  let action: InteractionAction;
  if (has(s, OVERLAY) || has(s, /\bsopra (la|alla|a) (schermata|pagina)\b/)) action = { type: 'open-overlay', destinationId, ...overlayOptions(s) };
  else action = { type: 'navigate', destinationId, transition: transitionOf(s) };
  return { trigger, action };
}

/* ------------------------------------------------------------------ */
/* Flows with names ("dal pulsante X di Home vai a Dettaglio …")       */
/* ------------------------------------------------------------------ */

interface Named {
  id: string;
  name: string;
  key: string;
  screenId: string;
  screen: boolean;
}

interface Mention {
  item: Named;
  index: number;
  end: number;
}

/** Screens and layers of the project that can be referred to by name. */
export function namedTargets(project: Project): Named[] {
  const out: Named[] = [];
  for (const page of project.pages) {
    for (const sid of page.childIds) {
      const screen = project.nodes[sid];
      if (screen?.type !== 'frame') continue;
      out.push({ id: sid, name: screen.name, key: norm(screen.name), screenId: sid, screen: true });
      const stack = [...screen.childIds];
      while (stack.length) {
        const id = stack.shift()!;
        const n = project.nodes[id];
        if (!n) continue;
        // A label inside a small container (button, link, chip) stands for the container.
        const parent = project.nodes[n.parentId];
        const ref = n.type === 'text' && parent?.type === 'frame' && parent.id !== sid && parent.childIds.length <= 3 ? parent.id : id;
        out.push({ id: ref, name: n.name, key: norm(n.name), screenId: sid, screen: false });
        if (n.type === 'text' && n.characters.trim() && n.characters.length <= 60 && norm(n.characters) !== norm(n.name))
          out.push({ id: ref, name: n.characters, key: norm(n.characters), screenId: sid, screen: false });
        stack.push(...n.childIds);
      }
    }
  }
  return out.filter((n) => n.key.length >= 2);
}

function findMentions(s: string, items: Named[]): Mention[] {
  // Several nodes can share a name: they are candidates for the same span.
  const byKey = new Map<string, Named[]>();
  for (const it of items) {
    const list = byKey.get(it.key) ?? [];
    if (!list.some((x) => x.id === it.id)) list.push(it);
    byKey.set(it.key, list);
  }
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  const taken: [number, number][] = [];
  const out: Mention[] = [];
  for (const key of keys) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])(${esc})(?=$|[^a-z0-9])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const start = m.index + m[1]!.length;
      const end = start + m[2]!.length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      for (const item of byKey.get(key)!) out.push({ item, index: start, end });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Splits a flow prompt into statements. */
export function statements(text: string): string[] {
  return text
    .split(/\n|;|\.(?=\s|$)|\b(?:e poi|poi|then|and then|dopodiche|infine|finally)\b/i)
    .map((x) => x.trim().replace(/^[-*•\d.)\s]+/, ''))
    .filter((x) => x.length > 0);
}

/**
 * Interprets a free-form prompt describing one or more links.
 * `defaultSourceId`: layer used when a statement names no source (e.g. the selected layer).
 */
export function interpretFlow(project: Project, text: string, defaultSourceId?: string): FlowResult {
  const items = namedTargets(project);
  const links: LinkSpec[] = [];
  const unresolved: string[] = [];
  for (const raw of statements(text)) {
    const s = norm(raw);
    const mentions = findMentions(s, items);
    const spec = interpretStatement(project, s, mentions, defaultSourceId);
    if (spec) links.push(spec);
    else unresolved.push(raw);
  }
  return { links, unresolved };
}

function screenOf(project: Project, id: string): string | undefined {
  return getNodePath(project, id)[0]?.id;
}

function interpretStatement(project: Project, s: string, mentions: Mention[], defaultSourceId?: string): LinkSpec | null {
  // Group candidates by span (a span can match several nodes with the same name).
  const spans: { index: number; cands: Named[] }[] = [];
  for (const m of mentions) {
    const last = spans[spans.length - 1];
    if (last && last.index === m.index) last.cands.push(m.item);
    else spans.push({ index: m.index, cands: [m.item] });
  }
  const screens = spans.filter((sp) => sp.cands.some((c) => c.screen)).map((sp) => ({ ...sp, item: sp.cands.find((c) => c.screen)! }));
  const layerSpans = spans.filter((sp) => sp.cands.every((c) => !c.screen));
  const trigger: Interaction['trigger'] = has(s, HOVER) ? 'hover' : 'click';

  // Destination: the screen after a destination cue, else the last screen mentioned.
  const destCue = /\b(a|al|alla|allo|ai|alle|verso|su|sulla|sul|to|towards|into|apre|apri|aprire|open\w*|mostra|porta|vai|va|naviga\w*|go)\s*$/;
  // "in/di/da Home" names the context (where the source is), not the destination.
  const contextCue = /\b(in|di|del|della|dello|nella|nel|dentro|da|dal|dalla|dallo|from|of|inside|within)\s*$/;
  const before = (sp: { index: number }) => s.slice(0, sp.index).trimEnd();
  const destScreen =
    [...screens].reverse().find((sp) => destCue.test(before(sp)) || /(->|→|=>)\s*$/.test(before(sp))) ??
    [...screens].reverse().find((sp) => !contextCue.test(before(sp)) && (screens.length > 1 || layerSpans.length > 0) && sp !== screens[0]) ??
    (screens.length === 1 && layerSpans.length && !contextCue.test(before(screens[0]!)) ? screens[0] : undefined);

  // Context screen for disambiguating layer names ("il pulsante X di/in/su Home").
  const contextScreen = screens.find((sp) => sp !== destScreen)?.item.id ?? (defaultSourceId ? screenOf(project, defaultSourceId) : undefined);
  const pick = (cands: Named[]): Named => cands.find((c) => c.screenId === contextScreen) ?? cands.find((c) => c.screenId !== destScreen?.item.id) ?? cands[0]!;

  const firstLayer = layerSpans[0] ? pick(layerSpans[0].cands) : undefined;
  let sourceId = firstLayer?.id ?? (screens.length > 1 || (screens.length === 1 && !destScreen) ? screens.find((sp) => sp !== destScreen)?.item.id : undefined) ?? defaultSourceId;
  if (!sourceId) return null;
  if (!project.nodes[sourceId]) return null;

  let action: InteractionAction | null = null;
  const dest = destScreen?.item.id;
  if (has(s, OVERLAY) && dest && dest !== screenOf(project, sourceId)) action = { type: 'open-overlay', destinationId: dest, ...overlayOptions(s) };
  else if (has(s, CLOSE) && (has(s, OVERLAY) || !dest)) action = { type: 'close-overlay' };
  else if (has(s, BACK) && !dest) action = { type: 'back' };
  else if (has(s, TOGGLE) && layerSpans.length >= (firstLayer ? 2 : 1)) {
    const targetSpan = firstLayer ? layerSpans[1]! : layerSpans[0]!;
    const srcScreen = screenOf(project, sourceId);
    const target = targetSpan.cands.find((c) => c.screenId === srcScreen) ?? targetSpan.cands[0]!;
    if (target.id !== sourceId) action = { type: 'toggle-visibility', targetId: target.id };
  } else if (dest && dest !== sourceId) action = { type: 'navigate', destinationId: dest, transition: transitionOf(s) };
  if (!action) return null;
  // A screen cannot navigate to itself.
  if ((action.type === 'navigate' || action.type === 'open-overlay') && screenOf(project, sourceId) === action.destinationId) {
    if (!isScreen(project, sourceId)) return null;
  }
  const interaction = InteractionSchema.safeParse({ id: createId(), trigger, action });
  return interaction.success ? { sourceId, interaction: interaction.data } : null;
}

/* ------------------------------------------------------------------ */
/* AI output → links (validated)                                       */
/* ------------------------------------------------------------------ */

/** JSON schema the AI must follow (flat, non-recursive). */
export const AI_LINKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['links'],
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceId', 'trigger', 'action'],
        properties: {
          sourceId: { type: 'string' },
          trigger: { type: 'string', enum: ['click', 'hover'] },
          action: { type: 'string', enum: ['navigate', 'back', 'open-overlay', 'close-overlay', 'toggle-visibility'] },
          destinationId: { type: 'string' },
          targetId: { type: 'string' },
          transition: { type: 'string', enum: ['instant', 'dissolve', 'slide-left', 'slide-right', 'slide-up', 'slide-down'] },
          durationMs: { type: 'integer' },
          position: { type: 'string', enum: ['center', 'top', 'bottom', 'left', 'right'] },
          dimBackground: { type: 'boolean' },
          closeOnOutsideClick: { type: 'boolean' },
        },
      },
    },
  },
} as const;

/** Compact description of the project for the AI (ids + names only, no content). */
export function aiContext(project: Project): string {
  const lines: string[] = [];
  for (const page of project.pages) {
    for (const sid of page.childIds) {
      const screen = project.nodes[sid];
      if (screen?.type !== 'frame') continue;
      lines.push(`SCREEN ${sid} "${screen.name.slice(0, 60)}"`);
      const stack = [...screen.childIds];
      let count = 0;
      while (stack.length && count < 80) {
        const n = project.nodes[stack.shift()!];
        if (!n) continue;
        count++;
        const label = n.type === 'text' ? n.characters.slice(0, 40).replace(/\s+/g, ' ') : '';
        lines.push(`  LAYER ${n.id} ${n.type} "${n.name.slice(0, 60)}"${label && label !== n.name ? ` text="${label}"` : ''}`);
        stack.push(...n.childIds);
      }
    }
  }
  return lines.join('\n').slice(0, 30_000);
}

/** Validates AI output: unknown ids, wrong actions and out-of-range values are dropped. */
export function aiLinksToSpecs(project: Project, json: unknown): LinkSpec[] {
  const links = (json as { links?: unknown })?.links;
  if (!Array.isArray(links)) return [];
  const out: LinkSpec[] = [];
  for (const l of links.slice(0, 50) as Record<string, unknown>[]) {
    if (!l || typeof l !== 'object') continue;
    const sourceId = String(l.sourceId ?? '');
    if (!project.nodes[sourceId]) continue;
    const dest = typeof l.destinationId === 'string' && isScreen(project, l.destinationId) ? l.destinationId : null;
    const target = typeof l.targetId === 'string' && project.nodes[l.targetId] ? l.targetId : null;
    let action: unknown;
    switch (l.action) {
      case 'navigate':
        if (!dest) continue;
        action = { type: 'navigate', destinationId: dest, transition: { type: l.transition ?? 'dissolve', durationMs: Math.max(0, Math.min(5000, Math.round(Number(l.durationMs ?? 300)) || 0)) } };
        break;
      case 'open-overlay':
        if (!dest) continue;
        action = { type: 'open-overlay', destinationId: dest, position: l.position ?? 'center', closeOnOutsideClick: l.closeOnOutsideClick ?? true, dimBackground: l.dimBackground ?? true };
        break;
      case 'toggle-visibility':
        if (!target || target === sourceId) continue;
        action = { type: 'toggle-visibility', targetId: target };
        break;
      case 'back':
      case 'close-overlay':
        action = { type: l.action };
        break;
      default:
        continue;
    }
    const parsed = InteractionSchema.safeParse({ id: createId(), trigger: l.trigger, action });
    if (parsed.success) out.push({ sourceId, interaction: parsed.data });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Applying and describing                                             */
/* ------------------------------------------------------------------ */

const sameKind = (a: Interaction, b: Interaction) => {
  if (a.trigger !== b.trigger || a.action.type !== b.action.type) return false;
  if ('destinationId' in a.action && 'destinationId' in b.action) return a.action.destinationId === b.action.destinationId;
  if (a.action.type === 'toggle-visibility' && b.action.type === 'toggle-visibility') return a.action.targetId === b.action.targetId;
  return true;
};

/** New interaction lists per source; a link replaces an existing one of the same kind. */
export function mergeLinks(project: Project, links: LinkSpec[]): Map<string, Interaction[]> {
  const out = new Map<string, Interaction[]>();
  for (const { sourceId, interaction } of links) {
    const current = out.get(sourceId) ?? project.nodes[sourceId]?.interactions ?? [];
    const kept = current.filter((i) => !sameKind(i, interaction) && !(i.trigger === interaction.trigger && i.action.type === 'navigate' && interaction.action.type === 'navigate'));
    out.set(sourceId, [...kept, interaction].slice(-20));
  }
  return out;
}

const T: Record<Lang, Record<string, string>> = {
  it: {
    click: 'Al clic',
    hover: 'Al passaggio del mouse',
    navigate: 'vai a',
    back: 'torna indietro',
    'open-overlay': 'apri come overlay',
    'close-overlay': 'chiudi l’overlay',
    'toggle-visibility': 'mostra/nascondi',
    instant: 'istantanea',
    dissolve: 'dissolvenza',
    'slide-left': 'scorre da destra',
    'slide-right': 'scorre da sinistra',
    'slide-up': 'sale dal basso',
    'slide-down': 'scende dall’alto',
    center: 'al centro',
    top: 'in alto',
    bottom: 'in basso',
    left: 'a sinistra',
    right: 'a destra',
    dim: 'sfondo scurito',
    outside: 'si chiude cliccando fuori',
  },
  en: {
    click: 'On click',
    hover: 'On hover',
    navigate: 'go to',
    back: 'go back',
    'open-overlay': 'open as overlay',
    'close-overlay': 'close the overlay',
    'toggle-visibility': 'show/hide',
    instant: 'instant',
    dissolve: 'dissolve',
    'slide-left': 'slides in from the right',
    'slide-right': 'slides in from the left',
    'slide-up': 'slides up from the bottom',
    'slide-down': 'slides down from the top',
    center: 'centered',
    top: 'at the top',
    bottom: 'at the bottom',
    left: 'on the left',
    right: 'on the right',
    dim: 'dimmed background',
    outside: 'closes on outside click',
  },
};

/** Human-readable summary, e.g. "Al clic → vai a «Dettaglio» · scorre da destra · 300 ms". */
export function describeInteraction(project: Project, i: Interaction, lang: Lang): string {
  const t = T[lang];
  const name = (id: string) => `«${project.nodes[id]?.name ?? '?'}»`;
  const a = i.action;
  const parts = [`${t[i.trigger]} → ${t[a.type]}`];
  if (a.type === 'navigate') {
    parts[0] += ` ${name(a.destinationId)}`;
    parts.push(t[a.transition.type]!);
    if (a.transition.type !== 'instant') parts.push(`${a.transition.durationMs} ms`);
  }
  if (a.type === 'open-overlay') {
    parts[0] += ` ${name(a.destinationId)}`;
    parts.push(t[a.position]!);
    if (a.dimBackground) parts.push(t.dim!);
    if (a.closeOnOutsideClick) parts.push(t.outside!);
  }
  if (a.type === 'toggle-visibility') parts[0] += ` ${name(a.targetId)}`;
  return parts.join(' · ');
}
