# design-tokens

Semantic CSS variables for light/dark surfaces, text, focus, status and architecture categories. The web app defaults to neutral dark: #000000 canvas, #09090B app, #18181B panels, #27272A elevated/hover surfaces, #3F3F46 borders/grid and #FAFAFA primary text. Secondary text uses #A1A1AA for contrast; selection uses #6366F1 and visible focus uses #818CF8. Light remains complete.

Set data-theme on the root. A saved local preference is applied before hydration and switching requires no reload. Technology icon colors live in technology.css; structural surfaces never derive from technology colors. Inter and IBM Plex Mono are bundled locally. Reduced motion disables decorative transitions and animations.
