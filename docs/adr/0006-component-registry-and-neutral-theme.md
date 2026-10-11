# 0006 — Infrastructure registry and neutral surfaces

Status: accepted.

Context: selecting a generic database and then choosing its engine obscures concrete technology identity. Category-only icons make technologies difficult to distinguish. Existing dark surfaces include tinted colors.

Decision: keep semantic categories vendor-neutral; extend embedded definitions with optional typed catalog identity, taxonomy, declarative configuration rules and resource bindings. Put built-in infrastructure and validated JSON packs in component-registry. Shared UI owns local SVG presentation without architecture imports. Preserve legacy definitions and expose only explicit lossless conversions.

Use a default neutral dark theme: pure-black canvas, zinc app/panel/hover surfaces, border separation, high-contrast text and indigo selection. Keep light tokens and an origin-specific preference applied before hydration. Technology and status colors remain semantic accents.

Consequences: native 1.1 remains backward compatible with existing optional catalog-free definitions. Importing packs is undoable and portable. Performance models still require evidence; provider identity does not justify capacity claims. Theme preferences and favorites are optional local preferences, separate from transactional architecture data.

Alternatives: hardcoded sidebar products; replacing the semantic model with provider objects; automatic legacy conversion; runtime remote icons. These weaken portability, evidence discipline or compatibility.
