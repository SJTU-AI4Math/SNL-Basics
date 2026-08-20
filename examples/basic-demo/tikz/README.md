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
- `src/demoPresets.ts` fills those slots with the corresponding real SNL child trees.

Do not hand-edit either generated SVG. Edit the TikZ source and regenerate.
