from django.apps import AppConfig


class RecurrentConfig(AppConfig):
    """The Recurrent page: genes mutated in several independent populations.

    One page in the experiment section, an About section, and nothing stored -- the whole
    answer is derived by the request that renders it, from the gene lists the annotator
    already writes on every mutation.
    """

    name = 'mutint_recurrent'

    def ready(self):
        from django.urls import include, re_path
        from mutint_common.about_registry import register_about_section
        from mutint_common.nav_registry import EXPERIMENT_SECTION, register_nav_item
        from mutint_common.plugin_registry import register_plugin_urlpatterns
        from mutint_recurrent.version import __version__

        register_plugin_urlpatterns([
            re_path(r'^recurrent/', include('mutint_recurrent.urls')),
        ])
        # url_name rather than a literal path: nav_registry skips an entry whose name will not
        # reverse, so a half-installed plugin cannot leave a dead link in the sidebar.
        register_nav_item('Recurrent', url_name='recurrent', section=EXPERIMENT_SECTION)
        register_about_section(self, name='mutint-recurrent', version=__version__,
                               template='about/sections/mutint_recurrent.html')
