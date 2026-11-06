/**
 * flö document schema — framework-independent, versioned, validated with Zod.
 *
 * The document is normalized: every DesignNode lives in `project.nodes` keyed by a
 * stable id. Hierarchy is expressed with `parentId` (a page id or a node id) and
 * ordered `childIds` (back-to-front: the last child is drawn on top).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 4 as const;

const MAX_STR = 10_000;
const MAX_NAME = 200;

export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');

const finite = z.number().finite();
const nonNeg = z.number().finite().min(0);

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB color');

export const SolidPaintSchema = z.object({
  type: z.literal('solid'),
  color: HexColorSchema,
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
});

export const GradientStopSchema = z.object({
  color: HexColorSchema,
  position: z.number().min(0).max(1),
});

export const LinearGradientPaintSchema = z.object({
  type: z.literal('linear-gradient'),
  angle: finite,
  stops: z.array(GradientStopSchema).min(2).max(16),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
});

export const PaintSchema = z.discriminatedUnion('type', [SolidPaintSchema, LinearGradientPaintSchema]);

export const StrokeSchema = z.object({
  color: HexColorSchema,
  opacity: z.number().min(0).max(1),
  width: nonNeg.max(1000),
  visible: z.boolean(),
});

export const EffectSchema = z.object({
  type: z.enum(['drop-shadow', 'inner-shadow', 'layer-blur']),
  x: finite,
  y: finite,
  blur: nonNeg.max(1000),
  spread: finite,
  color: HexColorSchema,
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
});

export const SizingModeSchema = z.enum(['fixed', 'hug', 'fill']);

export const SizingSchema = z.object({
  horizontal: SizingModeSchema,
  vertical: SizingModeSchema,
});

const optDim = nonNeg.max(100_000).nullable();

/** How an absolutely positioned child reacts when its (non auto-layout) parent is resized. */
export const ConstraintSchema = z.enum(['start', 'end', 'center', 'stretch', 'scale']);
export const ConstraintsSchema = z.object({ horizontal: ConstraintSchema, vertical: ConstraintSchema });

/** Design-token references. A bound property is resolved from the token at render time. */
export const TokenBindingsSchema = z
  .object({
    fill: IdSchema,
    stroke: IdSchema,
    text: IdSchema,
    radius: IdSchema,
    gap: IdSchema,
    padding: IdSchema,
    shadow: IdSchema,
  })
  .partial();

/** Properties that may vary per breakpoint (validated again when merged into a node). */
export const ResponsiveOverrideSchema = z
  .object({
    visible: z.boolean(),
    x: finite,
    y: finite,
    width: nonNeg.max(100_000),
    height: nonNeg.max(100_000),
    sizing: z.lazy(() => SizingSchema),
    minWidth: optDim,
    maxWidth: optDim,
    opacity: z.number().min(0).max(1),
    radius: z.tuple([nonNeg, nonNeg, nonNeg, nonNeg]),
    layout: z.lazy(() => AutoLayoutSchema),
    fontSize: z.number().min(1).max(2000),
    lineHeight: z.lazy(() => LineHeightSchema),
    letterSpacing: finite,
    textAlign: z.enum(['left', 'center', 'right', 'justify']),
  })
  .partial();

export const RESPONSIVE_KEYS = Object.keys(ResponsiveOverrideSchema.shape) as (keyof z.infer<typeof ResponsiveOverrideSchema>)[];

/* ------------------------------------------------------------------ */
/* Prototype interactions                                              */
/* ------------------------------------------------------------------ */

export const TransitionSchema = z.object({
  type: z.enum(['instant', 'dissolve', 'slide-left', 'slide-right', 'slide-up', 'slide-down']),
  durationMs: z.number().int().min(0).max(5000),
});

export const InteractionActionSchema = z.discriminatedUnion('type', [
  /** Go to another top-level frame (screen). */
  z.object({ type: z.literal('navigate'), destinationId: IdSchema, transition: TransitionSchema }),
  /** Return to the previous screen. */
  z.object({ type: z.literal('back') }),
  /** Show a top-level frame as an overlay on the current screen. */
  z.object({
    type: z.literal('open-overlay'),
    destinationId: IdSchema,
    position: z.enum(['center', 'top', 'bottom', 'left', 'right']),
    closeOnOutsideClick: z.boolean(),
    dimBackground: z.boolean(),
  }),
  /** Close the topmost overlay. */
  z.object({ type: z.literal('close-overlay') }),
  /** Show/hide another layer of the same screen. */
  z.object({ type: z.literal('toggle-visibility'), targetId: IdSchema }),
]);

