# ui

Accessible Button, labeled IconButton tooltips, and a focus-trapped Modal using Radix primitives. Import styles.css and design-tokens in the host. Run pnpm storybook from the root to inspect controls. UI is independent of architecture semantics.

Controlled dialogs restore focus to their opener. `Tabs` supports roving keyboard focus, arrow keys and Home/End. `StatusBadge` documents evidence and assessment states in Storybook. Shared presentation never imports architecture contracts or engines.

`TechnologyIcon` renders tree-shaken local Simple Icons SVG paths and original infrastructure pictograms, with an accessible label when meaningful and a local fallback for unknown IDs. Icon colors come from design-tokens; no remote assets or architecture dependencies are used. See NOTICE and bundled license text. Storybook includes neutral-dark technology states.
