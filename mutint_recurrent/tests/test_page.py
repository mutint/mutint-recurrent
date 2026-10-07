"""The page: its header, its sidebar entry, its payload, and who may see it."""

import json
import re

from django.contrib.auth.models import User

from mutint_recurrent.tests import fixture as fx


def payload(html):
    match = re.search(r'<script id="recurrent-data" type="application/json">(.*?)</script>',
                      html, re.S)
    return json.loads(match.group(1)) if match else None


class PageTestCase(fx.RecurrentFixture):
    SAMPLES = {"1-1-1-1": [fx.NONSENSE_A], "2-1-1-1": [fx.NONSENSE_A, fx.PROMOTER_B]}

    def get(self):
        return self.client.get("/recurrent/", {"experiment_id": self.experiment.id})

    def test_the_page_renders_under_the_experiments_header(self):
        response = self.get()
        self.assertEqual(200, response.status_code)
        html = response.content.decode()
        self.assertIn('class="mutint-experiment-name">E</span></b> <span class="mutint-header-sep">&raquo;</span> Recurrent', html)
        self.assertIn("promoter region (150 bp upstream of the start codon)", html)
        self.assertIn('id="recurrent-table"', html)
        self.assertEqual(2, html.count('class="mr-sample '))

    def test_the_payload_holds_the_genes(self):
        data = payload(self.get().content.decode())
        self.assertEqual(["geneA", "geneB"], [g["name"] for g in data["genes"]])
        self.assertEqual(2, data["max_count"])
        self.assertTrue(data["has_reference"])

    def test_the_scripts_and_the_sprite_are_in_the_rendered_page(self):
        html = self.get().content.decode()
        self.assertIn("mutint_recurrent/recurrent.js", html)
        self.assertIn("mutint_recurrent/recurrent_plot.js", html)
        self.assertIn("mutint_recurrent/recurrent.css", html)
        self.assertIn('<symbol id="glyph-tombstone"', html)
        self.assertIn('data-role="columns"', html)
        self.assertIn('data-role="span-deletions"', html)
        self.assertEqual(2, html.count('class="mr-legend-box"'))
        for key in ("locus_tag", "location", "product"):
            self.assertIn('data-value="%s"' % key, html)
        self.assertIn("Gene location", html)
        self.assertLess(html.index('data-key="count"'), html.index('data-key="gene"'))

    def test_the_sidebar_and_the_header_bar_carry_the_entry(self):
        html = self.get().content.decode()
        self.assertIn('href="/recurrent/?experiment_id=%d">Recurrent</a>'
                      % self.experiment.id, html)

    def test_the_default_minimum_is_two_where_any_gene_reaches_it(self):
        html = self.get().content.decode()
        self.assertIn('data-default-minimum="2"', html)

    def test_without_an_experiment_the_page_says_so(self):
        response = self.client.get("/recurrent/")
        self.assertEqual(200, response.status_code)
        self.assertNotIn('id="recurrent-table"', response.content.decode())

    def test_a_reader_without_access_is_refused(self):
        outsider = User.objects.create(username="outsider", is_active=True)
        self.client.force_login(outsider)
        response = self.get()
        self.assertEqual(403, response.status_code)
        self.assertIsNone(payload(response.content.decode()))

    def test_the_about_page_lists_the_component(self):
        html = self.client.get("/about").content.decode()
        self.assertIn("mutint-recurrent", html)
