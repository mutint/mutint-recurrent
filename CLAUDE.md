# CLAUDE.md — mutint-recurrent

The **Recurrent** page, at `/recurrent/` in the sidebar's experiment section: which genes were
mutated in several *independent* populations, by what kind of mutation, and whether those
mutations are predicted to knock the gene out. It is the gene-level question Compare's
Convergent set answers per mutation, and the first figure of an ALE paper -- a gene drawn as an
arrow with each mutation flagged above it.

One page, an About section, no models, no migrations, nothing stored. `apps.py` registers the
routes, the nav entry (by `url_name`, so a half-install leaves no dead link) and the About
section; `analysis.py` is the derivation; `glyphs.py` the type-to-glyph rule; the page's two
scripts draw the two views from one JSON payload.

## The counting rule

**A gene counts once per population.** `count` is the number of distinct populations in which
any sample carries any mutation touching the gene. The same mutation in two populations is two
independent hits; two different mutations in one population are one; the same mutation in two
samples of one population is one. Samples with no population are one group, `(no population)`.

**A mutation counts toward every gene it touches**: the union of `genes_inactivated`,
`genes_overlapping` and `genes_promoter` on `Mutation.annotation`, read with the parallel
`locus_tags_*` lists so two copies of `insA` stay two genes when the reference tags them. A
deletion across four genes is a hit on each; an intergenic SNP between two divergent promoters
is a hit on both; an intergenic SNP outside every promoter (150 bp, breseq's rule) counts for
nothing. Nothing is re-annotated here -- the lists are the ones every import writes, so a
mutation imported before the experiment had a reference touches no gene until `./mutint
reannotate`.

**A mutation spanning multiple genes counts only when asked.** A large deletion is a hit on
every gene it removes, and a duplication or inversion on every gene inside it, which can put
a whole operon at the top of the table on the strength of one event. The **Count mutations
spanning multiple genes** box, off by default and remembered as `recurrent.span_deletions`,
decides; the server marks such a mutation `spans_genes` (a DEL, AMP, CON, INT or INV touching
more than one gene, `MULTI_GENE_TYPES`) and `recurrent.js` recounts every gene's populations
from its cells with those mutations dropped, so the box costs no request. The server's own
counts are what the page shows with the box ticked.

**The reader's frequency filter is deliberately not applied.** Every present call counts. The
ancestor *is* subtracted, through `calls_for_samples`, as everywhere else. The page renders no
`{% view_filter_summary %}` line saying either -- it was asked off -- so the introduction's
sentence is the only statement of the rule.

## The shade rule

Decided per (mutation, gene), because one deletion can inactivate one gene and clip the tail of
the next:

| the gene is in | shade | meaning |
|---|---|---|
| `genes_inactivated` | `solid` | breseq predicts it knocked out |
| `genes_promoter` | `gray` | in the promoter |
| `genes_overlapping`, wholly in the last 20% | `gray` | the region breseq never calls inactivating |
| `genes_overlapping`, otherwise | `outline` | no inactivation predicted |

`terminal_only` does the 20% test against the stored reference with `Feature.
genomic_position_to_index_strand_1`, on the *smallest* stranded index any overlapping base
has. It is written here rather than borrowed from the annotator's `hits_start_region`, whose
not-found fallthrough reads a gene wholly inside a mutation as terminal; for this question a
wholly covered gene starts at index 1 and an AMP over it is `outline`. With no readable
reference every overlapping gene is `outline`, and the page has no coordinates, no products
and no plots -- the counts and glyphs still work.

## The glyphs

`glyph_for(mutation_type, snp_type, mutation_category, size_change)` reads the promoted
columns, never a display string. `GLYPHS` in `glyphs.py` is the table and the legend's order;
`_glyphs.html` is the `<symbol>` sprite the table cells, the legend and the plots all `<use>`,
and `test_glyphs` asserts the two name the same set.

- SNP by `functional_change_bucket(snp_type)`: synonymous circle, nonsynonymous square,
  nonsense tombstone, intergenic inverted diamond, **noncoding or pseudogene upright diamond**
  (the request named no glyph for these; the diamond keeps them beside intergenic).
- DEL and INS by `mutation_category`'s 50 bp cutoff: triangle / inverted triangle small,
  inverted trapezoid / trapezoid large. **AMP follows INS**, so a small AMP (`small_indel`) is
  the small-insertion glyph.
- MOB bowtie; CON **and INT** parallelogram; **INV barbell** (two triangles pointing outward from a bar) -- the last two are this plugin's
  choices, the request having named neither.
- **SUB by its net size change**: longer is an insertion, shorter a deletion, equal a square.

The shades are CSS classes on the referencing `<svg>` (or the `<g>` round a plot flag), so the
symbols carry no paint of their own.

## The page

`views.recurrent` is the example plugin's shape plus the `ValueError` → 403 branch
`docs/plugin/views-and-urls.md` asks for. The derivation travels whole as `json_script`
(`recurrent-data`): every gene with a count of at least one, sorted by count then position,
each with its cells (`{sample id: [mutation ids]}`), coordinates and `window`; and every
mutation referred to, with its glyph, its `shades` per gene key, its label, and a
genome-browser URL when a carrying sample has reads. **The label is breseq's Mutation column
through `text_from_html`, and for a base substitution the amino-acid change alone** --
`I175F`, the codon change breseq writes after it stripped by `_CODON_CHANGE`; an indel or a
mobile element gets no annotation, because `coding (147-149/1233 nt)` says where it is and
the plot already shows that. `recurrent.js` filters by the minimum in the browser, as Compare decides in
the browser, so the slider costs no request.

**The minimum defaults to 2**, clamped to the maximum any gene reaches, and is remembered per
experiment (`recurrent.min.<exp>`); the view (`recurrent.view`) and the Columns choice
(`recurrent.columns`, `{hidden, shown}` read with `columnHiddenSet` like the matrix's) are
remembered per reader. The slider and the number box are one value, synced the way
mutint-phylogeny's zoom pair is: the slider redraws live on `input`, the box commits on change
or Enter, and the box is never rewritten while it has focus. The read-only box beside them is
the maximum, which the request asked to show.

**The table draws no DataTable** and sorts nothing. It scrolls in a box the script sizes to
the window, with the header stuck to the top and the gene columns stuck to the left -- the
matrix's shape -- each pinned column's `left` written by the script as the sum of the shown
ones before it, since `position: sticky` cannot add them up. The count column (headed #) is first, then Gene, then
the optional columns. Sample headers are vertical and colored by population through the same
eight colors `breseq_table.css` gives the matrix, copied into `recurrent.css` because core's
rules are scoped to `.mutation-matrix-table`; the index comes from core's `palette_indexes`,
and the color stays on the header -- the cells are plain. **Color samples by** switches the
headers between the population's color, the treatment's (sorted treatments over the same
eight, `treatment_palette` on each sample) and the header grey, one class on the table as
the matrix's own boxes do, remembered as `recurrent.column_color`; the SVG export follows it. The Columns menu reaches the plots
too: a shown column's words join each plot's heading.

**Each plot is plain SVG built by `recurrent_plot.js`** -- rect, path, line, text and `<use>`
of the sprite -- in genome orientation: the x axis is the gene's `window`, the gene a rectangle
pointed at its 3' end, the whole upstream intergenic region shaded and labelled `promoter`,
and the nearest gene each side drawn pale as far as the window reaches (200 bases or a tenth
of the gene into each, `GeneIndex.plot_window`). **A point mutation is a pole to a lane above the
gene** ending in its glyph with the label beside it -- a base substitution, a small indel,
and a mobile element, which is drawn at its insertion point rather than over its target-site
duplication. **A large mutation -- a large deletion, amplification, conversion or inversion -- is a
bracket *below* the gene over its extent**, with the glyph and label beside the bracket's
middle and the end ticks dropped where it leaves the window. Lanes are packed
greedily outwards from the gene over each flag's *measured* extent (a canvas `measureText`,
as `mutation_matrix_svg.js` measures): a flag takes the lowest lane where its label fits to
the right of the glyph, or failing that to the left, before moving up a lane, so labels flip
left to stay on a lane rather than stacking. Every pole is drawn before every label and each
label sits on a white box, so a higher lane's pole passes behind the words it crosses rather
than through them.
The plots are grouped under a heading per count -- *Genes with 7 recurrent mutations* -- rather than
each plot repeating it. **Population labels** hides the population names on every flag (and the bar before them),
or draws them black, colored by the population's own palette index (the table's header
colors), or by its treatment (the treatment its first sample carries), remembered as
`recurrent.color`; a hidden name is still in the flag's hover title.
**Plot scale**, Fit to width / Same scale (`recurrent.scale`), chooses whether every gene fills the box or
all of them share one pixels-per-base, the widest window filling the box and the rest drawn
narrower, so the plots and the SVGs downloaded from them compare gene lengths.
**Export table** (CSV or SVG, table view only): the CSV is one row per shown gene, the shown
columns, then a cell per sample naming each mutation with its glyph's words and its shade; the
SVG is the table drawn (`tableSvg`) with the legends beneath. **Every SVG file starts with an
XML declaration naming UTF-8 and names Arial first** (`serialize`, `FILE_FONT_FAMILY`):
without the declaration Illustrator read the arrows and the delta as boxes, and Illustrator
substitutes nothing per glyph, so the first font it has must carry them -- Arial does where
its Helvetica does not.
**Download SVG** serialises the drawing with the sprite's symbols and the shade rules inlined
and the page's two legend boxes drawn beneath it (`legendRows`, read off the page's own
legend DOM so the two cannot list different glyphs), so the file stands alone.

## Tests

```bash
cd mutint && ./mutint test mutint_recurrent
```

Before the plugin is in `mutint/.gitmodules`, or to run uncommitted root-checkout edits, run
from mutint-core with a settings module that adds the app, as mutint-example does:

```bash
cd mutint-core
cat > /tmp/recurrent_settings.py <<'PY'
from config.settings_local import *  # noqa: F401,F403
INSTALLED_APPS = INSTALLED_APPS + ["mutint_recurrent"]
PY
DJANGO_SETTINGS_MODULE=recurrent_settings PYTHONPATH=/tmp:../mutint-recurrent ./mutint test mutint_recurrent
```

`tests/fixture.py` is a 2000 bp reference with three CDS and a few codons set by hand so the
real annotator produces every case: a nonsense SNP, a synonymous SNP in the first 80% and one
in the last 20%, a frameshift, a promoter SNP upstream of a minus-strand gene, a deletion
clipping two genes. Samples are breseq folders through core's importer, so the annotation
under test is the one a real import gets. 30 tests.

The plots are not under test beyond the JSON they are drawn from; they were checked by
rendering the specificity example (31 clones, known answer *nadR*, *hslU*, *mrdA*, *gltB*)
through the test client and screenshotting it headlessly.