export const InteractionSchema = z.object({
  id: IdSchema,
  /** click = on press; hover = while the pointer is over the layer (reverted on leave). */
  trigger: z.enum(['click', 'hover']),
  action: InteractionActionSchema,
});

export type Transition = z.infer<typeof TransitionSchema>;
export type InteractionAction = z.infer<typeof InteractionActionSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;

const BaseNodeShape = {
  id: IdSchema,
  name: z.string().max(MAX_NAME),
  parentId: IdSchema,
  childIds: z.array(IdSchema),
  visible: z.boolean(),
  locked: z.boolean(),
  x: finite,
  y: finite,
  width: nonNeg.max(100_000),
  height: nonNeg.max(100_000),
  minWidth: optDim,
  maxWidth: optDim,
  minHeight: optDim,
  maxHeight: optDim,
  opacity: z.number().min(0).max(1),
  /** 'auto' = participates in parent auto-layout; 'absolute' = positioned by x/y. */
  layoutPositioning: z.enum(['auto', 'absolute']),
  sizing: SizingSchema,
  fills: z.array(PaintSchema).max(16),
  stroke: StrokeSchema.nullable(),
  /** Corner radii: top-left, top-right, bottom-right, bottom-left. */
  radius: z.tuple([nonNeg, nonNeg, nonNeg, nonNeg]),
  effects: z.array(EffectSchema).max(16),
  constraints: ConstraintsSchema,
  bindings: TokenBindingsSchema,
  /** Breakpoint id → overridden properties (desktop-first cascade). */
  responsive: z.record(IdSchema, ResponsiveOverrideSchema),
  /** Prototype interactions (reference other layers by stable id). */
  interactions: z.array(InteractionSchema).max(20),
};

export const LayoutModeSchema = z.enum(['none', 'horizontal', 'vertical']);
export const PrimaryAlignSchema = z.enum(['start', 'center', 'end', 'space-between']);
export const CounterAlignSchema = z.enum(['start', 'center', 'end']);

export const AutoLayoutSchema = z.object({
  mode: LayoutModeSchema,
  gap: nonNeg.max(10_000),
  padding: z.tuple([nonNeg, nonNeg, nonNeg, nonNeg]),
  primaryAlign: PrimaryAlignSchema,
  counterAlign: CounterAlignSchema,
  wrap: z.boolean(),
});

/** Semantic hint used by code export to emit meaningful HTML. */
export const FrameRoleSchema = z.enum([
  'div',
  'section',
  'header',
  'nav',
  'main',
  'footer',
  'aside',
  'article',
  'button',
  'input',
  'link',
]);

export const ComponentSourceSchema = z.object({
  kind: z.literal('github'),
  repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
  path: z.string().max(500),
  /** Commit sha the component was imported from. */
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  license: z.string().max(100).nullable(),
});
export type ComponentSource = z.infer<typeof ComponentSourceSchema>;

export const FrameNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('frame'),
  clipContent: z.boolean(),
  layout: AutoLayoutSchema,
  role: FrameRoleSchema,
  /** Non-null when this frame is a main component. */
  component: z
    .object({
      set: z.string().max(100),
      variant: z.record(z.string().min(1).max(40), z.string().max(40)),
      description: z.string().max(500),
      /** Where an imported component came from (informational; never fetched or executed). */
      source: ComponentSourceSchema.optional(),
    })
    .nullable(),
});

export const GroupNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('group'),
});

export const RectNodeSchema = z.object({ ...BaseNodeShape, type: z.literal('rect') });
export const EllipseNodeSchema = z.object({ ...BaseNodeShape, type: z.literal('ellipse') });
export const LineNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('line'),
  /** false: line from top-left to bottom-right; true: bottom-left to top-right. */
  flip: z.boolean(),
});

export const TextRoleSchema = z.enum(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a']);

export const LineHeightSchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('auto') }),
  z.object({ unit: z.literal('px'), value: nonNeg.max(10_000) }),
  z.object({ unit: z.literal('percent'), value: nonNeg.max(10_000) }),
]);

/** Font family names are restricted to a safe charset (they end up in CSS). */
export const FontFamilySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9 _-]+$/, 'Invalid font family');

export const TextNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('text'),
  characters: z.string().max(MAX_STR),
  fontFamily: FontFamilySchema,
  fontSize: z.number().min(1).max(2000),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  lineHeight: LineHeightSchema,
  letterSpacing: finite,
  textAlign: z.enum(['left', 'center', 'right', 'justify']),
  textDecoration: z.enum(['none', 'underline', 'line-through']),
  textCase: z.enum(['none', 'upper', 'lower', 'title']),
  role: TextRoleSchema,
});

