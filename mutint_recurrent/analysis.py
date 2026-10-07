"""The derivation behind the Recurrent page: which genes were hit in how many populations.

**A gene counts once per population**, whatever was found there -- the same mutation in two
populations is two independent hits, two different mutations in one population are one, and
the same mutation in two samples of one population is one. That is `count` below, and the
page's minimum is applied to it.

**A mutation counts toward every gene it touches**: the union of the three gene lists breseq's
annotator writes on it -- `genes_inactivated`, `genes_overlapping` and `genes_promoter` -- so
a deletion across four genes is a hit on each of the four and an intergenic SNP between two
divergent promoters is a hit on both. One exception: a deletion, amplification, conversion,
integration or inversion crossing more than one gene (`MULTI_GENE_TYPES`) is marked
`spans_genes`, and the page counts it only when asked -- a region removed, duplicated or
inverted whole says less about any one gene inside it than a mutation that lands in it. Those lists are read off `Mutation.annotation`, which
every import path fills (see **breseq's gene lists are columns, not data** in mutint-core's
CLAUDE.md); nothing is re-annotated here.

**The shade is decided per (mutation, gene)**, because one deletion can knock out one gene and
merely clip the tail of the next: a gene in `genes_inactivated` is `solid`; one in
`genes_promoter` is `gray`; one in `genes_overlapping` is `gray` when the whole of the overlap
lies in the gene's last 20% -- the region breseq never calls inactivating,
`INACTIVATING_OVERLAP_FRACTION` -- and `outline` otherwise. The 20% test reads the stored
reference, which is also where a gene's coordinates, product and neighbours come from; an
experiment whose reference cannot be read still gets its counts and glyphs, with no
coordinates, no products and no plots.

Everything is `values`-shaped and nothing is stored: the page reads the result of one request.
The calls come from `calls_for_samples`, which subtracts the designated ancestor; the
reader's frequency filter is deliberately **not** applied -- every present call counts.
"""

import collections
import math
import re

from mutint_import.annotate.annotator import INACTIVATING_OVERLAP_FRACTION, PROMOTER_DISTANCE
from mutint_import.annotate.display import gene_list_names, text_from_html
from mutint_import.annotation import reference_sequences_for
from mutint_sample.breseq_report import describe_mutation
from mutint_sample.models import Mutation
from mutint_sample.mutation_matrix import PALETTE_SIZE, palette_indexes, sample_page_url
from mutint_sample.util import calls_for_samples, get_ordered_sample_dict

from mutint_recurrent.glyphs import GRAY, OUTLINE, SOLID, glyph_for, size_change

#: The three lists, strongest first: a gene named in two of them -- a split-location gene a
#: deletion removes one segment of and clips the other -- takes the first.
GENE_LISTS = (
    ("genes_inactivated", "locus_tags_inactivated"),
    ("genes_overlapping", "locus_tags_overlapping"),
    ("genes_promoter", "locus_tags_promoter"),
)

#: The plot's flanking: this many bases beyond the gene on its 3' side and beyond the promoter
#: region on its 5' side, so nothing that counts is ever off the drawing. The reader sets it,
#: from 0 up to `MAX_FLANK_BASES`; the server sends every gene within the largest flank.
DEFAULT_FLANK_BASES = 300
MAX_FLANK_BASES = 5000

NO_POPULATION = "(no population)"

#: Mutation types that, crossing more than one gene, count only when the page is asked to.
MULTI_GENE_TYPES = frozenset(("DEL", "AMP", "CON", "INT", "INV"))


