from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/models/", views.models, name="models"),
    path("api/chat/", views.chat, name="chat"),
]
