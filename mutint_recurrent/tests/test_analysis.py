"""The derivation: what counts, toward which gene, in which shade, and what a plot shows."""

from mutint_sample.models import Sample

from mutint_recurrent import glyphs
from mutint_recurrent.analysis import recurrent_genes
from mutint_recurrent.tests import fixture as fx


def by_name(data):
    return {gene["name"]: gene for gene in data["genes"]}


class CountingTestCase(fx.RecurrentFixture):
    # Three populations. geneA: the same nonsense SNP in populations 1 and 2, and a second,
    # different mutation in population 1 -- two independent hits, not three. geneB: the
    # promoter SNP in population 3 alone.
    SAMPLES = {
        "1-1-1-1": [fx.NONSENSE_A, fx.SYNONYMOUS_A],
        "1-2-1-1": [fx.NONSENSE_A],          # a second sample of population 1
        "2-1-1-1": [fx.NONSENSE_A],
        "3-1-1-1": [fx.PROMOTER_B],
    }

    def test_a_gene_counts_once_per_population(self):
        genes = by_name(recurrent_genes(self.experiment))
        self.assertEqual(2, genes["geneA"]["count"])
        self.assertEqual(["1", "2"], genes["geneA"]["populations"])
        self.assertEqual(1, genes["geneB"]["count"])
        self.assertNotIn("geneC", genes)

    def test_the_maximum_and_the_order(self):
        data = recurrent_genes(self.experiment)
        self.assertEqual(2, data["max_count"])
        self.assertEqual(["geneA", "geneB"], [g["name"] for g in data["genes"]])

    def test_the_cells_name_the_mutations_each_sample_carries(self):
        data = recurrent_genes(self.experiment)
        gene_a = by_name(data)["geneA"]
        first = data["samples"][0]
        self.assertEqual("1", first["population"])
        ids = gene_a["cells"][str(first["id"])]
        self.assertEqual(2, len(ids))
        self.assertEqual({"SNP"}, {data["mutations"][str(i)]["type"] for i in ids})
        self.assertEqual(4, len(data["samples"]))

    def test_the_ancestors_mutations_are_subtracted(self):
        ancestor = Sample.objects.get(population__name="2")
        self.experiment.set_ancestor(ancestor)
        genes = by_name(recurrent_genes(self.experiment))
        # The nonsense SNP is ancestral now: geneA is left with population 1's synonymous
        # SNP alone, and the ancestor is no longer a column.
        self.assertEqual(1, genes["geneA"]["count"])
        self.assertEqual(["1"], genes["geneA"]["populations"])
        self.assertNotIn(ancestor.id, [s["id"] for s in recurrent_genes(self.experiment)["samples"]])


