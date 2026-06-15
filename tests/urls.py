from django.urls import include, path

urlpatterns = [
    path("books/", include("bookkeeper.urls", namespace="bookkeeper")),
]