export const ImageNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('image'),
  assetId: IdSchema.nullable(),
  fit: z.enum(['cover', 'contain', 'fill']),
  alt: z.string().max(1000),
});

export const ICON_NAMES = [
  'arrow-right',
  'arrow-left',
  'arrow-up-right',
  'check',
  'x',
  'plus',
  'minus',
  'menu',
  'search',
  'user',
  'users',
  'home',
  'settings',
  'bell',
  'mail',
  'phone',
  'calendar',
  'clock',
  'heart',
  'star',
  'bookmark',
  'share',
  'download',
  'upload',
  'image',
  'camera',
  'play',
  'shopping-cart',
  'credit-card',
  'lock',
  'globe',
  'map-pin',
  'car',
  'chevron-down',
  'chevron-right',
  'info',
  'alert-triangle',
  'sparkles',
  'zap',
  'layout',
] as const;

export const IconNameSchema = z.enum(ICON_NAMES);

export const IconNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('icon'),
  icon: IconNameSchema,
  strokeWidth: z.number().min(0.25).max(8),
});

/** Per-layer overrides an instance applies on top of its main component. */
export const InstanceOverrideSchema = z
  .object({
    characters: z.string().max(MAX_STR),
    fills: z.array(PaintSchema).max(16),
    stroke: StrokeSchema.nullable(),
    visible: z.boolean(),
    opacity: z.number().min(0).max(1),
    fontSize: z.number().min(1).max(2000),
    fontWeight: z.number().int().min(100).max(900),
    icon: IconNameSchema,
    assetId: IdSchema.nullable(),
  })
  .partial();

export const INSTANCE_OVERRIDE_KEYS = Object.keys(InstanceOverrideSchema.shape) as (keyof z.infer<typeof InstanceOverrideSchema>)[];

export const InstanceNodeSchema = z.object({
  ...BaseNodeShape,
  type: z.literal('instance'),
  componentId: IdSchema,
  /** Source layer id inside the main component → overridden properties. */
  overrides: z.record(IdSchema, InstanceOverrideSchema),
});

export const DesignNodeSchema = z.discriminatedUnion('type', [
  FrameNodeSchema,
  GroupNodeSchema,
  RectNodeSchema,
  EllipseNodeSchema,
  LineNodeSchema,
  TextNodeSchema,
  ImageNodeSchema,
  IconNodeSchema,
  InstanceNodeSchema,
]);

export const GuideSchema = z.object({
  id: IdSchema,
  axis: z.enum(['x', 'y']),
  position: finite,
});

export const PageSchema = z.object({
  id: IdSchema,
  name: z.string().max(MAX_NAME),
  childIds: z.array(IdSchema),
  background: HexColorSchema,
  guides: z.array(GuideSchema).max(500),
});

export const AssetMetaSchema = z.object({
  id: IdSchema,
  name: z.string().max(MAX_NAME),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  width: nonNeg,
  height: nonNeg,
  size: nonNeg,
});

/* ------------------------------------------------------------------ */
/* Workflows                                                           */
/* ------------------------------------------------------------------ */

const MAX_PARAMS_JSON = 200_000;

/** Node parameters are validated per kind by the workflow catalog; here only shape and size. */
export const WorkflowParamsSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((p) => JSON.stringify(p).length <= MAX_PARAMS_JSON, 'Parameters are too large');

export const WorkflowNodeSchema = z.object({
  id: IdSchema,
  kind: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  label: z.string().max(MAX_NAME),
  position: z.object({ x: finite, y: finite }),
  params: WorkflowParamsSchema,
});

export const WorkflowEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  sourcePort: z.string().min(1).max(64),
  target: IdSchema,
  targetPort: z.string().min(1).max(64),
});

export const WorkflowSchema = z.object({
  id: IdSchema,
  name: z.string().max(MAX_NAME),
  nodes: z.array(WorkflowNodeSchema).max(1000),
  edges: z.array(WorkflowEdgeSchema).max(5000),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;

/* ------------------------------------------------------------------ */
/* Design tokens & breakpoints                                         */
/* ------------------------------------------------------------------ */

export const TokenNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9 _./-]+$/, 'Token names may use letters, numbers, spaces and _ . / -');

