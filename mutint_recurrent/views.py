"""The Recurrent page: the derivation as JSON, the controls, and the two views drawn by the
page's own scripts."""

import logging

from django.http import HttpResponse
from django.shortcuts import render
from django.template import loader
from django.urls import reverse

import mutint_sample.views.common
from mutint_common.logger import user_extra
from mutint_common.preferences import get_preferences
from mutint_common.util import get_user_context
from mutint_export.util import safe_filename
from mutint_import.annotate.annotator import PROMOTER_DISTANCE
from mutint_experiment import models
from mutint_recurrent.analysis import recurrent_genes
from mutint_recurrent.glyphs import GLYPHS, SHADES

logger = logging.getLogger(__name__)

#: Every preference this page remembers is under this prefix.
PREFERENCE_PREFIX = "recurrent."

#: The gene columns a reader can show or hide; Gene itself is always shown.
COLUMNS = (
    ("locus_tag", "Locus tag", False),
    ("location", "Gene location", False),
    ("product", "Description", True),
)

DEFAULT_MINIMUM = 2


def recurrent(request):
    context = get_user_context(request.user)
    try:
        experiment = mutint_sample.views.common.get_experiment(request)
    except models.Experiment.DoesNotExist:
        return mutint_sample.views.common.no_experiment_selected(
            request, context, logger, "recurrent genes")
    except ValueError:
        return render(request, "403.html", context, status=403)

    data = recurrent_genes(experiment)
    user = request.user
    authenticated = bool(user is not None and user.is_authenticated)
    context.update({
        "experiment_id": experiment.id,
        "experiment_name": experiment.name,
        "project_name": experiment.project.name,
        "project_id": experiment.project.id,
        "title": experiment.name + " Recurrent",
        # What a download is named by: the project and the experiment, never an id.
        "file_stem": "%s_%s" % (safe_filename(experiment.project.name),
                                safe_filename(experiment.name)),
        "data": data,
        "columns": [{"key": key, "title": title, "default_visible": visible}
                    for key, title, visible in COLUMNS],
        "glyphs": GLYPHS,
        "shades": SHADES,
        "default_minimum": min(DEFAULT_MINIMUM, max(data["max_count"], 1)),
        # The annotator's own promoter rule, so the sentence cannot drift from the code.
        "promoter_distance": PROMOTER_DISTANCE,
        "authenticated": authenticated,
        "preferences": get_preferences(user, PREFERENCE_PREFIX) if authenticated else {},
        "preferences_url": reverse("preferences"),
    })
    logger.info("recurrent page", extra=user_extra(request))
    return HttpResponse(loader.get_template("recurrent/page.html").render(context, request))
