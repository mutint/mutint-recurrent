"""The glyph rule and its names, re-exported from mutint-core.

They were this plugin's until mutint-circos drew the same shapes on its rings; plugins do not
import each other, so the rule and the sprite (`glyphs/sprite.html`, ids `glyph-<name>`) live
in `mutint_common.glyphs`. The shade rule -- what a mutation does to a gene -- is still decided
here, in `analysis.py`; only its three words are in core, beside the glyphs they are drawn with.
"""

from mutint_common.glyphs import (  # noqa: F401
    BARBELL, BOWTIE, CIRCLE, DIAMOND, DIAMOND_DOWN, GLYPHS, GRAY, OUTLINE, PARALLELOGRAM,
    SHADES, SOLID, SQUARE, TOMBSTONE, TRAPEZOID, TRAPEZOID_DOWN, TRIANGLE, TRIANGLE_DOWN,
    glyph_for, size_change,
)
