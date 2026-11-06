/** Runner implementations for each ready node kind. */
import { cloneSubtree } from '../clone';
import type { DocOp } from '../ops';
import type { DesignNode, Project } from '../schema';
import type { BriefValue, DesignValue, ReportValue, SitemapValue, StylesValue } from './catalog';
import { accessibilityReport, consistencyReport, responsiveReport } from './checks';
import { NodeRunError, type Runner, type RunnerContext } from './engine';
import { exportHtml } from './htmlExport';
import { exportReactProject } from '../export/react';

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
import { DEVICES, ensurePage, liveFrames, nextFreeX, removeGenerated, type Device } from './placement';
import { adaptTree } from './responsive';
import { deriveStyles, designSystemTokenOps, styleTree, styleUpdates, type DesignSystemParams } from './styling';
import { buildWireframe, treesFor } from './wireframe';
import { produce } from 'immer';
import { AI_PLAN_JSON_SCHEMA, parsePlan, planToOps } from '../ai/plan';
import { buildDesignPrompt, DESIGN_SYSTEM_PROMPT, IA_SCHEMA, IA_SYSTEM, UX_ANALYSIS_SCHEMA, UX_SYSTEM } from '../ai/agent';
import { createId } from '../ids';
import { applyOps } from '../ops';

const t = (ctx: RunnerContext, it: string, en: string) => (ctx.host.lang === 'it' ? it : en);

function needDesign(ctx: RunnerContext, port = 'design'): { project: Project; design: DesignValue; frames: string[] } {
  const design = ctx.inputs[port];
  if (!design || design.type !== 'design') throw new NodeRunError(t(ctx, 'Manca il design in ingresso', 'Missing input design'));
  const project = ctx.host.getProject();
  const frames = liveFrames(project, design);
  if (!frames.length) throw new NodeRunError(t(ctx, 'I frame in ingresso non esistono più', 'The input frames no longer exist'));
  return { project, design, frames };
}

/** Parses an indented outline ("Home", "  Sub page") or bullet list into sitemap pages. */
export function parseOutline(text: string): SitemapValue['pages'] {
  const pages: SitemapValue['pages'] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)![0].replace(/\t/g, '  ').length;
    const name = raw.trim().replace(/^[-*•]\s*/, '').trim();
    if (!name) continue;
    const depth = Math.min(4, Math.floor(indent / 2));
    pages.push({ name: name.slice(0, 80), depth, children: [] });
  }
  // Attach children names to their nearest shallower parent.
  pages.forEach((p, i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (pages[j]!.depth < p.depth) {
        if (pages[j]!.depth === p.depth - 1) pages[j]!.children.push(p.name);
        break;
      }
    }
  });
  return pages;
}

/** Extracts bullet lines ("- X", "* X", "• X") from free text. */
export function bulletsFrom(text: string): string {
  return text
    .split('\n')
    .filter((l) => /^\s*[-*•]\s+\S/.test(l))
    .join('\n');
}

const designOut = (pageId: string, frameIds: string[]): DesignValue => ({ type: 'design', pageId, frameIds });

