# ui

Accessible `Button`, labeled `IconButton` tooltips, and a focus-trapped `Modal` using accessible dialog primitives. Import `styles.css` and `design-tokens` in the host. Run `pnpm storybook` from the root to inspect controls. UI is independent of architecture semantics.

Controlled dialogs remember their opener before child autofocus and restore it after dismissal. Optional `initialFocusRef` and `returnFocusRef` select explicit focus targets for programmatic dialogs. A destination dialog owns focus during a handoff; a removed opener falls back to the host's focusable main landmark or an available button. `IconButton` accepts a button ref. `Tabs` supports roving keyboard focus, arrow keys and Home/End. `StatusBadge` documents evidence and assessment states in the component preview. Shared presentation never imports architecture contracts or engines.

`TechnologyIcon` renders tree-shaken local licensed technology SVG paths and original infrastructure pictograms, with an accessible label when meaningful and a local fallback for unknown IDs. Icon colors come from design-tokens; no remote assets or architecture dependencies are used. See [NOTICE](../../NOTICE) and bundled license text. The component preview includes neutral-dark technology states.