def genes_touched(annotation):
    """`[(name, locus_tag, list_key)]` for every gene a mutation's annotation names, each once.

    The `genes_*` and `locus_tags_*` lists are parallel -- breseq writes one entry per gene in
    both, an empty string for a gene with no locus tag -- so the two are zipped; a list whose
    locus tags do not line up (a hand-written annotation) falls back to names alone.
    """
    seen = {}
    for names_key, tags_key in GENE_LISTS:
        names = gene_list_names(annotation.get(names_key))
        tags = str(annotation.get(tags_key) or "").split(",")
        if len(tags) != len(names):
            tags = [""] * len(names)
        for name, tag in zip(names, tags):
            key = gene_key(name, tag)
            if key not in seen:
                seen[key] = (name, tag, names_key)
    return list(seen.values())


def gene_key(name, locus_tag):
    """What a gene is keyed by: its locus tag where it has one, its name otherwise -- so two
    copies of `insA` stay two genes when the reference tags them and fold into one when it
    does not."""
    return locus_tag or name


def terminal_only(feature, start, end):
    """Whether a mutation covering `[start, end]` touches only the last 20% of `feature`.

    The index is counted from the gene's 5' end over its spliced sequence, as the annotator
    counts it; the test is on the *smallest* index any overlapping base has, so a mutation
    reaching into the first 80% from either side is not terminal. Written here rather than
    borrowed from the annotator's `hits_start_region`, whose not-found fallthrough makes a
    gene wholly inside a mutation read as terminal -- for this question a wholly covered gene
    starts at index 1.
    """
    length = feature.get_length()
    if not length:
        return False
    boundary = math.floor(INACTIVATING_OVERLAP_FRACTION * length)
    lowest = None
    for location in feature.locations:
        low, high = max(start, location.start_1), min(end, location.end_1)
        if low > high:
            continue
        for position in (low, high):
            index, strand = feature.genomic_position_to_index_strand_1(position)
            if strand == 0:
                continue
            lowest = index if lowest is None else min(lowest, index)
    return lowest is not None and lowest > boundary


def shade_for(list_key, feature, start, end):
    if list_key == "genes_inactivated":
        return SOLID
    if list_key == "genes_promoter":
        return GRAY
    if feature is not None and terminal_only(feature, start, end):
        return GRAY
    return OUTLINE


class GeneIndex:
    """The reference's genes by locus tag and by name, and each one's neighbours.

    `features` holds every gene-typed feature (`Feature.is_gene()`) of every contig; repeats
    are not genes and are left out. Built once per request from `reference_sequences_for`,
    which is memoised per process.
    """

    def __init__(self, references):
        self.references = references
        self.by_tag = {}
        self.by_name = {}
        self.contig_of = {}
        if references is None:
            return
        for seq_id in references:
            for feature in references[seq_id].features:
                if not feature.is_gene() or not feature.locations:
                    continue
                self.contig_of[id(feature)] = seq_id
                if feature.locus_tag:
                    self.by_tag.setdefault(feature.locus_tag, feature)
                if feature.name:
                    self.by_name.setdefault(feature.name, feature)

    @property
    def available(self):
        return self.references is not None

    def find(self, name, locus_tag):
        if locus_tag and locus_tag in self.by_tag:
            return self.by_tag[locus_tag]
        return self.by_name.get(name)

    def seq_id_of(self, feature):
        return self.contig_of.get(id(feature))

    def span(self, feature):
        """`(start, end, strand)` over every sublocation, 1-based inclusive."""
        start = min(loc.start_1 for loc in feature.locations)
        end = max(loc.end_1 for loc in feature.locations)
        return start, end, feature.locations[0].strand

    def describe(self, feature):
        start, end, strand = self.span(feature)
        return {
            "seq_id": self.seq_id_of(feature),
            "start": start,
            "end": end,
            "strand": strand,
            "product": feature.product or "",
            "type": feature.type,
        }

    def plot_window(self, feature):
        """What the gene's plot can show: its promoter band and every gene near it.

        The promoter band is `PROMOTER_DISTANCE` bases upstream of the start codon -- strand
        decides which side -- clipped where a neighbouring gene is nearer and absent where
        that neighbour covers the start codon: the region a mutation counts in, the
        annotator's own rule, rather than the whole intergenic stretch (581 bp on gltB).

        `neighbors` is every other gene location within `MAX_FLANK_BASES` past the gene and
        its promoter on either side, in genome order, overlapping ones included -- 758
        adjacent pairs in REL606 overlap, and the first version took only a neighbour lying
        clear of the gene, so it drew the gene beyond an overlapping one with a phantom gap
        and promoter between. The page decides the window from the reader's flanking and
        draws whichever of these fall in it.
        """
        seq_id = self.seq_id_of(feature)
        sequence = self.references[seq_id]
        contig_length = len(sequence)
        start, end, strand = self.span(feature)

        # The nearest gene edges either side, overlapping or not, clip the promoter band.
        previous_edge = following_edge = None
        for location in sequence.gene_locations:
            if location.feature is feature:
                continue
            if location.start_1 < start and (previous_edge is None or location.end_1 > previous_edge):
                previous_edge = location.end_1
            if location.end_1 > end and (following_edge is None or location.start_1 < following_edge):
                following_edge = location.start_1

        if strand == -1:
            promoter = (end + 1, min(following_edge - 1 if following_edge else contig_length,
                                     end + PROMOTER_DISTANCE))
        else:
            promoter = (max(previous_edge + 1 if previous_edge else 1, start - PROMOTER_DISTANCE),
                        start - 1)
        if promoter[0] > promoter[1]:
            promoter = None

        reach = MAX_FLANK_BASES + PROMOTER_DISTANCE
        lo, hi = max(1, start - reach), min(contig_length, end + reach)
        neighbors = [{
            "name": location.feature.name or location.feature.locus_tag or "",
            "start": location.start_1,
            "end": location.end_1,
            "strand": location.strand,
        } for location in sequence.gene_locations
            if location.feature is not feature and location.end_1 >= lo and location.start_1 <= hi]
        return {
            "contig_length": contig_length,
            "promoter": list(promoter) if promoter else None,
            "neighbors": neighbors,
        }