export const RUNNERS: Record<string, Runner> = {
  'brief-input': (ctx) => {
    const text = String(ctx.params.text ?? '').trim();
    if (!text) throw new NodeRunError(t(ctx, 'Scrivi il brief', 'Write the brief'));
    return { outputs: { brief: { type: 'brief', text } }, summary: `${text.split(/\s+/).length} ${t(ctx, 'parole', 'words')}` };
  },

  'screenshot-input': (ctx) => imageInput(ctx),
  'reference-input': (ctx) => imageInput(ctx),

  'design-input': (ctx) => {
    const project = ctx.host.getProject();
    const page = project.pages.find((p) => p.id === ctx.params.pageId);
    if (!page) throw new NodeRunError(t(ctx, 'Scegli una pagina del progetto', 'Choose a project page'));
    const chosen = (ctx.params.frameIds as string[]).filter((id) => project.nodes[id]);
    const frames = chosen.length ? chosen : page.childIds.filter((id) => project.nodes[id]?.type === 'frame');
    if (!frames.length) throw new NodeRunError(t(ctx, 'La pagina non contiene frame', 'The page contains no frames'));
    return { outputs: { design: designOut(page.id, frames) }, summary: `${frames.length} frame · ${page.name}` };
  },

  sitemap: (ctx) => {
    let outline = String(ctx.params.outline ?? '');
    if (!outline.trim()) {
      const brief = ctx.inputs.brief as BriefValue | undefined;
      outline = brief ? bulletsFrom(brief.text) : '';
    }
    const pages = parseOutline(outline);
    if (!pages.length) {
      throw new NodeRunError(
        t(ctx, 'Nessuna pagina: scrivi la struttura o aggiungi un elenco puntato (- Pagina) al brief', 'No pages: write the structure or add a bullet list (- Page) to the brief'),
      );
    }
    return { outputs: { sitemap: { type: 'sitemap', pages } }, summary: `${pages.length} ${t(ctx, 'pagine', 'pages')}` };
  },

  'user-flow': (ctx) => {
    let steps = String(ctx.params.steps ?? '')
      .split('\n')
      .map((s) => s.trim().replace(/^[-*•\d.)]+\s*/, ''))
      .filter(Boolean);
    const sm = ctx.inputs.sitemap as SitemapValue | undefined;
    if (!steps.length && sm) steps = sm.pages.map((p) => p.name);
    if (!steps.length) throw new NodeRunError(t(ctx, 'Scrivi i passi del flusso o collega una sitemap', 'Write the flow steps or connect a sitemap'));
    return { outputs: { flow: { type: 'flow', steps } }, summary: steps.join(' → ').slice(0, 120) };
  },

  wireframe: (ctx) => {
    const sitemap = ctx.inputs.sitemap as SitemapValue;
    const project = ctx.host.getProject();
    const ops: DocOp[] = removeGenerated(project, ctx.previous?.generated);
    const { pageId, ops: pageOps } = ensurePage(project, String(ctx.params.pageName));
    ops.unshift(...pageOps);
    const startX = nextFreeX(project, pageId, new Set(ctx.previous?.generated?.frameIds ?? []));
    const { roots, nodes } = buildWireframe(sitemap, { device: ctx.params.device as Device, brand: String(ctx.params.brand ?? ''), pageId, startX });
    for (const tree of treesFor(roots, nodes)) ops.push({ type: 'insertTree', nodes: tree });
    ctx.host.apply(ops, `Workflow · ${ctx.node.label || 'Wireframe'}`);
    const out = designOut(pageId, roots);
    return { outputs: { design: out }, generated: out, summary: `${roots.length} frame` };
  },

  'design-system': (ctx) => {
    const styles = deriveStyles(ctx.params as unknown as DesignSystemParams);
    if (ctx.params.writeTokens) {
      const { ops, tokenIds } = designSystemTokenOps(ctx.node.id, styles);
      ctx.host.apply(ops, `Workflow · ${ctx.node.label || 'Design system'} → tokens`);
      styles.tokenIds = tokenIds;
    }
    return { outputs: { styles }, summary: `${styles.fonts.heading} / ${styles.fonts.body} · ${styles.colors.primary}${styles.tokenIds ? ' · token' : ''}` };
  },

  'apply-styles': (ctx) => {
    const { project, design, frames } = needDesign(ctx);
    const styles = ctx.inputs.styles as StylesValue | undefined;
    if (!styles) throw new NodeRunError(t(ctx, 'Collega un design system', 'Connect a design system'));
    if (ctx.params.mode === 'in-place') {
      const ops: DocOp[] = styleUpdates(project, frames, styles).map(({ id, props }) => ({ type: 'updateNode', id, props: props as Record<string, unknown> }));
      ctx.host.apply(ops, `Workflow · ${ctx.node.label || 'Apply styles'}`);
      return { outputs: { design: designOut(design.pageId, frames) }, summary: t(ctx, `${ops.length} livelli aggiornati`, `${ops.length} layers updated`) };
    }
    const ops: DocOp[] = removeGenerated(project, ctx.previous?.generated);
    const exclude = new Set(ctx.previous?.generated?.frameIds ?? []);
    let x = nextFreeX(project, design.pageId, exclude);
    const roots: string[] = [];
    for (const id of frames) {
      const src = project.nodes[id]!;
      const clones = cloneSubtree(project.nodes, id, design.pageId);
      const map: Record<string, DesignNode> = Object.fromEntries(clones.map((n) => [n.id, n]));
      const root = clones[0]!;
      styleTree(map, [root.id], styles);
      root.x = x;
      root.y = src.parentId === design.pageId ? src.y : 0;
      root.layoutPositioning = 'absolute';
      root.name = `${src.name} · ${t(ctx, 'stile', 'styled')}`;
      x += root.width + 160;
      ops.push({ type: 'insertTree', nodes: clones });
      roots.push(root.id);
    }
    ctx.host.apply(ops, `Workflow · ${ctx.node.label || 'Apply styles'}`);
    const out = designOut(design.pageId, roots);
    return { outputs: { design: out }, generated: out, summary: `${roots.length} frame` };
  },

  'responsive-adapter': (ctx) => {
    const { project, design, frames } = needDesign(ctx);
    const device = ctx.params.device as Device;
    const ops: DocOp[] = removeGenerated(project, ctx.previous?.generated);
    let x = nextFreeX(project, design.pageId, new Set(ctx.previous?.generated?.frameIds ?? []));
    const roots: string[] = [];
    for (const id of frames) {
      const src = project.nodes[id]!;
      const clones = cloneSubtree(project.nodes, id, design.pageId);
      const extra = adaptTree(clones, device);
      const root = clones[0]!;
      root.x = x;
      root.y = src.parentId === design.pageId ? src.y : 0;
      root.layoutPositioning = 'absolute';
      x += root.width + 160;
      ops.push({ type: 'insertTree', nodes: [...clones, ...extra] });
      roots.push(root.id);
    }
    ctx.host.apply(ops, `Workflow · ${ctx.node.label || 'Responsive'}`);
    const out = designOut(design.pageId, roots);
    return { outputs: { design: out }, generated: out, summary: `${roots.length} frame · ${device}` };
  },

  'a11y-check': (ctx) => {
    const { project, frames } = needDesign(ctx);
    const report = accessibilityReport(project, frames, ctx.params.level as 'AA' | 'AAA', ctx.host.lang);
    return { outputs: { report }, summary: reportSummary(ctx, report) };
  },

  'consistency-check': (ctx) => {
    const { project, frames } = needDesign(ctx);
    const report = consistencyReport(project, frames, ctx.inputs.styles as StylesValue | undefined, ctx.host.lang);
    return { outputs: { report }, summary: reportSummary(ctx, report) };
  },

  'responsive-check': (ctx) => {
    const { project, frames } = needDesign(ctx);
    const report = responsiveReport(project, frames, ctx.host.lang);
    return { outputs: { report }, summary: reportSummary(ctx, report) };
  },

  branch: (ctx) => ({ outputs: { a: ctx.inputs.in, b: ctx.inputs.in } }),

  condition: (ctx) => {
    const r = ctx.inputs.report as ReportValue;
    const errors = r.issues.filter((i) => i.severity === 'error').length;
    const warnings = r.issues.filter((i) => i.severity === 'warning').length;
    const pass = errors <= Number(ctx.params.maxErrors) && warnings <= Number(ctx.params.maxWarnings);
    return {
      outputs: pass ? { pass: r, fail: undefined } : { pass: undefined, fail: r },
      summary: pass ? t(ctx, 'Superato', 'Passed') : t(ctx, 'Non superato', 'Failed'),
    };
  },

  merge: (ctx) => ({ outputs: { out: ctx.inputs.a ?? ctx.inputs.b } }),

  compare: (ctx) => {
    const chosen = ctx.params.choice === 'b' ? ctx.inputs.b : ctx.inputs.a;
    return { outputs: { design: chosen }, summary: t(ctx, `Scelta: ${String(ctx.params.choice).toUpperCase()}`, `Chosen: ${String(ctx.params.choice).toUpperCase()}`) };
  },

  'canvas-output': (ctx) => {
    const { frames } = needDesign(ctx);
    return { outputs: {}, summary: `${frames.length} frame` };
  },

  prototype: (ctx) => {
    const { project, frames } = needDesign(ctx);
    const links = frames.reduce((n, id) => {
      let count = 0;
      const visit = (nid: string) => {
        const node = project.nodes[nid];
        if (!node) return;
        count += node.interactions.length;
        node.childIds.forEach(visit);
      };
      visit(id);
      return n + count;
    }, 0);
    return { outputs: {}, summary: t(ctx, `${frames.length} schermate · ${links} interazioni`, `${frames.length} screens · ${links} interactions`) };
  },

  'react-export': async (ctx) => {
    const { project, frames } = needDesign(ctx);
    const res = await exportReactProject(project, frames, { name: String(ctx.params.name || project.name), lang: ctx.host.lang }, { getAssetBytes: ctx.host.getAssetBytes });
    const files = res.files.map((f) =>
      typeof f.content === 'string' ? { path: f.path, content: f.content } : { path: f.path, content: bytesToBase64(f.content), encoding: 'base64' as const },
    );
    const a = res.a11y.issues.filter((i) => i.severity !== 'info').length;
    return { outputs: { code: { type: 'code', files } }, summary: t(ctx, `${files.length} file · ${res.screens.length} schermate · ${a} avvisi a11y`, `${files.length} files · ${res.screens.length} screens · ${a} a11y warnings`) };
  },

  'html-export': async (ctx) => {
    const { project, frames } = needDesign(ctx);
    const html = await exportHtml(project, frames, String(ctx.params.title || 'flö export'), ctx.host);
    return { outputs: { code: { type: 'code', files: [{ path: 'index.html', content: html }] } }, summary: `index.html · ${Math.round(html.length / 1024)} kB` };
  },
};

