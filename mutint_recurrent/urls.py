from django.urls import re_path

from mutint_recurrent import views

# Mounted under ^recurrent/ by apps.py.
urlpatterns = [
    re_path(r'^$', views.recurrent, name='recurrent'),
]