export const ColorTokenSchema = z.object({ id: IdSchema, name: TokenNameSchema, value: HexColorSchema, opacity: z.number().min(0).max(1) });
export const TextTokenSchema = z.object({
  id: IdSchema,
  name: TokenNameSchema,
  fontFamily: FontFamilySchema,
  fontSize: z.number().min(1).max(2000),
  fontWeight: z.number().int().min(100).max(900),
  lineHeight: LineHeightSchema,
  letterSpacing: finite,
});
export const NumberTokenSchema = z.object({ id: IdSchema, name: TokenNameSchema, value: nonNeg.max(10_000) });
export const ShadowTokenSchema = z.object({ id: IdSchema, name: TokenNameSchema, effect: EffectSchema });

export const TokensSchema = z.object({
  colors: z.array(ColorTokenSchema).max(500),
  text: z.array(TextTokenSchema).max(200),
  spacing: z.array(NumberTokenSchema).max(200),
  radius: z.array(NumberTokenSchema).max(100),
  shadows: z.array(ShadowTokenSchema).max(100),
});

export const BreakpointSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  /** Styles apply at viewport widths ≤ maxWidth (desktop-first). */
  maxWidth: z.number().int().min(120).max(10_000),
  /** Frame width used when previewing this breakpoint in the editor. */
  previewWidth: z.number().int().min(120).max(10_000),
});

export type ColorToken = z.infer<typeof ColorTokenSchema>;
export type TextToken = z.infer<typeof TextTokenSchema>;
export type NumberToken = z.infer<typeof NumberTokenSchema>;
export type ShadowToken = z.infer<typeof ShadowTokenSchema>;
export type Tokens = z.infer<typeof TokensSchema>;
export type TokenKind = keyof Tokens;
export type Breakpoint = z.infer<typeof BreakpointSchema>;
export type ResponsiveOverride = z.infer<typeof ResponsiveOverrideSchema>;
export type TokenBindings = z.infer<typeof TokenBindingsSchema>;
export type Constraint = z.infer<typeof ConstraintSchema>;
export type InstanceOverride = z.infer<typeof InstanceOverrideSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().max(MAX_NAME),
  createdAt: z.number().int().nonnegative(),
  pages: z.array(PageSchema).min(1).max(500),
  nodes: z.record(IdSchema, DesignNodeSchema),
  assets: z.record(IdSchema, AssetMetaSchema),
  workflows: z.array(WorkflowSchema).max(200),
  tokens: TokensSchema,
  breakpoints: z.array(BreakpointSchema).max(12),
  prototype: z.object({ startFrameId: IdSchema.nullable() }),
});

export type Paint = z.infer<typeof PaintSchema>;
export type SolidPaint = z.infer<typeof SolidPaintSchema>;
export type LinearGradientPaint = z.infer<typeof LinearGradientPaintSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type SizingMode = z.infer<typeof SizingModeSchema>;
export type AutoLayout = z.infer<typeof AutoLayoutSchema>;
export type FrameRole = z.infer<typeof FrameRoleSchema>;
export type TextRole = z.infer<typeof TextRoleSchema>;
export type LineHeight = z.infer<typeof LineHeightSchema>;
export type IconName = z.infer<typeof IconNameSchema>;

export type FrameNode = z.infer<typeof FrameNodeSchema>;
export type GroupNode = z.infer<typeof GroupNodeSchema>;
export type RectNode = z.infer<typeof RectNodeSchema>;
export type EllipseNode = z.infer<typeof EllipseNodeSchema>;
export type LineNode = z.infer<typeof LineNodeSchema>;
export type TextNode = z.infer<typeof TextNodeSchema>;
export type ImageNode = z.infer<typeof ImageNodeSchema>;
export type IconNode = z.infer<typeof IconNodeSchema>;
export type InstanceNode = z.infer<typeof InstanceNodeSchema>;
export type DesignNode = z.infer<typeof DesignNodeSchema>;
export type NodeType = DesignNode['type'];
export type Guide = z.infer<typeof GuideSchema>;
export type Page = z.infer<typeof PageSchema>;
export type AssetMeta = z.infer<typeof AssetMetaSchema>;
export type Project = z.infer<typeof ProjectSchema>;

/** Node types that may contain children. */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set(['frame', 'group']);

export function isContainer(node: DesignNode): node is FrameNode | GroupNode {
  return CONTAINER_TYPES.has(node.type);
}

/** Keys that can never be changed by a generic `updateNode` operation. */
export const STRUCTURAL_KEYS = ['id', 'type', 'parentId', 'childIds', 'componentId'] as const;
