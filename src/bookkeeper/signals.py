from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import ReadingProgress, UserBook


@receiver(post_save, sender=ReadingProgress)
def update_last_read_on_progress(sender, instance, **kwargs):
    """Keep UserBook.date_last_read in sync whenever progress is saved."""
    from django.utils import timezone

    UserBook.objects.filter(user=instance.user, book=instance.book).update(
        date_last_read=timezone.now()
    )
