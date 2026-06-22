from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("books/", include("bookkeeper.urls", namespace="bookkeeper")),
]
