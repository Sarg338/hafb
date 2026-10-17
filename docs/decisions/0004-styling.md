# ADR 0004 — Styling: CSS Modules over theme custom properties

- **Status:** Accepted (2026-10-08), S3.2.
- **Context:** CLAUDE.md §2 left "CSS modules or vanilla-extract" open for S3.2. Tailwind is ruled out.
  - The design must support whole-UI themes later (ADR 0003 amendment) without changing today's look.
  - Components need state-heavy, dense table styling.

## Decision

- **CSS Modules** (built into Vite: no dependency, no build plugin) for component styles: `Button.module.css` next to `Button.tsx`.
- **All design values come from theme custom properties** set on the root by `applyTheme()`:
  - Colour: `--c-*`, from ADR 0003.
  - Type, shape, density and motion: `--t-*`, `--s-*`, `--d-*` and `--m-*`, from `src/theme/tokens.ts`.
  - Component CSS uses `var(...)` for every colour, font family, font size, radius, rule style, row and control height, and duration. A source scan (`src/theme/sourceScan.test.ts`) enforces this for `src/ui/`.
- **Variant tokens.** Some theme choices are categorical, not numeric: column-header letter case and Available pill style. They're exposed as `data-*` attributes on the root (`data-pill="filled"`), and component CSS selects on them.
- **Ornament** (a theme's optional extra stylesheet) is injected as one `<style id="hafb-ornament">` element by `applyTheme()`. The built-in themes have none.

## Why not vanilla-extract

- It adds a Vite plugin and a build-time evaluation step, as dependencies that must be vetted.
- Its strength, typed tokens compiled to static CSS, fights *runtime* theme switching. Every theme would need to be compiled in, and user themes later couldn't be loaded as data.
- CSS Modules plus custom properties give scoped class names and runtime theming with nothing new installed.

## Consequences

- Class names are scoped per module. Shared visual grammar lives in tokens, not in global class names.
- The S3.1 mockup stylesheets (`src/design/*.css`) were moved onto the same tokens, with identical values. Phase 4 rebuilt those screens from the component library (`src/screens`, ADR 0007).
- Type safety for class names: CSS Modules types are `string | undefined` under `noUncheckedIndexedAccess`. The `cx()` helper accepts `undefined`, so no casts are needed.
