from django.http import JsonResponse
from django.templatetags.static import static


def manifest(request):
    data = {
        "name": "Bookkeeper",
        "short_name": "Bookkeeper",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#f9f7f4",
        "theme_color": "#7c3aed",
        "icons": [
            {
                "src": request.build_absolute_uri(static("bookkeeper/icon-192.png")),
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any maskable",
            },
            {
                "src": request.build_absolute_uri(static("bookkeeper/icon-512.png")),
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any maskable",
            },
        ],
    }
    return JsonResponse(data, content_type="application/json")
