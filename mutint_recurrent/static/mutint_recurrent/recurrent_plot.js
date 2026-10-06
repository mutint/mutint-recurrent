/* One gene drawn with its mutations flagged around it.
 *
 * `window.mutintRecurrentPlot.box(gene, data)` returns a <div> holding the heading, the SVG
 * and a download link; `draw(gene, data, width)` returns the SVG alone. The drawing is plain
 * SVG elements -- rect, path, line, text and <use> of the page's glyph sprite -- in genome
 * orientation: the x axis runs the reader's flanking beyond the gene on its 3' side and beyond
 * its promoter region on its 5' side (`windowOf`), the gene a pointed rectangle with the point
 * on its 3' end, the promoter region (the 150 bp a mutation counts in) shaded, and every other
 * gene in the window drawn pale, clipped at its edges.
 *
 * Flags come in two kinds. A **point** -- a base substitution, a small indel, a mobile element
 * (drawn at its insertion point, not over its target-site duplication) -- is a pole rising from
 * its position to a lane above the gene, ending in its glyph with the label beside it. A
 * **span** -- a large deletion, amplification, conversion or inversion -- is a bracket *below*
 * the gene over its extent, with the glyph and label beside the middle, as the figure this
 * copies draws its deletions. Lanes are packed greedily outwards from the gene: each flag takes
 * the lowest lane where its label fits to the right of its glyph, or failing that to the left,
 * before moving up a lane. Every pole is drawn before every label, and each label sits on a
 * white box, so a pole from a higher lane passes behind the words it would otherwise cross.
 *
 * The download serialises the SVG with the glyph symbols copied in, so the file stands alone.
 */
