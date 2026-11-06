import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createFrame, createProject, createText } from '../factory';
import { applyOps } from '../ops';
import { aiLinksToSpecs, describeInteraction, interpretFlow, interpretLink, mergeLinks, statements } from '../prototypePrompt';
import type { DesignNode, Project } from '../schema';

function setup() {
  const p = createProject('t');
  const pageId = p.pages[0]!.id;
  const home = createFrame({ parentId: pageId, name: 'Home', width: 390, height: 800 });
  const detail = createFrame({ parentId: pageId, name: 'Dettaglio', x: 500, width: 390, height: 800 });
  const menu = createFrame({ parentId: pageId, name: 'Menu', x: 1000, width: 300, height: 400 });
  const cta = createFrame({ parentId: home.id, name: 'Button' });
  const ctaLabel = createText({ parentId: cta.id, name: 'Label' }, { characters: 'Scopri' });
  const filters = createFrame({ parentId: home.id, name: 'Filtri' });
  const panel = createFrame({ parentId: home.id, name: 'Pannello filtri' });
  const back = createFrame({ parentId: detail.id, name: 'Button' });
  const backLabel = createText({ parentId: back.id, name: 'Label' }, { characters: 'Indietro' });
  const link = (parent: DesignNode, kids: DesignNode[]) => (parent.childIds = kids.map((k) => k.id));
  link(home, [cta, filters, panel]);
  link(cta, [ctaLabel]);
  link(detail, [back]);
  link(back, [backLabel]);
  const project = produce(p, (d) => applyOps(d, [{ type: 'insertTree', nodes: [home, cta, ctaLabel, filters, panel] }, { type: 'insertTree', nodes: [detail, back, backLabel] }, { type: 'insertTree', nodes: [menu] }])) as Project;
  return { project, home, detail, menu, cta, filters, panel, back };
}

describe('prompt → single link (drag to connect)', () => {
  it('reads trigger, animation, direction and duration', () => {
    expect(interpretLink('al click scorri da destra in 300 ms', 'D')).toEqual({ trigger: 'click', action: { type: 'navigate', destinationId: 'D', transition: { type: 'slide-left', durationMs: 300 } } });
    expect(interpretLink('al passaggio del mouse dissolvenza lenta', 'D')).toMatchObject({ trigger: 'hover', action: { transition: { type: 'dissolve', durationMs: 500 } } });
    expect(interpretLink('entra dal basso in 0,4 secondi', 'D').action).toMatchObject({ transition: { type: 'slide-up', durationMs: 400 } });
    expect(interpretLink('slide from the left, fast', 'D').action).toMatchObject({ transition: { type: 'slide-right', durationMs: 200 } });
    expect(interpretLink('senza animazione', 'D').action).toMatchObject({ transition: { type: 'instant', durationMs: 0 } });
    expect(interpretLink('', 'D').action).toMatchObject({ type: 'navigate', transition: { type: 'dissolve', durationMs: 300 } });
    expect(interpretLink('passa alla schermata con una dissolvenza', 'D').trigger).toBe('click');
  });

  it('understands overlays with position and options', () => {
    expect(interpretLink('apri come bottom sheet senza oscurare lo sfondo', 'M').action).toEqual({ type: 'open-overlay', destinationId: 'M', position: 'bottom', dimBackground: false, closeOnOutsideClick: true });
    expect(interpretLink('open as a modal popup', 'M').action).toMatchObject({ type: 'open-overlay', position: 'center', dimBackground: true });
    expect(interpretLink('menu laterale da sinistra', 'M').action).toMatchObject({ type: 'open-overlay', position: 'left' });
  });
});

describe('prompt → flow with names', () => {
  it('splits statements', () => {
    expect(statements('A vai a B; poi C torna indietro.\nD')).toEqual(['A vai a B', 'C torna indietro', 'D']);
  });

  it('links named layers and screens, disambiguating duplicate names by screen', () => {
    const { project, cta, detail, back, menu, filters, panel, home } = setup();
    const r = interpretFlow(
      project,
      'Il pulsante Scopri di Home porta a Dettaglio con scorrimento da destra in 250ms; in Dettaglio Indietro torna indietro; Filtri mostra Pannello filtri; Home apre Menu come overlay a sinistra; al passaggio del mouse su Button di Dettaglio vai a Home; frase senza senso',
    );
    expect(r.unresolved).toEqual(['frase senza senso']);
    expect(r.links).toHaveLength(5);
    // The "Scopri" label resolves to its button container.
    expect(r.links[0]).toMatchObject({ sourceId: cta.id, interaction: { trigger: 'click', action: { type: 'navigate', destinationId: detail.id, transition: { type: 'slide-left', durationMs: 250 } } } });
    expect(r.links[1]).toMatchObject({ sourceId: back.id, interaction: { action: { type: 'back' } } });
    expect(r.links[2]).toMatchObject({ sourceId: filters.id, interaction: { action: { type: 'toggle-visibility', targetId: panel.id } } });
    expect(r.links[3]).toMatchObject({ sourceId: home.id, interaction: { action: { type: 'open-overlay', destinationId: menu.id, position: 'left' } } });
    expect(r.links[4]).toMatchObject({ sourceId: back.id, interaction: { trigger: 'hover', action: { type: 'navigate', destinationId: home.id } } });
  });

  it('uses the selected layer when the prompt names no source', () => {
    const { project, cta, detail } = setup();
    const r = interpretFlow(project, 'vai a Dettaglio con dissolvenza veloce', cta.id);
    expect(r.links[0]).toMatchObject({ sourceId: cta.id, interaction: { action: { destinationId: detail.id, transition: { type: 'dissolve', durationMs: 200 } } } });
    expect(describeInteraction(project, r.links[0]!.interaction, 'it')).toBe('Al clic → vai a «Dettaglio» · dissolvenza · 200 ms');
  });

  it('replaces an existing link of the same kind instead of duplicating it', () => {
    const { project, cta, detail, menu } = setup();
    const first = interpretFlow(project, 'vai a Dettaglio', cta.id).links;
    const p2 = produce(project, (d) => applyOps(d, [{ type: 'setInteractions', id: cta.id, interactions: mergeLinks(project, first).get(cta.id)! }])) as Project;
    const second = interpretFlow(p2, 'vai a Menu con slide', cta.id).links;
    const merged = mergeLinks(p2, second).get(cta.id)!;
    expect(merged).toHaveLength(1);
    expect(merged[0]!.action).toMatchObject({ destinationId: menu.id, transition: { type: 'slide-left' } });
    void detail;
  });
});

describe('AI output validation', () => {
  it('keeps only valid ids, actions and values', () => {
    const { project, cta, detail, panel } = setup();
    const specs = aiLinksToSpecs(project, {
      links: [
        { sourceId: cta.id, trigger: 'click', action: 'navigate', destinationId: detail.id, transition: 'slide-up', durationMs: 99999 },
        { sourceId: 'ghost', trigger: 'click', action: 'back' },
        { sourceId: cta.id, trigger: 'click', action: 'navigate', destinationId: panel.id },
        { sourceId: cta.id, trigger: 'dblclick', action: 'back' },
        { sourceId: cta.id, trigger: 'click', action: 'eval', destinationId: detail.id },
      ],
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.interaction.action).toEqual({ type: 'navigate', destinationId: detail.id, transition: { type: 'slide-up', durationMs: 5000 } });
    expect(aiLinksToSpecs(project, 'nonsense')).toEqual([]);
  });
});
