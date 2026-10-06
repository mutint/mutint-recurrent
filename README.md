# mutint-recurrent

The **Recurrent** page for [MutInt](https://github.com/mutint/mutint-core): the genes mutated
in several independent populations of an experiment, at `/recurrent/`.

A gene counts once per population carrying any mutation inside it or in its promoter -- the
same mutation in two populations and two different mutations in one gene are both two hits,
and a gene hit twice in one population is one. A slider sets the minimum; two views show the
genes that reach it:

- **Table** -- genes down, samples across, each cell a glyph for the mutation's type (circle
  for a synonymous substitution, tombstone for a nonsense one, bowtie for a mobile element,
  and so on), shaded by whether it is predicted to inactivate the gene: solid when it is,
  outlined when it is not, gray in the promoter or in the last 20% of the gene.
- **Gene plots** -- each gene drawn as an arrow in genome orientation with its upstream
  intergenic region shaded as the promoter, a little of each neighbouring gene, and a flag
  per mutation at its coordinate using the same glyphs. Each plot downloads as SVG.

Nothing is stored: the page derives its answer from the gene lists breseq's annotator writes
on every mutation, with the designated ancestor subtracted.

## Installing

Add it as a submodule of an assembled project and it registers itself -- no edits to
`config/settings.py` or `config/urls.py`:

```bash
git submodule add ../mutint-recurrent mutint-recurrent
```

MIT licensed. See [mutint-core](https://github.com/mutint/mutint-core) for the platform.