/* ------------------------------------------------------------------ */
/* AI nodes                                                            */
/* ------------------------------------------------------------------ */

function needAi(ctx: RunnerContext) {
  if (!ctx.host.ai) throw new NodeRunError(t(ctx, 'Nessun provider AI configurato', 'No AI provider configured'));
  return ctx.host.ai;
}

function briefText(ctx: RunnerContext): string {
  const b = ctx.inputs.brief as BriefValue | undefined;
  if (!b) throw new NodeRunError(t(ctx, 'Collega un brief', 'Connect a brief'));
  return b.text;
}

async function aiDesign(ctx: RunnerContext, asComponents: boolean) {
  const ai = needAi(ctx);
  const project = ctx.host.getProject();
  const styles = ctx.inputs.styles as StylesValue | undefined;
  const ops: DocOp[] = removeGenerated(project, ctx.previous?.generated);
  const { pageId, ops: pageOps } = ensurePage(project, String(ctx.params.pageName));
  ops.unshift(...pageOps);
  // Work on a preview of the document after cleanup so the plan targets the right page.
  const base = ops.length ? produce(project, (d) => applyOps(d, ops)) : project;
  const device = ctx.params.device as Device;
  const request = [
    asComponents
      ? `Create a small library of reusable UI components for this product (e.g. buttons in primary/secondary variants, input field, card, navigation bar). Each component is its own top-level frame using auto layout, named "Component/Name".`
      : `Design the key screens for this product as top-level ${device} frames (${DEVICES[device].width}px wide, vertical auto layout, height hugging content).`,
    `Product brief:\n${briefText(ctx)}`,
    styles
      ? `Use this design system: primary ${styles.colors.primary}, background ${styles.colors.background}, surface ${styles.colors.surface}, text ${styles.colors.text}, muted ${styles.colors.muted}, border ${styles.colors.border}; fonts ${styles.fonts.heading}/${styles.fonts.body}; sizes h1 ${styles.sizes.h1}, h2 ${styles.sizes.h2}, h3 ${styles.sizes.h3}, body ${styles.sizes.body}; radius ${styles.radius}.`
      : '',
    String(ctx.params.instructions ?? ''),
  ]
    .filter(Boolean)
    .join('\n\n');
  const gen = await ai.generate({ system: DESIGN_SYSTEM_PROMPT, prompt: buildDesignPrompt(base, { targetId: pageId, contextIds: [] }, request), schema: AI_PLAN_JSON_SCHEMA, maxTokens: 32_000 });
  let plan;
  try {
    plan = parsePlan(gen.json ?? gen.text);
  } catch (e) {
    throw new NodeRunError(e instanceof Error ? e.message : String(e));
  }
  const res = planToOps(base, plan, pageId, () => createId());
  const roots = res.createdRoots.filter((id) => res.ops.some((o) => o.type === 'insertTree' && o.nodes[0]!.id === id && o.nodes[0]!.parentId === pageId));
  if (!roots.length) throw new NodeRunError(t(ctx, `Il piano AI non ha creato schermate${res.errors.length ? `: ${res.errors[0]}` : ''}`, `The AI plan created no frames${res.errors.length ? `: ${res.errors[0]}` : ''}`));
  const extra: DocOp[] = asComponents
    ? roots.map((id) => ({ type: 'setComponent', id, component: { set: 'AI components', variant: {}, description: plan.summary.slice(0, 500) } }) as DocOp)
    : [];
  ctx.host.apply([...ops, ...res.ops, ...extra], `Workflow · ${ctx.node.label || 'AI'}`);
  const out = designOut(pageId, roots);
  const usage = gen.usage ? ` · ${gen.usage.inputTokens}+${gen.usage.outputTokens} tok` : '';
  return { outputs: { design: out }, generated: out, summary: `${roots.length} frame · ${gen.model}${usage}${res.errors.length ? ` · ${res.errors.length} ⚠` : ''}` };
}

