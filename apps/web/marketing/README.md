# Static marketing build

Run `node marketing/build.mjs [output-directory]` from `apps/web`. The default
output is `dist`. Vite runs this after the SPA build and regenerates the dev
output when marketing sources change. Each page generator also accepts an
output directory as its first argument. No generated HTML belongs beside source.

`motion/hero.mjs`, `sections/engineering-site.mjs` and `sections/learning2.mjs`
retain the approved presentation. Their closure includes `object/`, the seven
MIT kit modules and license, the inline turn helper, motion styles/timeline/sound,
the shared section helpers, and the `engineer` and `late` captured stages.
Learning renders its miniature live; `learn` and `healthy` stages are unused.
The recording in `data/` is the supplied captured run, not a new engine run.

Inter Tight and Geist Mono retain their original bytes, family names, variable
weights and font-display settings. `assets.mjs` emits one SHA-256-named file per
font and copies both OFL notices. `seo.mjs` adds metadata without changing the
body, deriving FAQ structured data from each page's rendered questions/answers.

This directory is build-time presentation tooling, outside `src`. The existing
reality scanner audits production TypeScript roots, so it does not classify this
JavaScript/SVG/static-data closure as engine physics. ESLint's existing rules
apply to TypeScript; its default JavaScript parsing still covers these modules.
No gate exclusion or engine identity classification is changed. Import-boundary
checks include these modules and keep their Node imports outside browser source.

For visual verification, run `scripts/visual-proof.mjs` with Node from a directory
containing Playwright, pngjs and pixelmatch. Pass the reference directory, built
site URL and evidence output directory. See the script's usage comment. Reference
HTML must come from the unchanged approved generators before integration.