class ShadeTestCase(fx.RecurrentFixture):
    SAMPLES = {
        "1-1-1-1": [fx.NONSENSE_A, fx.SYNONYMOUS_A, fx.TERMINAL_A, fx.FRAMESHIFT_A,
                    fx.PROMOTER_B, fx.SPANNING_AB, fx.INTERGENIC_FAR],
    }

    def setUp(self):
        super().setUp()
        self.data = recurrent_genes(self.experiment)
        self.genes = by_name(self.data)

    def mutation(self, start, mutation_type):
        for entry in self.data["mutations"].values():
            if entry["start"] == start and entry["type"] == mutation_type:
                return entry
        self.fail("no %s at %d" % (mutation_type, start))

    def test_a_nonsense_snp_is_solid_and_a_tombstone(self):
        m = self.mutation(130, "SNP")
        self.assertEqual(glyphs.TOMBSTONE, m["glyph"])
        self.assertEqual("solid", m["shades"]["ECK_0001"])

    def test_a_synonymous_snp_in_the_first_80_percent_is_an_outlined_circle(self):
        m = self.mutation(160, "SNP")
        self.assertEqual(glyphs.CIRCLE, m["glyph"])
        self.assertEqual("outline", m["shades"]["ECK_0001"])

    def test_a_synonymous_snp_in_the_last_20_percent_is_gray(self):
        self.assertEqual("gray", self.mutation(370, "SNP")["shades"]["ECK_0001"])

    def test_a_frameshift_is_solid(self):
        m = self.mutation(140, "DEL")
        self.assertEqual(glyphs.TRIANGLE, m["glyph"])
        self.assertEqual("solid", m["shades"]["ECK_0001"])

    def test_a_promoter_snp_counts_and_is_gray(self):
        m = self.mutation(950, "SNP")
        self.assertEqual(glyphs.DIAMOND_DOWN, m["glyph"])
        self.assertEqual("gray", m["shades"]["ECK_0002"])
        self.assertIn(m["id"], self.genes["geneB"]["mutations"])

    def test_a_deletion_clipping_two_genes_counts_for_both(self):
        m = self.mutation(350, "DEL")
        self.assertEqual(glyphs.TRAPEZOID_DOWN, m["glyph"])
        self.assertEqual({"ECK_0001", "ECK_0002"}, set(m["shades"]))
        # It removes the last 51 bp of geneA and the 3' 49 bp of geneB: the tail of each.
        self.assertEqual("gray", m["shades"]["ECK_0001"])
        self.assertEqual("gray", m["shades"]["ECK_0002"])
        self.assertIn(m["id"], self.genes["geneA"]["mutations"])
        self.assertIn(m["id"], self.genes["geneB"]["mutations"])

    def test_an_intergenic_snp_outside_every_promoter_counts_for_nothing(self):
        self.assertNotIn("geneC", self.genes)
        self.assertEqual({"geneA", "geneB"}, set(self.genes))

    def test_the_label_is_breseqs_own_words(self):
        m = self.mutation(130, "SNP")
        self.assertIn("G→A", m["label"])
        self.assertIn("W10*", m["annotation"])


class MultiGeneTestCase(fx.RecurrentFixture):
    SAMPLES = {"1-1-1-1": [fx.SPANNING_AMP, fx.AMP_IN_A]}

    def test_an_amplification_crossing_two_genes_is_marked_as_spanning(self):
        data = recurrent_genes(self.experiment)
        by_start = {m["start"]: m for m in data["mutations"].values()}
        self.assertTrue(by_start[350]["spans_genes"])
        self.assertFalse(by_start[110]["spans_genes"])
        # Both are in the payload; the page drops the spanning one unless asked.
        self.assertEqual({"geneA", "geneB"}, set(by_name(data)))


class ReferenceTestCase(fx.RecurrentFixture):
    SAMPLES = {"1-1-1-1": [fx.NONSENSE_A, fx.PROMOTER_B]}

    def setUp(self):
        super().setUp()
        self.data = recurrent_genes(self.experiment)
        self.genes = by_name(self.data)

    def test_the_gene_carries_its_coordinates_and_product(self):
        a = self.genes["geneA"]
        self.assertEqual(("test_ref", 101, 400, 1, "the first gene", "ECK_0001"),
                         (a["seq_id"], a["start"], a["end"], a["strand"], a["product"],
                          a["locus_tag"]))
        self.assertTrue(self.data["has_reference"])

    def test_the_window_of_a_plus_strand_gene(self):
        w = self.genes["geneA"]["window"]
        # No gene before it: the promoter runs from the contig's start; the window takes 300
        # bases (more than 15% of 300) into geneB after it.
        self.assertEqual([1, 100], w["promoter"])
        self.assertEqual(1, w["lo"])
        self.assertEqual(900, w["hi"])
        self.assertEqual(["geneB"], [n["name"] for n in w["neighbors"]])

    def test_the_window_of_a_minus_strand_gene(self):
        w = self.genes["geneB"]["window"]
        # Upstream of a minus-strand gene is to its right: the promoter is the whole
        # intergenic stretch up to geneC, and both neighbours show 300 bases.
        self.assertEqual([901, 1200], w["promoter"])
        self.assertEqual(101, w["lo"])
        self.assertEqual(1500, w["hi"])
        self.assertEqual(["geneA", "geneC"], [n["name"] for n in w["neighbors"]])
        self.assertEqual(2000, w["contig_length"])