RUNNERS['ux-analysis'] = async (ctx) => {
  const gen = await needAi(ctx).generate({ system: UX_SYSTEM, prompt: briefText(ctx), schema: UX_ANALYSIS_SCHEMA, maxTokens: 8000 });
  const data = gen.json as { title?: string; findings?: { kind: string; text: string }[] } | undefined;
  if (!data?.findings) throw new NodeRunError(t(ctx, 'Risposta AI non valida', 'Invalid AI response'));
  const report: ReportValue = {
    type: 'report',
    title: String(data.title ?? 'UX'),
    checked: data.findings.length,
    issues: data.findings.slice(0, 100).map((f) => ({ severity: f.kind === 'risk' ? 'warning' : 'info', message: `[${f.kind}] ${String(f.text).slice(0, 500)}` })),
  };
  return { outputs: { report }, summary: `${report.issues.length} · ${gen.model}` };
};

RUNNERS['info-architecture'] = async (ctx) => {
  const gen = await needAi(ctx).generate({ system: IA_SYSTEM, prompt: briefText(ctx), schema: IA_SCHEMA, maxTokens: 4000 });
  const data = gen.json as { pages?: { name: string; depth: number }[] } | undefined;
  if (!data?.pages?.length) throw new NodeRunError(t(ctx, 'Risposta AI non valida', 'Invalid AI response'));
  const outline = data.pages
    .slice(0, 60)
    .map((p) => `${'  '.repeat(Math.max(0, Math.min(3, Math.round(p.depth))))}${String(p.name).slice(0, 80)}`)
    .join('\n');
  const pages = parseOutline(outline);
  return { outputs: { sitemap: { type: 'sitemap', pages } }, summary: `${pages.length} ${t(ctx, 'pagine', 'pages')} · ${gen.model}` };
};

RUNNERS['ui-generator'] = (ctx) => aiDesign(ctx, false);
RUNNERS['component-generator'] = (ctx) => aiDesign(ctx, true);

function imageInput(ctx: RunnerContext) {
  const assetId = ctx.params.assetId as string | null;
  const project = ctx.host.getProject();
  if (!assetId || !project.assets[assetId]) throw new NodeRunError(t(ctx, 'Scegli un’immagine dalle risorse del progetto', 'Choose an image from the project assets'));
  return { outputs: { image: { type: 'image' as const, assetId, notes: String(ctx.params.notes ?? '') } }, summary: project.assets[assetId]!.name };
}

function reportSummary(ctx: RunnerContext, r: ReportValue): string {
  const e = r.issues.filter((i) => i.severity === 'error').length;
  const w = r.issues.filter((i) => i.severity === 'warning').length;
  return t(ctx, `${e} errori · ${w} avvisi`, `${e} errors · ${w} warnings`);
}
