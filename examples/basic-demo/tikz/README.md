# TikZ-derived SNL demo asset

`higher-category.tex` is the authoritative, formula-bearing pure TikZ figure. It uses ordinary Computer Modern mathematics and traditional TikZ arrow styles.

Regenerate both checked-in artifacts with:

```bash
cd examples/basic-demo
npm run build:tikz
```

The build requires `latex`, TikZ/PGF, and `dvisvgm`.

- `generated/higher-category.full.svg` is the untouched visual baseline produced by `dvisvgm`; it still contains every formula as glyph paths.
- `generated/higher-category.template.svg` is derived from that file. The generator reads each formula's exact `dvisvgm` local bounding box, removes its glyph group, and inserts a contiguous empty `data-snl-slot` at the same center.
- In this explicitly monochrome TikZ pipeline, **every exact pure-white fill or stroke is a paper/background color key**. The generator turns each operation into an ordered transparent knockout; there is no intentional-white exception. Later ink remains able to paint over an earlier knockout.
- Traditional exact-black TikZ ink becomes `currentColor`, so the inline sanitized SVG inherits the actual Entry/host/VS Code foreground rather than consulting the operating-system color scheme.
- `src/demoPresets.ts` fills the slots with the corresponding real SNL child trees.

These transformations apply only to the extracted template. They do not alter the formula-bearing provenance SVG, add SNL syntax, or create a parallel persisted asset model. Do not hand-edit either generated SVG: edit the TikZ source and regenerate.
