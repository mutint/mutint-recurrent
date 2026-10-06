"""A reference built so the annotator produces every case the page distinguishes.

One 2000 bp contig of A's, with three CDS and a few codons set by hand:

    geneA   101..400  +   codon 10 (128-130) TGG, codons 20 (158-160) and 90 (368-370) CTG
    geneB   601..900  -   promoter is 901..1050 (upstream of a minus-strand gene is to the right)
    geneC  1201..1500 +

So a G->A at 130 is a nonsense SNP in geneA (TGG->TGA), at 160 a synonymous one in its first
80% (CTG->CTA), and at 370 a synonymous one in its last 20%; a SNP at 950 is in geneB's
promoter; a 2 bp deletion at 140 frameshifts geneA; and a 300 bp deletion at 350 clips the
tail of geneA and the 3' end of geneB.

Samples are breseq folders imported through core's own importer, so the annotation on each
mutation is the one every real import gets. `write_samples` takes `{sample_name: gd_text}`.
"""

import shutil
import tempfile

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from mutint_experiment.models import Experiment
from mutint_import import breseq_folder
from mutint_import.tests import breseq_fixture

SEQ_ID = "test_ref"
LENGTH = 2000


def sequence():
    bases = ["A"] * LENGTH

    def put(position_1, text):
        bases[position_1 - 1:position_1 - 1 + len(text)] = list(text)
    put(128, "TGG")
    put(158, "CTG")
    put(368, "CTG")
    return "".join(bases)


GENES = (
    ("geneA", "ECK_0001", 101, 400, "+", "the first gene"),
    ("geneB", "ECK_0002", 601, 900, "-", "the second gene"),
    ("geneC", "ECK_0003", 1201, 1500, "+", "the third gene"),
)


def gff3(genes=GENES):
    lines = ["##gff-version 3", "##sequence-region\t%s\t1\t%d" % (SEQ_ID, LENGTH)]
    for name, tag, start, end, strand, product in genes:
        lines.append("\t".join([
            SEQ_ID, "test", "CDS", str(start), str(end), ".", strand, "0",
            "ID=%s;Name=%s;locus_tag=%s;product=%s" % (tag, name, tag, product)]))
    lines.append("##FASTA")
    lines.append(breseq_fixture.fasta_text([(SEQ_ID, sequence())]).rstrip("\n"))
    return "\n".join(lines) + "\n"


HEADER = "#=GENOME_DIFF\t1.0\n#=REFSEQ\t%s\n" % SEQ_ID


def gd(*lines):
    """A .gd of the given mutation lines, numbered in order."""
    out = [HEADER.rstrip("\n")]
    for number, line in enumerate(lines, 1):
        out.append("%s\t%d\t." % (line[0], number) + "\t" + "\t".join(str(x) for x in line[1:]))
    return "\n".join(out) + "\n"


NONSENSE_A = ("SNP", SEQ_ID, 130, "A", "frequency=1")
SYNONYMOUS_A = ("SNP", SEQ_ID, 160, "A", "frequency=1")
TERMINAL_A = ("SNP", SEQ_ID, 370, "A", "frequency=1")
FRAMESHIFT_A = ("DEL", SEQ_ID, 140, 2, "frequency=1")
PROMOTER_B = ("SNP", SEQ_ID, 950, "G", "frequency=1")
SPANNING_AB = ("DEL", SEQ_ID, 350, 300, "frequency=1")
INTERGENIC_FAR = ("SNP", SEQ_ID, 1700, "G", "frequency=1")
SNP_X = ("SNP", SEQ_ID, 500, "G", "frequency=1")    # inside geneX, in OverlapTestCase's layout
SNP_Y = ("SNP", SEQ_ID, 200, "G", "frequency=1")    # inside geneY (and geneA) there
SPANNING_AMP = ("AMP", SEQ_ID, 350, 300, 2, "frequency=1")   # duplicates the end of geneA and of geneB
AMP_IN_A = ("AMP", SEQ_ID, 110, 30, 2, "frequency=1")        # inside geneA alone


class RecurrentFixture(TestCase):
    """Import `SAMPLES` (`{name: [mutation lines]}`) as breseq folders into one experiment."""

    SAMPLES = {}
    GENES = GENES   # a test class may lay out its own genes

    def setUp(self):
        self.user = User.objects.create(username="tester", email="t@e.com",
                                        is_active=True, is_staff=True)
        self.client.force_login(self.user)
        self.drop = tempfile.mkdtemp()
        self.store = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.drop, True)
        self.addCleanup(shutil.rmtree, self.store, True)
        patcher = override_settings(MUTINT_STORE_DIR=self.store)
        patcher.enable()
        self.addCleanup(patcher.disable)
        from mutint_import import annotation
        annotation.clear_cache()
        self.addCleanup(annotation.clear_cache)
        for name, lines in self.SAMPLES.items():
            breseq_fixture.write_sample(
                self.drop, name, sequences=[(SEQ_ID, sequence())], gd_text=gd(*lines),
                gff3_override=gff3(self.GENES))
        breseq_folder.import_breseq_folders(
            self.drop, project_name="P", experiment_name="E", owner_name="tester")
        self.experiment = Experiment.objects.get()
