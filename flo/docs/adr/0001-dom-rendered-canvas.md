# ADR 0001 — Render the design canvas with the DOM

**Status:** accepted (Milestone 1)

**Context.** flö must produce real, responsive frontend code and support flexbox-like auto
layout, text wrapping and web fonts. Options: Canvas2D/WebGL renderer with a custom layout
engine, or DOM rendering.

**Decision.** Render nodes as DOM elements styled by `core/style.ts`, inside a transformed
world container. Editor chrome (selection, handles, guides) is drawn in a separate
screen-space overlay from DOM-measured rects.

**Consequences.** + Layout and typography are the browser's, so the canvas matches exported
HTML/CSS. + Much less custom code. − Very large documents (tens of thousands of nodes) will
need virtualization or a different renderer later. − Rotation is not supported yet
(selection math assumes axis-aligned boxes).
