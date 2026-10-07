/* The Recurrent page's controls and table.
 *
 * The derivation arrives whole as JSON (`#recurrent-data`); this script decides which
 * mutations count -- a mutation spanning several genes only when the box is ticked -- recounts
 * each gene's populations from its cells, filters by the minimum, draws the rows, shows and
 * hides the gene columns, and hands the plots view to recurrent_plot.js. The counting is
 * repeated here rather than taken from the server so the checkbox costs no request; the
 * server's counts are what the page would show with it ticked. Four choices are remembered
 * through mutintPreferences: `recurrent.columns` ({hidden, shown}, read the way the matrix
 * reads its own), `recurrent.view`, `recurrent.span_deletions` and `recurrent.min.<experiment>`.
 *
 * The slider and the number box are one value: the slider redraws live on `input`, the box
 * commits on change or Enter, and the box is never rewritten while it has focus.
 */
(function () {
    "use strict";

    function glyphSvg(glyph, shade, title) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "mr-glyph glyph-" + shade);
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#mr-" + glyph);
        use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#mr-" + glyph);
        svg.appendChild(use);
        if (title) {
            var t = document.createElementNS("http://www.w3.org/2000/svg", "title");
            t.textContent = title;
            svg.insertBefore(t, use);
        }
        return svg;
    }

    var SHADE_WORDS = {
        solid: "predicted to inactivate the gene",
        outline: "no inactivation predicted",
        gray: "promoter, or the last 20% of the gene"
    };

    function strandWord(strand) { return strand === -1 ? "−" : strand === 1 ? "+" : ""; }

    function location(gene) {
        if (gene.start === null || gene.start === undefined) { return ""; }
        return (gene.seq_id || "") + ":" + gene.start.toLocaleString() + "–"
            + gene.end.toLocaleString() + " (" + strandWord(gene.strand) + ")";
    }

    function init(root) {
        var data = window.mutintPreferences.embedded("recurrent-data");
        var experimentId = root.getAttribute("data-experiment-id");
        var fileStem = root.getAttribute("data-file-stem") || "recurrent";
        var prefs = window.mutintPreferences({
            authenticated: root.getAttribute("data-authenticated") === "1",
            url: root.getAttribute("data-preferences-url"),
            embedded: window.mutintPreferences.embedded("recurrent-prefs")
        });
        var slider = root.querySelector("[data-role='min-slider']");
        var box = root.querySelector("[data-role='min-box']");
        var countLine = root.querySelector("[data-role='count']");
        var tbody = root.querySelector("#recurrent-table tbody");
        var table = root.querySelector("#recurrent-table");
        var empty = root.querySelector("[data-role='empty']");
        var tableView = root.querySelector("[data-role='table-view']");
        var plotsView = root.querySelector("[data-role='plots-view']");
        var plots = root.querySelector("[data-role='plots']");
        var maxBox = root.querySelector("[data-role='max-box']");
        var spanBox = root.querySelector("[data-role='span-deletions']");
        var minKey = "recurrent.min." + experimentId;
        var populationOf = {};
        data.samples.forEach(function (sample) { populationOf[String(sample.id)] = sample.population; });

        /* The population names on the flags: hidden (with the bar before them), black,
           colored by the population's own palette (the table's header colors), or by its
           treatment. A population's treatment is the one its samples carry; where they
           disagree, the first sample's in column order. */
        var PALETTE = ["#337ab7", "#b35c00", "#2a8a3e", "#8e44ad", "#c0392b", "#0e8a8a", "#a0762b", "#5d6d7e"];
        var colorSelect = root.querySelector("[data-role='color']");
        var populationPalette = {}, populationTreatment = {}, treatmentIndex = {};
        var treatments = [];
        data.samples.forEach(function (sample) {
            if (!(sample.population in populationPalette)) { populationPalette[sample.population] = sample.palette; }
            if (!(sample.population in populationTreatment)) { populationTreatment[sample.population] = sample.treatment; }
            if (sample.treatment && treatments.indexOf(sample.treatment) < 0) { treatments.push(sample.treatment); }
        });
        treatments.sort().forEach(function (treatment, i) { treatmentIndex[treatment] = i % PALETTE.length; });
        function colorOf(population) {
            if (colorSelect.value === "population") { return PALETTE[populationPalette[population] || 0]; }
            if (colorSelect.value === "treatment") {
                var treatment = populationTreatment[population];
                return treatment ? PALETTE[treatmentIndex[treatment]] : "#9aa1a8";
            }
            return null;
        }
        var colorChoice = prefs.get("recurrent.color", "none");
        colorSelect.value = ["hidden", "none", "population", "treatment"].indexOf(colorChoice) >= 0 ? colorChoice : "none";
        colorSelect.addEventListener("change", function () {
            prefs.set("recurrent.color", colorSelect.value);
            if (view === "plots") { drawPlots(shownGenes()); }
        });

        /* Fit to width draws every gene across the box; Same scale draws them all at one
           number of pixels per base -- the widest window fills the box and the rest are
           narrower -- so the drawings, and the SVGs downloaded from them, compare lengths. */
        var scaleMode = prefs.get("recurrent.scale", "fit") === "same" ? "same" : "fit";
        Array.prototype.forEach.call(root.querySelectorAll("[data-scale]"), function (button) {
            button.addEventListener("click", function () {
                scaleMode = button.getAttribute("data-scale");
                prefs.set("recurrent.scale", scaleMode);
                showScale();
                drawPlots(shownGenes());
            });
        });
        function showScale() {
            Array.prototype.forEach.call(root.querySelectorAll("[data-scale]"), function (button) {
                button.classList.toggle("active", button.getAttribute("data-scale") === scaleMode);
            });
        }
        showScale();

        /* Export: the table as CSV -- one row per shown gene, the shown columns, then a cell
           per sample naming each mutation with its glyph and shade -- or as a drawing. */
        var GLYPH_WORDS = {}, SHADE_WORDS_SHORT = { solid: "inactivating", outline: "not inactivating", gray: "promoter or terminal" };
        Array.prototype.forEach.call(root.querySelectorAll(".mr-legend-box:first-of-type .mr-legend-entry"), function (entry) {
            var use = entry.querySelector("use");
            GLYPH_WORDS[(use.getAttribute("href") || "").replace("#mr-", "")] = entry.textContent.trim();
        });
        function shownColumns() {
            var all = [
                { key: "count", title: "#", text: function (g) { return String(g.count); } },
                { key: "gene", title: "Gene", text: function (g) { return g.name; } },
                { key: "locus_tag", title: "Locus tag", text: function (g) { return g.locus_tag || ""; } },
                { key: "location", title: "Gene location", text: location },
                { key: "product", title: "Description", text: function (g) { return g.product || ""; } }
            ];
            return all.filter(function (c) { return !hiddenColumns[c.key]; });
        }
        function csvCell(text) {
            text = String(text === null || text === undefined ? "" : text);
            return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }
        function exportCsv() {
            var columns = shownColumns();
            var lines = [columns.map(function (c) { return c.title; })
                         .concat(data.samples.map(function (s) { return s.label; })).map(csvCell).join(",")];
            shownGenes().forEach(function (gene) {
                var row = columns.map(function (c) { return c.text(gene); });
                data.samples.forEach(function (sample) {
                    row.push((gene.cells[String(sample.id)] || []).map(function (id) {
                        var m = data.mutations[String(id)];
                        var shade = m.shades[gene.key] || "outline";
                        return m.label + (m.annotation ? " " + m.annotation : "") + " ["
                            + (GLYPH_WORDS[m.glyph] || m.type) + "; " + SHADE_WORDS_SHORT[shade] + "]";
                    }).join("; "));
                });
                lines.push(row.map(csvCell).join(","));
            });
            window.mutintRecurrentPlot.download("\ufeff" + lines.join("\n") + "\n",
                                                "recurrent_" + fileStem + ".csv", "text/csv;charset=utf-8");
        }
        function exportSvg() {
            var text = window.mutintRecurrentPlot.tableSvg(shownGenes(), data, shownColumns(), function (m, gene) {
                return m.shades[gene.key] || "outline";
            }, headerColor);
            window.mutintRecurrentPlot.download(text, "recurrent_" + fileStem + ".svg", "image/svg+xml");
        }
        Array.prototype.forEach.call(root.querySelectorAll("[data-export]"), function (button) {
            button.addEventListener("click", function () {
                if (button.getAttribute("data-export") === "csv") { exportCsv(); } else { exportSvg(); }
            });
        });

        /* What the table's sample headers are colored by: population, treatment or nothing,
           one class on the table, remembered as `recurrent.column_color`. The SVG export
           reads the same choice. */
        var columnColor = root.querySelector("[data-role='column-color']");
        var columnChoiceStored = prefs.get("recurrent.column_color", "population");
        columnColor.value = ["population", "treatment", "none"].indexOf(columnChoiceStored) >= 0 ? columnChoiceStored : "population";
        function applyColumnColor() {
            table.classList.remove("color-population", "color-treatment", "color-none");
            table.classList.add("color-" + columnColor.value);
        }
        columnColor.addEventListener("change", function () {
            prefs.set("recurrent.column_color", columnColor.value);
            applyColumnColor();
        });
        applyColumnColor();
        function headerColor(sample) {
            if (columnColor.value === "treatment") {
                return sample.treatment_palette === null || sample.treatment_palette === undefined
                    ? "#9aa1a8" : PALETTE[sample.treatment_palette];
            }
            if (columnColor.value === "none") { return "#4b5158"; }
            return PALETTE[sample.palette % PALETTE.length];
        }

        /* Flanking: how far a plot reaches beyond the gene (and beyond its promoter region on
           the 5' side), 0 to the largest the server sent genes for. Remembered per reader. */
        var flankBox = root.querySelector("[data-role='flank']");
        var flank = data.default_flank;
        var storedFlank = prefs.get("recurrent.flank", null);
        if (typeof storedFlank === "number" && storedFlank >= 0) { flank = Math.min(data.max_flank, Math.round(storedFlank)); }
        flankBox.value = String(flank);
        function commitFlank() {
            var value = parseInt(flankBox.value, 10);
            if (!isFinite(value)) { flankBox.value = String(flank); return; }
            flank = Math.max(0, Math.min(data.max_flank, value));
            flankBox.value = String(flank);
            prefs.set("recurrent.flank", flank);
            if (view === "plots") { drawPlots(shownGenes()); }
        }
        flankBox.addEventListener("change", commitFlank);
        flankBox.addEventListener("keydown", function (event) {
            if (event.key === "Enter") { event.preventDefault(); commitFlank(); flankBox.blur(); }
        });

        spanBox.checked = prefs.get("recurrent.span_deletions", false) === true;
        spanBox.addEventListener("change", function () {
            prefs.set("recurrent.span_deletions", spanBox.checked);
            recount();
            refresh();
        });

        function counts(id) {
            var m = data.mutations[String(id)];
            return !!m && (spanBox.checked || !m.spans_genes);
        }

        /* Each gene's cells with the excluded mutations dropped, its populations recounted
           from what is left, and the genes re-sorted: the shape the server sent, decided
           again under the checkbox. */
        var genes = [];
        var maxCount = 1;
        function recount() {
            genes = [];
            data.genes.forEach(function (gene) {
                var cells = {}, populations = {};
                Object.keys(gene.cells).forEach(function (sampleId) {
                    var ids = gene.cells[sampleId].filter(counts);
                    if (ids.length) {
                        cells[sampleId] = ids;
                        populations[populationOf[sampleId]] = true;
                    }
                });
                var count = Object.keys(populations).length;
                if (!count) { return; }
                genes.push(Object.assign({}, gene, {
                    cells: cells, count: count, populations: Object.keys(populations).sort(),
                    mutations: gene.mutations.filter(counts)
                }));
            });
            genes.sort(function (a, b) {
                return (b.count - a.count) || String(a.seq_id).localeCompare(String(b.seq_id))
                    || ((a.start || 0) - (b.start || 0)) || a.name.localeCompare(b.name);
            });
            maxCount = Math.max(1, genes.reduce(function (most, g) { return Math.max(most, g.count); }, 0));
            slider.max = String(maxCount);
            box.max = String(maxCount);
            maxBox.value = String(maxCount);
            if (minimum > maxCount) { minimum = maxCount; slider.value = box.value = String(minimum); }
        }
        recount();

        var minimum = Number(root.getAttribute("data-default-minimum")) || 1;
        var remembered = prefs.get(minKey, null);
        if (typeof remembered === "number" && remembered >= 1) {
            minimum = Math.min(maxCount, Math.round(remembered));
        }
        var view = prefs.get("recurrent.view", "table");
        var plotsTab = root.querySelector("[data-view='plots']");
        function tabDisabled(tab) { return tab.getAttribute("data-disabled") === "1"; }
        if (view !== "plots" || tabDisabled(plotsTab)) { view = "table"; }

        /* Columns: the menu is mutintSelectList in toggle mode, `active` being shown. */
        var columnDefaults = {};
        var menu = root.querySelector("[data-role='columns']");
        Array.prototype.forEach.call(menu.querySelectorAll("li[data-value]"), function (li) {
            columnDefaults[li.getAttribute("data-value")] = li.classList.contains("active");
        });
        var hiddenColumns = window.mutintPreferences.columnHiddenSet(
            prefs.get("recurrent.columns", null), columnDefaults);
        var columnList = window.mutintSelectList(menu, {
            toggle: true, controls: null,
            onChange: function () {
                hiddenColumns = {};
                columnList.rows().forEach(function (li) {
                    if (!columnList.isSelected(li)) { hiddenColumns[li.getAttribute("data-value")] = true; }
                });
                prefs.set("recurrent.columns", window.mutintPreferences.columnChoice(hiddenColumns, columnDefaults));
                applyColumns();
            }
        });
        columnList.rows().forEach(function (li) {
            columnList.setSelected(li, !hiddenColumns[li.getAttribute("data-value")], true);
        });

        function applyColumns() {
            Object.keys(columnDefaults).forEach(function (key) {
                Array.prototype.forEach.call(table.querySelectorAll("[data-key='" + key + "']"), function (cell) {
                    cell.hidden = !!hiddenColumns[key];
                });
            });
            if (view === "plots") { drawPlots(shownGenes()); } else { pinColumns(); }
        }

        /* The gene columns stick to the left of the scroll box, each offset by the widths
           of the shown ones before it -- `position: sticky` cannot add them up itself. */
        var scrollBox = root.querySelector(".mr-scroll");
        function pinColumns() {
            var left = 0;
            Array.prototype.forEach.call(table.querySelectorAll("thead th[data-key]"), function (th) {
                var key = th.getAttribute("data-key");
                var cells = table.querySelectorAll("[data-key='" + key + "']");
                Array.prototype.forEach.call(cells, function (cell) {
                    cell.classList.toggle("pinned", !th.hidden);
                    cell.style.left = th.hidden ? "" : left + "px";
                });
                if (!th.hidden) { left += th.getBoundingClientRect().width; }
            });
        }

        function sizeScrollBox() {
            var top = scrollBox.getBoundingClientRect().top + window.scrollY;
            var height = window.innerHeight - top - 30;
            scrollBox.style.maxHeight = Math.max(240, height) + "px";
        }
        window.addEventListener("resize", function () { sizeScrollBox(); pinColumns(); });

        function shownGenes() {
            return genes.filter(function (gene) { return gene.count >= minimum; });
        }

        function cellFor(gene, sample) {
            var td = document.createElement("td");
            td.className = "mr-cell sample-palette-" + sample.palette;
            var ids = gene.cells[String(sample.id)] || [];
            ids.forEach(function (id) {
                var m = data.mutations[String(id)];
                if (!m) { return; }
                var shade = m.shades[gene.key] || "outline";
                var title = m.label + (m.annotation ? "  " + m.annotation : "")
                    + "\n" + m.type + ", " + SHADE_WORDS[shade]
                    + "\n" + sample.label + " (" + sample.population + ")";
                var glyph = glyphSvg(m.glyph, shade, title);
                if (m.url) {
                    var a = document.createElement("a");
                    a.href = m.url;
                    a.appendChild(glyph);
                    td.appendChild(a);
                } else {
                    td.appendChild(glyph);
                }
            });
            return td;
        }

        function drawTable(genes) {
            tbody.textContent = "";
            genes.forEach(function (gene) {
                var tr = document.createElement("tr");
                function cell(key, text) {
                    var td = document.createElement("td");
                    td.setAttribute("data-key", key);
                    td.textContent = text;
                    tr.appendChild(td);
                    return td;
                }
                cell("count", String(gene.count)).title = gene.populations.join(", ");
                cell("gene", gene.name);
                cell("locus_tag", gene.locus_tag || "");
                cell("location", location(gene));
                cell("product", gene.product || "");
                data.samples.forEach(function (sample) { tr.appendChild(cellFor(gene, sample)); });
                tbody.appendChild(tr);
            });
            applyColumns();
            sizeScrollBox();
            empty.hidden = genes.length > 0;
        }

        /* The optional columns' words join each plot's heading when they are shown. */
        function extras(gene) {
            var parts = [];
            if (!hiddenColumns.locus_tag && gene.locus_tag) { parts.push(gene.locus_tag); }
            if (!hiddenColumns.location) { parts.push(location(gene)); }
            if (!hiddenColumns.product && gene.product) { parts.push(gene.product); }
            return parts.filter(Boolean);
        }

        /* The genes arrive sorted by count, so a heading before each run of equal counts says
           it once for the group rather than on every plot. */
        function drawPlots(genes) {
            plots.textContent = "";
            var pxPerBase = null;
            if (scaleMode === "same") {
                var widest = genes.reduce(function (most, gene) {
                    if (!gene.window) { return most; }
                    var span = window.mutintRecurrentPlot.windowOf(gene, data, flank);
                    return Math.max(most, span.hi - span.lo);
                }, 0);
                if (widest) { pxPerBase = window.mutintRecurrentPlot.pxPerBase(plots.clientWidth, widest); }
            }
            var last = null;
            genes.forEach(function (gene) {
                if (gene.count !== last) {
                    last = gene.count;
                    var heading = document.createElement("h3");
                    heading.className = "mr-plot-group";
                    heading.textContent = "Genes with " + gene.count + " recurrent mutation" + (gene.count === 1 ? "" : "s");
                    plots.appendChild(heading);
                }
                plots.appendChild(window.mutintRecurrentPlot.box(gene, data, extras(gene),
                                                                 { colorOf: colorOf, pxPerBase: pxPerBase, flank: flank,
                                                                   populations: colorSelect.value !== "hidden",
                                                                   fileStem: fileStem }));
            });
            empty.hidden = genes.length > 0;
        }

        function refresh() {
            var genes = shownGenes();
            countLine.textContent = genes.length + " gene" + (genes.length === 1 ? "" : "s")
                + " mutated in ≥ " + minimum + " population" + (minimum === 1 ? "" : "s");
            if (view === "plots") { drawPlots(genes); } else { drawTable(genes); }
        }

        function setMinimum(value, save) {
            value = Math.max(1, Math.min(maxCount, Math.round(Number(value) || 1)));
            minimum = value;
            slider.value = String(value);
            if (document.activeElement !== box) { box.value = String(value); }
            if (save) { prefs.set(minKey, value); }
            refresh();
        }

        /* A collapse bar under the legend, the matrix's own (its classes come from
           breseq_table.css, which the page links): clicked, it folds away everything above
           it -- the legend, the controls, the tabs, the introduction, and up through the
           page header -- to give the table or the plots the height, and clicked again brings
           it all back. It stays put in both states, so what was folded is one click away.
           Remembered as `recurrent.options`. */
        var legend = root.querySelector(".mr-legend");
        var optionsShown = !(prefs.get("recurrent.options", null) || {}).hidden;
        function foldable() {
            var found = [], el = legend;
            while (el && el.id !== "mutint-content") {
                for (var sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) { found.push(sib); }
                el = el.parentElement;
            }
            return found;
        }
        function applyOptions() {
            [legend].concat(foldable()).forEach(function (el) {
                el.classList.toggle("mutation-matrix-folded", !optionsShown);
            });
        }
        var collapseBar = document.createElement("div");
        collapseBar.className = "mutation-matrix-collapse";
        collapseBar.setAttribute("role", "button");
        collapseBar.tabIndex = 0;
        var chevron = document.createElement("i");
        chevron.setAttribute("aria-hidden", "true");
        collapseBar.appendChild(chevron);
        function drawCollapseBar() {
            chevron.className = "fa " + (optionsShown ? "fa-angle-double-up" : "fa-angle-double-down");
            collapseBar.title = optionsShown ? "Collapse everything above" : "Expand the header and the options";
            collapseBar.setAttribute("aria-label", collapseBar.title);
            collapseBar.setAttribute("aria-expanded", String(optionsShown));
            collapseBar.classList.toggle("folded", !optionsShown);
        }
        function toggleOptions() {
            optionsShown = !optionsShown;
            applyOptions();
            drawCollapseBar();
            prefs.set("recurrent.options", { hidden: !optionsShown });
            sizeScrollBox();
        }
        collapseBar.addEventListener("click", toggleOptions);
        collapseBar.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleOptions(); }
        });
        legend.parentNode.insertBefore(collapseBar, legend.nextSibling);
        applyOptions();
        drawCollapseBar();

        slider.addEventListener("input", function () { setMinimum(slider.value, false); });
        slider.addEventListener("change", function () { setMinimum(slider.value, true); });
        function commitBox() {
            var value = parseInt(box.value, 10);
            if (!isFinite(value)) { box.value = String(minimum); return; }
            setMinimum(value, true);
            box.value = String(minimum);
        }
        box.addEventListener("change", commitBox);
        box.addEventListener("keydown", function (event) {
            if (event.key === "Enter") { event.preventDefault(); commitBox(); box.blur(); }
        });

        function setView(name, save) {
            view = name;
            Array.prototype.forEach.call(root.querySelectorAll("[data-view]"), function (tab) {
                (tab.closest("li") || tab).classList.toggle("active", tab.getAttribute("data-view") === name);
            });
            tableView.hidden = name !== "table";
            plotsView.hidden = name !== "plots";
            root.querySelector("[data-role='color-group']").hidden = name !== "plots";
            root.querySelector("[data-role='export-group']").hidden = name !== "table";
            root.querySelector("[data-role='column-color-group']").hidden = name !== "table";
            root.querySelector("[data-role='scale-group']").hidden = name !== "plots";
            root.querySelector("[data-role='flank-group']").hidden = name !== "plots";
            if (save) { prefs.set("recurrent.view", name); }
            refresh();
        }
        Array.prototype.forEach.call(root.querySelectorAll("[data-view]"), function (tab) {
            tab.addEventListener("click", function (event) {
                event.preventDefault();
                if (!tabDisabled(tab)) { setView(tab.getAttribute("data-view"), true); }
            });
        });

        if (minimum > maxCount) { minimum = maxCount; }
        slider.value = String(minimum);
        box.value = String(minimum);
        setView(view, false);
    }

    document.addEventListener("DOMContentLoaded", function () {
        Array.prototype.forEach.call(document.querySelectorAll("[data-recurrent]"), init);
    });
}());
