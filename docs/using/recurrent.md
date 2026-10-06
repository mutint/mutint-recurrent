# Recurrent

**Recurrent**, in the sidebar's experiment section, lists the genes mutated in several
independent populations -- the usual first sign that a gene matters to the adaptation.

## What counts

A gene counts **once per population** that carries any mutation inside it or in its promoter.
So the same mutation found in two populations is two independent hits, two different mutations
in one gene in two populations are two, and a gene mutated twice in one population is one. A
mutation counts toward every gene it touches: a large deletion is a hit on each gene it
removes, and an intergenic mutation within 150 bp upstream of a gene's start is a hit on that
gene's promoter.

Mutations in the designated ancestor are left out. Your frequency filter is not applied here:
every mutation called present in a sample counts.

Set the **minimum** number of populations with the slider or the box; the box beside them shows
the most any gene reaches. The default is 2.

A deletion, amplification, conversion or inversion that crosses several genes is a hit on
each of them only when **Count mutations spanning multiple genes** is ticked. It is off by
default, so one event does not put a whole operon at the top of the table.

## The table

Genes down, samples across, in the order the Samples page lists them, each column colored by
its population. A cell holds one glyph per mutation that sample carries in that gene:

| glyph | mutation |
|---|---|
| circle | synonymous base substitution |
| square | nonsynonymous base substitution |
| tombstone | nonsense base substitution |
| inverted diamond | intergenic base substitution |
| diamond | base substitution in an RNA gene or pseudogene |
| triangle | small deletion (up to 50 bp) |
| inverted triangle | small insertion (up to 50 bp) |
| bowtie | mobile element insertion |
| inverted trapezoid | large deletion |
| trapezoid | large insertion or amplification |
| parallelogram | gene conversion or integration |
| barbell (two triangles pointing outward from a bar) | inversion |

A glyph is **solid** when breseq predicts the mutation inactivates the gene (a nonsense
substitution, a frameshift, a mobile element or a deletion in its first 80%), **outlined** when
it does not, and **gray** when it is in the promoter or in the last 20% of the gene, where
breseq never predicts inactivation. Hover a glyph for the mutation's details; click it to open
the genome browser at that position when the sample has reads.

The **Columns** menu adds the locus tag, the location and the description; the gene name is
always shown. **Export table** saves the rows showing as CSV, each cell naming its mutations,
or as an SVG drawing of the table with its legend.

## Gene plots

**Gene plots** draws each gene that reaches the minimum: the gene as an arrow in its genome
orientation, its upstream intergenic region shaded as the promoter, a little of the
neighbouring gene on each side, and one flag per mutation at its position -- a tick for a
point mutation or a mobile element above the gene, a bracket below it over the extent of a
large deletion, amplification, conversion or inversion -- carrying the same glyph, the mutation's description (the
base and amino-acid change for a substitution) and the populations it was found in. **Fit to width** draws every gene across the page; **Same scale** draws them all at one scale,
so a long gene is long and a short one short. **Download SVG** saves one plot as a vector
file for a figure, at whichever scale is showing.