_CODON_CHANGE = re.compile(r"\s*\([ACGTNacgtn]+\u2192[ACGTNacgtn]+\)\s*$")


def _label(mutation):
    """The mutation's words for a flag: breseq's Mutation column, and for a base substitution
    its amino-acid change alone -- `I175F`, without the codon change breseq writes after it.
    An indel or a mobile element gets no annotation at all: `coding (147-149/1233 nt)` says
    where it is, which the plot already shows."""
    row = describe_mutation(mutation)
    text = text_from_html(row.get("mutation", "")) or mutation.sequence_change or ""
    annotation = ""
    if mutation.mutation_type == "SNP":
        annotation = text_from_html(row.get("annotation", "")) or mutation.protein_change or ""
        annotation = _CODON_CHANGE.sub("", annotation)
    return text, annotation


def recurrent_genes(experiment):
    """Everything the page draws, as plain dicts and lists (it travels as JSON).

    Returns `{samples, genes, mutations, max_count, has_reference}`: the samples in column
    order, one entry per gene any present non-ancestral call touches (sorted by count, then
    reference and position, each carrying its coordinates and plot window where the
    reference knows it), the mutations those entries refer to by id, the largest count, and
    whether the reference could be read.
    """
    sample_dict = get_ordered_sample_dict(experiment.id)
    index = GeneIndex(reference_sequences_for(experiment))

    population_of, samples = {}, []
    palettes = palette_indexes([sample.population_id for sample in sample_dict.values()])
    # Treatments take the same eight colors in sorted order, as the matrix gives them.
    treatments = sorted({sample.treatment for sample in sample_dict.values() if sample.treatment})
    treatment_palette = {treatment: i % PALETTE_SIZE for i, treatment in enumerate(treatments)}
    for palette, sample in zip(palettes, sample_dict.values()):
        name = sample.population.name if sample.population_id else NO_POPULATION
        population_of[sample.id] = name
        samples.append({
            "id": sample.id,
            "label": sample.label,
            "url": sample_page_url(sample, experiment),
            "population": name,
            "treatment": sample.treatment or "",
            "palette": palette,
            "treatment_palette": treatment_palette.get(sample.treatment),
            "bam_stored": bool(sample.bam_stored),
        })

    carriers = collections.defaultdict(list)   # mutation id -> sample ids, column order
    if sample_dict:
        column = {sample_id: i for i, sample_id in enumerate(sample_dict)}
        pairs = (calls_for_samples(list(sample_dict), experiment.id)
                 .filter(present=True)
                 .values_list("sample_id", "mutation_id")
                 .iterator(chunk_size=2000))
        seen = set()
        for sample_id, mutation_id in pairs:
            if (sample_id, mutation_id) not in seen:
                seen.add((sample_id, mutation_id))
                carriers[mutation_id].append(sample_id)
        for sample_ids in carriers.values():
            sample_ids.sort(key=column.get)

    mutations = {}
    genes = {}
    for mutation in Mutation.objects.filter(id__in=list(carriers)).order_by("id"):
        touched = genes_touched(mutation.annotation or {})
        if not touched:
            continue

        start = mutation.start_position
        end = mutation.end_position or start
        text, annotation = _label(mutation)
        browse_from = next((s for s in carriers[mutation.id] if sample_dict[s].bam_stored), None)
        entry = {
            "id": mutation.id,
            "type": mutation.mutation_type,
            "glyph": glyph_for(mutation.mutation_type, mutation.snp_type,
                               mutation.mutation_category, size_change(mutation.genome_diff)),
            "seq_id": mutation.seq_id,
            "start": start,
            "end": end,
            "label": text,
            "annotation": annotation,
            "samples": carriers[mutation.id],
            "populations": sorted({population_of[s] for s in carriers[mutation.id]}),
            "shades": {},
            # A structural mutation touching more than one gene; counted only when asked.
            "spans_genes": mutation.mutation_type in MULTI_GENE_TYPES and len(touched) > 1,
            "url": ("/mutations/browse?mutation_id=%d&sample_id=%d&samples=mutant"
                    % (mutation.id, browse_from)) if browse_from is not None else "",
        }
        mutations[mutation.id] = entry
        for name, tag, list_key in touched:
            key = gene_key(name, tag)
            feature = index.find(name, tag)
            entry["shades"][key] = shade_for(list_key, feature, start, end)
            gene = genes.get(key)
            if gene is None:
                gene = genes[key] = {
                    "key": key, "name": name, "locus_tag": tag,
                    "seq_id": mutation.seq_id, "start": None, "end": None, "strand": 0,
                    "product": "", "type": "", "window": None,
                    "mutations": [], "cells": collections.defaultdict(list),
                    "populations": set(),
                }
                if feature is not None:
                    gene.update(index.describe(feature))
                    gene["window"] = index.plot_window(feature)
            gene["mutations"].append(mutation.id)
            for sample_id in carriers[mutation.id]:
                gene["cells"][sample_id].append(mutation.id)
                gene["populations"].add(population_of[sample_id])

    rows = []
    for gene in genes.values():
        gene["populations"] = sorted(gene["populations"])
        gene["count"] = len(gene["populations"])
        gene["cells"] = {str(sample_id): ids for sample_id, ids in gene["cells"].items()}
        rows.append(gene)
    rows.sort(key=lambda g: (-g["count"], g["seq_id"] or "", g["start"] or 0, g["name"]))

    return {
        "samples": samples,
        "genes": rows,
        "mutations": {str(mutation_id): entry for mutation_id, entry in mutations.items()},
        "max_count": max((g["count"] for g in rows), default=0),
        "has_reference": index.available,
        # The plot's rules, so the page cannot drift from the derivation.
        "promoter_distance": PROMOTER_DISTANCE,
        "default_flank": DEFAULT_FLANK_BASES,
        "max_flank": MAX_FLANK_BASES,
    }