(function () {
    "use strict";

    var NS = "http://www.w3.org/2000/svg";
    var XLINK = "http://www.w3.org/1999/xlink";
    var MARGIN = { left: 16, right: 16, top: 12, bottom: 46 };
    var GENE_HEIGHT = 28;
    var PROMOTER_HEIGHT = 16;
    var GENE_FILL = "#4fb3bf", GENE_STROKE = "#2a7f89";
    var PROMOTER_FILL = "#c9e8ec";   // the gene's own color, lighter  // the band is shorter than the gene, so the gene reads over it
    var LANE_HEIGHT = 22;
    var FLAG_GAP = 10;        // between the gene and the first lane on either side
    var GLYPH = 14;
    var FONT = 12;
    var FONT_FAMILY = "Helvetica, Arial, sans-serif";
    /* The file's font list leads with Arial: Illustrator takes the first font it has and
       substitutes nothing per glyph, and Arial carries the arrow, the delta and the minus
       sign where its Helvetica does not. */
    var FILE_FONT_FAMILY = "Arial, Helvetica, sans-serif";
    var XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
    var LABEL_PAD = 3;        // the white box around a label

    var measurer = document.createElement("canvas").getContext("2d");
    function textWidth(text) {
        measurer.font = FONT + "px " + FONT_FAMILY;
        return measurer.measureText(text).width;
    }

    function el(name, attrs, text) {
        var node = document.createElementNS(NS, name);
        Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        if (text !== undefined) { node.textContent = text; }
        return node;
    }

    function use(glyph, shade, x, y, size) {
        var g = el("g", { "class": "glyph-" + shade,
                          transform: "translate(" + (x - size / 2) + "," + (y - size / 2) + ")" });
        var u = el("use", { href: "#mr-" + glyph, width: size, height: size });
        u.setAttributeNS(XLINK, "xlink:href", "#mr-" + glyph);
        g.appendChild(u);
        return g;
    }

    /* A gene as a rectangle whose 3' end comes to a point. */
    function arrowPath(x1, x2, y, height, strand, clippedLeft, clippedRight) {
        var tip = Math.min(height / 2, Math.max(4, (x2 - x1) / 3));
        var top = y, mid = y + height / 2, bottom = y + height;
        if (strand === -1) {
            if (clippedLeft) { tip = 0; }
            return "M" + x2 + " " + top + " L" + (x1 + tip) + " " + top + " L" + x1 + " " + mid
                + " L" + (x1 + tip) + " " + bottom + " L" + x2 + " " + bottom + " Z";
        }
        if (clippedRight) { tip = 0; }
        return "M" + x1 + " " + top + " L" + (x2 - tip) + " " + top + " L" + x2 + " " + mid
            + " L" + (x2 - tip) + " " + bottom + " L" + x1 + " " + bottom + " Z";
    }

    /* A flag's words: the change, its annotation -- in parentheses unless it brings its own,
       as `intergenic (-76/-124)` does -- then, unless the populations are hidden, a bar and
       the populations. The populations are kept apart so each can be colored. */
    function flagWords(m, withPopulations) {
        var words = m.label || m.type;
        if (m.annotation) {
            words += m.annotation.indexOf("(") >= 0 ? " " + m.annotation : " (" + m.annotation + ")";
        }
        return withPopulations ? words + " | " : words;
    }
    function flagText(m, withPopulations) {
        return flagWords(m, withPopulations) + (withPopulations ? m.populations.join(", ") : "");
    }

    /* The label as one <text> of <tspan>s, the population names in their colors. */
    function flagLabel(m, attrs, colorOf, withPopulations) {
        var text = el("text", attrs);
        text.appendChild(el("tspan", {}, flagWords(m, withPopulations)));
        if (!withPopulations) { return text; }
        m.populations.forEach(function (population, i) {
            var color = colorOf ? colorOf(population) : null;
            var span = el("tspan", color ? { fill: color, "font-weight": "bold" } : {}, population);
            text.appendChild(span);
            if (i < m.populations.length - 1) { text.appendChild(el("tspan", {}, ", ")); }
        });
        return text;
    }

    /* A bracket is for a large mutation: a small deletion is a tick like a small insertion,
       and a mobile element is drawn at its insertion point rather than over its
       target-site duplication. */
    var SPAN_GLYPHS = { "trapezoid-down": true, trapezoid: true, parallelogram: true, barbell: true };
    function isSpan(m) { return SPAN_GLYPHS[m.glyph] === true && m.end > m.start; }

    /* Lane packing. Each lane holds the horizontal intervals already taken; a flag asks
       for the lowest lane where one of its two placements fits. */
    function fits(lane, left, right) {
        return lane.every(function (taken) { return right + 6 <= taken[0] || left - 6 >= taken[1]; });
    }

    function pack(flags, leftEdge, rightEdge) {
        var lanes = [];
        flags.sort(function (a, b) { return a.anchor - b.anchor; });
        flags.forEach(function (f) {
            var block = GLYPH + 4 + f.width;
            var options;
            if (f.span) {
                // The label block over the bracket's middle, kept inside the drawing.
                var blockLeft = Math.max(leftEdge, Math.min(rightEdge - block, f.mid - block / 2));
                if (!isFinite(leftEdge)) { blockLeft = f.mid - block / 2; }
                options = [{ side: "right", blockLeft: blockLeft,
                             left: Math.min(f.left, blockLeft), right: Math.max(f.right, blockLeft + block) }];
            } else {
                options = [];
                if (f.anchor + GLYPH / 2 + 4 + f.width <= rightEdge) {
                    options.push({ side: "right", left: f.anchor - GLYPH / 2, right: f.anchor + GLYPH / 2 + 4 + f.width });
                }
                if (f.anchor - GLYPH / 2 - 4 - f.width >= leftEdge) {
                    options.push({ side: "left", left: f.anchor - GLYPH / 2 - 4 - f.width, right: f.anchor + GLYPH / 2 });
                }
                if (!options.length) {
                    options.push({ side: "right", left: f.anchor - GLYPH / 2, right: f.anchor + GLYPH / 2 + 4 + f.width });
                }
            }
            var placed = false;
            for (var lane = 0; !placed; lane += 1) {
                if (!lanes[lane]) { lanes[lane] = []; }
                for (var i = 0; i < options.length; i += 1) {
                    if (fits(lanes[lane], options[i].left, options[i].right)) {
                        lanes[lane].push([options[i].left, options[i].right]);
                        f.extentLeft = options[i].left;
                        f.extentRight = options[i].right;
                        f.lane = lane;
                        f.side = options[i].side;
                        f.blockLeft = options[i].blockLeft;
                        placed = true;
                        break;
                    }
                }
            }
        });
        return lanes.length;
    }

    function draw(gene, data, width, options) {
        width = width || 800;
        options = options || {};
        var withPopulations = options.populations !== false;
        var w = windowOf(gene, data, options.flank === undefined ? (data.default_flank || 300) : options.flank);
        w.promoter = gene.window.promoter;
        w.neighbors = (gene.window.neighbors || []).filter(function (n) { return n.end >= w.lo && n.start <= w.hi; });
        var inner = width - MARGIN.left - MARGIN.right;
        var leftEdge = MARGIN.left, rightEdge = MARGIN.left + inner;
        var span = Math.max(1, w.hi - w.lo);
        function x(pos) { return MARGIN.left + (pos - w.lo) / span * inner; }
        function clampX(pos) { return Math.max(leftEdge, Math.min(rightEdge, x(pos))); }

        var above = [], below = [];
        gene.mutations.forEach(function (id) {
            var m = data.mutations[String(id)];
            if (!m) { return; }
            var f = { m: m, span: isSpan(m), text: flagText(m, withPopulations) };
            f.width = textWidth(f.text);
            f.left = clampX(m.start);
            f.right = f.span ? clampX(m.end + 1) : f.left;
            f.mid = (f.left + f.right) / 2;
            f.anchor = f.span ? f.mid : f.left;
            (f.span ? below : above).push(f);
        });
        // At a shared scale the window may be narrower than its labels, so they may run past
        // the window's edges and the drawing widens to hold them (below).
        var packLeft = options.pxPerBase ? -Infinity : leftEdge;
        var packRight = options.pxPerBase ? Infinity : rightEdge;
        var lanesAbove = pack(above, packLeft, packRight);
        var lanesBelow = pack(below, packLeft, packRight);
        var minX = 0, maxX = width;
        above.concat(below).forEach(function (f) {
            minX = Math.min(minX, f.extentLeft - LABEL_PAD);
            maxX = Math.max(maxX, f.extentRight + LABEL_PAD);
        });

        var aboveHeight = lanesAbove ? lanesAbove * LANE_HEIGHT + FLAG_GAP : 0;
        var belowHeight = lanesBelow ? lanesBelow * LANE_HEIGHT + FLAG_GAP : 0;
        var geneTop = MARGIN.top + aboveHeight + 4;
        var geneMid = geneTop + GENE_HEIGHT / 2;
        var geneBottom = geneTop + GENE_HEIGHT;
        var labelsY = geneBottom + belowHeight + 16;          // neighbour and promoter names
        var height = labelsY + MARGIN.bottom - 16;

        var svg = el("svg", { "class": "mr-plot", xmlns: NS,
                              viewBox: minX + " 0 " + (maxX - minX) + " " + height,
                              width: maxX - minX, height: height, "font-size": FONT });
        svg.setAttribute("data-left", minX);
        svg.setAttribute("xmlns:xlink", XLINK);

        /* Promoter: the counted distance upstream of the start codon, as a band and nothing else -- the
           legend says what the band is. */
        if (w.promoter) {
            var pLeft = clampX(w.promoter[0]), pRight = clampX(w.promoter[1] + 1);
            if (pRight > pLeft) {
                svg.appendChild(el("rect", { x: pLeft, y: geneMid - PROMOTER_HEIGHT / 2, width: pRight - pLeft,
                                             height: PROMOTER_HEIGHT, fill: PROMOTER_FILL }));
            }
        }

        /* The backbone line across the window. */
        svg.appendChild(el("line", { x1: leftEdge, x2: rightEdge, y1: geneMid, y2: geneMid,
                                     stroke: "#333", "stroke-width": 1.5 }));

        /* The poles go in now, so they run down to the baseline behind the genes and over
           the promoter band; the labels come last, over everything. */
        var poles = el("g", { "class": "mr-poles" });
        var labels = el("g", { "class": "mr-labels" });
        svg.appendChild(poles);

        /* Neighbours, clipped to the window, named inside their boxes where the name fits
           and under them otherwise. */
        (w.neighbors || []).forEach(function (n) {
            var left = clampX(n.start), right = clampX(n.end + 1);
            if (right - left < 2) { return; }
            svg.appendChild(el("path", {
                d: arrowPath(left, right, geneTop, GENE_HEIGHT, n.strand, n.start < w.lo, n.end > w.hi),
                fill: "#d9dde1", stroke: "#9aa1a8", "stroke-width": 1 }));
            var nameWidth = textWidth(n.name);
            if (right - left >= nameWidth + 14) {
                svg.appendChild(el("text", { x: (left + right) / 2, y: geneMid + 4.5,
                                             "text-anchor": "middle", "font-style": "italic",
                                             fill: "#4a5560" }, n.name));
            } else {
                svg.appendChild(el("text", { x: (left + right) / 2, y: labelsY,
                                             "text-anchor": "middle", "font-style": "italic",
                                             fill: "#6c757d" }, n.name));
            }
        });

        /* The gene. */
        var gLeft = x(gene.start), gRight = x(gene.end + 1);
        svg.appendChild(el("path", { d: arrowPath(gLeft, gRight, geneTop, GENE_HEIGHT, gene.strand),
                                     fill: GENE_FILL, stroke: GENE_STROKE, "stroke-width": 1 }));
        svg.appendChild(el("text", { x: (gLeft + gRight) / 2, y: geneMid + 4.5, "text-anchor": "middle",
                                     "font-style": "italic", "font-weight": "bold",
                                     fill: "#102a30" }, gene.name));

        /* The flags: every pole and bracket first, then every glyph and label on its white
           box, so a pole passes behind any label it crosses. */
        svg.appendChild(labels);

        function laneY(f, isBelow) {
            return isBelow
                ? geneBottom + FLAG_GAP + f.lane * LANE_HEIGHT + LANE_HEIGHT / 2
                : geneTop - FLAG_GAP - f.lane * LANE_HEIGHT - LANE_HEIGHT / 2;
        }

        function drawFlag(f, isBelow) {
            var y = laneY(f, isBelow);
            var shade = f.m.shades[gene.key] || "outline";
            var stroke = { stroke: "#333", "stroke-width": 1.5 };
            var title = flagText(f.m, true) + "\n" + f.m.type + ", " + f.m.seq_id + ":" + f.m.start
                + (f.span ? "–" + f.m.end : "");
            var glyphX, textX, anchor;
            if (f.span) {
                var clippedLeft = f.m.start < w.lo, clippedRight = f.m.end > w.hi;
                poles.appendChild(el("line", Object.assign({ x1: f.left, x2: f.right, y1: y, y2: y }, stroke)));
                if (!clippedLeft) {
                    poles.appendChild(el("line", Object.assign({ x1: f.left, x2: f.left, y1: y - 5, y2: y + 5 }, stroke)));
                }
                if (!clippedRight) {
                    poles.appendChild(el("line", Object.assign({ x1: f.right, x2: f.right, y1: y - 5, y2: y + 5 }, stroke)));
                }
                // The label sits just off the bracket, on the side away from the gene.
                y = isBelow ? y + 10 : y - 10;
                glyphX = f.blockLeft + GLYPH / 2;
                textX = f.blockLeft + GLYPH + 4;
                anchor = "start";
            } else {
                poles.appendChild(el("line", Object.assign({ x1: f.left, x2: f.left, y1: y, y2: geneMid }, stroke)));
                glyphX = f.left;
                if (f.side === "left") {
                    textX = f.left - GLYPH / 2 - 4;
                    anchor = "end";
                } else {
                    textX = f.left + GLYPH / 2 + 4;
                    anchor = "start";
                }
            }
            var g = el("g", { "class": "mr-flag" });
            g.appendChild(el("title", {}, title));
            var boxLeft = anchor === "end" ? textX - f.width : textX;
            g.appendChild(el("rect", { x: boxLeft - LABEL_PAD, y: y - FONT / 2 - LABEL_PAD,
                                       width: f.width + 2 * LABEL_PAD, height: FONT + 2 * LABEL_PAD,
                                       fill: "#fff", "class": "mr-label-box" }));
            g.appendChild(use(f.m.glyph, shade, glyphX, y, GLYPH));
            g.appendChild(flagLabel(f.m, { x: textX, y: y + 4, "text-anchor": anchor, "class": "mr-flag-text" },
                                    options.colorOf, withPopulations));
            if (f.m.url) {
                var a = el("a", { href: f.m.url });
                a.setAttributeNS(XLINK, "xlink:href", f.m.url);
                a.appendChild(g);
                labels.appendChild(a);
            } else {
                labels.appendChild(g);
            }
        }
        above.forEach(function (f) { drawFlag(f, false); });
        below.forEach(function (f) { drawFlag(f, true); });

        /* The axis: the window's coordinates. */
        var axisY = height - 6;
        svg.appendChild(el("text", { x: leftEdge, y: axisY, "font-size": FONT - 2, fill: "#6c757d" },
                           (gene.seq_id || "") + ":" + w.lo.toLocaleString()));
        svg.appendChild(el("text", { x: rightEdge, y: axisY, "text-anchor": "end",
                                     "font-size": FONT - 2, fill: "#6c757d" }, w.hi.toLocaleString()));
        return svg;
    }

    /* The page's two legend boxes, read off the DOM, drawn as SVG under a plot. Each entry is
       a glyph and its words; the boxes are framed and titled as they are on the page. */
    function legendRows(width) {
        var g = el("g", { "class": "mr-svg-legend" });
        var y = 0;
        var LINE = 20, PAD = 8, TITLE = 13, ENTRY_GAP = 16;
        Array.prototype.forEach.call(document.querySelectorAll(".mr-legend-box"), function (box) {
            var title = (box.querySelector("legend") || {}).textContent || "";
            var entries = Array.prototype.map.call(box.querySelectorAll(".mr-legend-entry"), function (entry) {
                var use = entry.querySelector("use");
                var svg = entry.querySelector("svg");
                return {
                    glyph: (use.getAttribute("href") || "").replace("#mr-", ""),
                    shade: (svg.getAttribute("class").match(/glyph-(\w+)/) || [])[1] || "solid",
                    words: entry.textContent.trim()
                };
            });
            // Lay the entries out in rows within the width.
            var rows = [[]], x = PAD;
            entries.forEach(function (entry) {
                entry.width = GLYPH + 4 + textWidth(entry.words);
                if (x + entry.width > width - PAD && rows[rows.length - 1].length) { rows.push([]); x = PAD; }
                rows[rows.length - 1].push(entry);
                x += entry.width + ENTRY_GAP;
            });
            var boxTop = y + TITLE / 2;
            var boxHeight = rows.length * LINE + PAD + TITLE / 2;
            g.appendChild(el("rect", { x: 0.5, y: boxTop, width: width - 1, height: boxHeight,
                                       fill: "none", stroke: "#adb5bd", rx: 4 }));
            var titleWidth = textWidth(title) + 8;
            g.appendChild(el("rect", { x: PAD, y: y, width: titleWidth, height: TITLE, fill: "#fff" }));
            g.appendChild(el("text", { x: PAD + 4, y: y + TITLE - 2, "font-size": TITLE, "font-weight": "bold",
                                       fill: "#495057" }, title));
            var rowY = boxTop + TITLE / 2 + PAD / 2 + LINE / 2;
            rows.forEach(function (row) {
                var rx = PAD;
                row.forEach(function (entry) {
                    g.appendChild(use(entry.glyph, entry.shade, rx + GLYPH / 2, rowY, GLYPH));
                    g.appendChild(el("text", { x: rx + GLYPH + 4, y: rowY + 4 }, entry.words));
                    rx += entry.width + ENTRY_GAP;
                });
                rowY += LINE;
            });
            y = boxTop + boxHeight + 10;
        });
        return { node: g, height: y };
    }

    /* The SVG as a file: the sprite's symbols and the shade rules copied in, and the legends
       drawn beneath the plot, so the file stands alone. */
    function standalone(svg) {
        var copy = svg.cloneNode(true);
        var width = Number(svg.getAttribute("width")), height = Number(svg.getAttribute("height"));
        var left = Number(svg.getAttribute("data-left")) || 0;
        var sprite = document.querySelector("svg defs");
        var defs = el("defs");
        if (sprite) {
            Array.prototype.forEach.call(sprite.querySelectorAll("symbol"), function (symbol) {
                defs.appendChild(symbol.cloneNode(true));
            });
        }
        defs.appendChild(fileStyle());
        copy.insertBefore(defs, copy.firstChild);
        var legendWidth = Math.max(width - 2 * MARGIN.left, 420);
        var legend = legendRows(legendWidth);
        legend.node.setAttribute("transform", "translate(" + (left + MARGIN.left) + "," + (height + 4) + ")");
        copy.appendChild(legend.node);
        var total = height + 4 + legend.height;
        var fullWidth = Math.max(width, legendWidth + 2 * MARGIN.left);
        copy.setAttribute("height", total);
        copy.setAttribute("width", fullWidth);
        copy.setAttribute("viewBox", left + " 0 " + fullWidth + " " + total);
        return serialize(copy);
    }

    function fileStyle() {
        return el("style", {}, "text{font-family:" + FILE_FONT_FAMILY + "}"
            + ".glyph-solid{fill:#333;stroke:#333;stroke-width:1}"
            + ".glyph-outline{fill:#fff;stroke:#333;stroke-width:1.5}"
            + ".glyph-gray{fill:#b0b6bc;stroke:#b0b6bc;stroke-width:1}");
    }

    /* The file's bytes: an XML declaration naming UTF-8 ahead of the markup, without which
       Illustrator reads the arrows and the delta as boxes. */
    function serialize(node) {
        return XML_DECLARATION + new XMLSerializer().serializeToString(node);
    }

    function symbolDefs() {
        var defs = el("defs");
        var sprite = document.querySelector("svg defs");
        if (sprite) {
            Array.prototype.forEach.call(sprite.querySelectorAll("symbol"), function (symbol) {
                defs.appendChild(symbol.cloneNode(true));
            });
        }
        defs.appendChild(fileStyle());
        return defs;
    }

    /* The table as a drawing: the shown gene columns, a vertical header per sample colored
       by its population, one glyph per mutation in each cell, and the legends beneath.
       `columns` is `[{key, title, text(gene)}]` in order, `shadeOf(m, gene)` the cell's shade,
       `headerColor(sample)` the color behind a sample's header. */
    function tableSvg(genes, data, columns, shadeOf, headerColor) {
        var ROW = 22, SAMPLE_W = 24, PAD = 6, HEADER_GREY = "#4b5158", STRIPE = "#f5f5f5";
        var MAX_COLUMN = 320;
        // A column is as wide as its widest words up to a cap; past it the words are cut
        // with an ellipsis rather than running under the next column.
        function fitted(text, limit) {
            if (textWidth(text) <= limit) { return text; }
            var cut = text;
            while (cut.length && textWidth(cut + "\u2026") > limit) { cut = cut.slice(0, -1); }
            return cut + "\u2026";
        }
        var widths = columns.map(function (column) {
            var most = textWidth(column.title) + 2;
            genes.forEach(function (gene) { most = Math.max(most, textWidth(column.text(gene))); });
            return Math.min(most, MAX_COLUMN) + 2 * PAD;
        });
        // The vertical labels are bold and a point larger than the measurer's font.
        var headerHeight = data.samples.reduce(function (most, sample) {
            return Math.max(most, textWidth(sample.label) * 1.2);
        }, textWidth("Gene")) + 2 * PAD;
        var textLeft = widths.reduce(function (a, b) { return a + b; }, 0);
        var width = textLeft + data.samples.length * SAMPLE_W;
        var height = headerHeight + genes.length * ROW;
        var svg = el("svg", { xmlns: NS, width: width, height: height, "font-size": FONT });
        svg.setAttribute("xmlns:xlink", XLINK);
        svg.appendChild(symbolDefs());

        svg.appendChild(el("rect", { x: 0, y: 0, width: textLeft, height: headerHeight, fill: HEADER_GREY }));
        var x = 0;
        columns.forEach(function (column, i) {
            svg.appendChild(el("text", { x: x + PAD, y: headerHeight - PAD - 2, fill: "#fff",
                                         "font-weight": "bold" }, column.title));
            x += widths[i];
        });
        data.samples.forEach(function (sample, i) {
            var sx = textLeft + i * SAMPLE_W;
            svg.appendChild(el("rect", { x: sx, y: 0, width: SAMPLE_W, height: headerHeight,
                                         fill: headerColor ? headerColor(sample) : HEADER_GREY }));
            svg.appendChild(el("text", { x: sx + SAMPLE_W / 2 + 4.5, y: headerHeight - PAD, fill: "#fff",
                                         "font-weight": "bold", "font-size": FONT + 1,
                                         transform: "rotate(-90 " + (sx + SAMPLE_W / 2 + 4.5) + " " + (headerHeight - PAD) + ")" },
                               sample.label));
        });

        genes.forEach(function (gene, row) {
            var y = headerHeight + row * ROW;
            if (row % 2) { svg.appendChild(el("rect", { x: 0, y: y, width: width, height: ROW, fill: STRIPE })); }
            var cx = 0;
            columns.forEach(function (column, i) {
                var attrs = { x: cx + PAD, y: y + ROW / 2 + 4 };
                if (column.key === "gene") { attrs["font-style"] = "italic"; attrs["font-weight"] = "bold"; }
                svg.appendChild(el("text", attrs, fitted(column.text(gene), widths[i] - 2 * PAD)));
                cx += widths[i];
            });
            data.samples.forEach(function (sample, i) {
                var ids = gene.cells[String(sample.id)] || [];
                var sx = textLeft + i * SAMPLE_W + SAMPLE_W / 2;
                var step = ids.length > 1 ? Math.min(GLYPH, (SAMPLE_W - 4) / ids.length) : 0;
                var gx = sx - step * (ids.length - 1) / 2;
                ids.forEach(function (id) {
                    var m = data.mutations[String(id)];
                    if (!m) { return; }
                    svg.appendChild(use(m.glyph, shadeOf(m, gene), gx, y + ROW / 2, GLYPH - 1));
                    gx += step;
                });
            });
            svg.appendChild(el("line", { x1: 0, x2: width, y1: y + ROW, y2: y + ROW, stroke: "#ddd" }));
        });
        for (var cx2 = 0, i2 = 0; i2 < columns.length; i2 += 1) {
            cx2 += widths[i2];
            svg.appendChild(el("line", { x1: cx2, x2: cx2, y1: 0, y2: height, stroke: "#e3e3e3" }));
        }
        var legend = legendRows(Math.max(width, 420));
        legend.node.setAttribute("transform", "translate(0," + (height + 10) + ")");
        svg.appendChild(legend.node);
        var total = height + 10 + legend.height;
        svg.setAttribute("height", total);
        svg.setAttribute("width", Math.max(width, 420));
        svg.setAttribute("viewBox", "0 0 " + Math.max(width, 420) + " " + total);
        return serialize(svg);
    }

    function download(text, name, type) {
        var blob = new Blob([text], { type: type });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* The window a gene is drawn in: `flank` bases beyond it on its 3' side and beyond its
       promoter region on its 5' side -- the promoter is where mutations still count, so the
       flank is measured past it and nothing that counts is ever off the drawing -- clipped
       to the contig. */
    function windowOf(gene, data, flank) {
        var upstream = (data.promoter_distance || 0) + flank;
        var lo = gene.strand === -1 ? gene.start - flank : gene.start - upstream;
        var hi = gene.strand === -1 ? gene.end + upstream : gene.end + flank;
        return { lo: Math.max(1, lo), hi: Math.min(gene.window.contig_length, hi) };
    }

    /* The scale that fits a window of `bases` into `boxWidth` pixels; `options.pxPerBase` in
       `box` and `draw` makes every plot share it. */
    function pxPerBase(boxWidth, bases) {
        return Math.max(1, boxWidth - MARGIN.left - MARGIN.right) / Math.max(1, bases);
    }

    /* `extras` are the words the Columns menu adds to the heading: locus tag, location,
       description, whichever are shown. The count is not here: the page writes it once as a
       heading over each run of genes sharing it. With `options.pxPerBase` the drawing is as
       wide as its window at that scale rather than as wide as the box. */
    function box(gene, data, extras, options) {
        var div = document.createElement("div");
        div.className = "mr-plot-box";
        var h = document.createElement("h4");
        var name = document.createElement("i");
        name.textContent = gene.name;
        h.appendChild(name);
        (extras || []).forEach(function (words) {
            var extra = document.createElement("span");
            extra.className = "mr-extra";
            extra.textContent = words;
            h.appendChild(extra);
        });
        div.appendChild(h);
        if (!gene.window) {
            var p = document.createElement("p");
            p.className = "text-muted";
            p.textContent = "The reference does not name this gene, so it cannot be drawn.";
            div.appendChild(p);
            return div;
        }
        var boxWidth = Math.max(400, (document.querySelector("[data-role='plots']") || div).clientWidth || 800);
        var width = boxWidth;
        if (options && options.pxPerBase) {
            var span = windowOf(gene, data, options.flank === undefined ? (data.default_flank || 300) : options.flank);
            width = Math.min(boxWidth, Math.max(120,
                Math.round(MARGIN.left + MARGIN.right + (span.hi - span.lo) * options.pxPerBase)));
        }
        var svg = draw(gene, data, width, options);
        var drawn = Number(svg.getAttribute("width"));
        if (drawn < boxWidth) { svg.style.width = drawn + "px"; }
        div.appendChild(svg);
        var link = document.createElement("a");
        link.className = "mr-download";
        link.textContent = "Download SVG";
        link.href = "#";
        link.addEventListener("click", function (event) {
            event.preventDefault();
            download(standalone(svg), gene.name + "_recurrent.svg", "image/svg+xml");
        });
        h.appendChild(link);
        return div;
    }

    window.mutintRecurrentPlot = { draw: draw, box: box, standalone: standalone, pxPerBase: pxPerBase,
                                   windowOf: windowOf, tableSvg: tableSvg, download: download };
}());
