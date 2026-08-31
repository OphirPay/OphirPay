# models.py
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

class BatchProgress(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_PROCESSING = 'processing'
    STATUS_SUCCESS = 'success'
    STATUS_FAILED = 'failed'
    
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_PROCESSING, 'Processing'),
        (STATUS_SUCCESS, 'Success'),
        (STATUS_FAILED, 'Failed'),
    ]
    
    batch_id = models.CharField(max_length=255, db_index=True)
    item_id = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    retry_count = models.PositiveIntegerField(default=0)
    max_retries = models.PositiveIntegerField(default=3)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ('batch_id', 'item_id')
        indexes = [
            models.Index(fields=['batch_id', 'status']),
            models.Index(fields=['status', 'retry_count']),
        ]

# tasks.py
import json
import time
from celery import shared_task
from celery.exceptions import Retry
from django.utils import timezone
from .models import BatchProgress

@shared_task(bind=True, max_retries=None)
def process_batch_item(self, batch_id, item_id, payload, retry_count=0):
    """Process a single batch item with retry logic"""
    try:
        # Mark as processing
        progress, _ = BatchProgress.objects.update_or_create(
            batch_id=batch_id,
            item_id=item_id,
            defaults={'status': BatchProgress.STATUS_PROCESSING}
        )
        
        # Simulate item processing (replace with actual business logic)
        result = process_item_logic(payload)
        
        # Mark as success
        progress.status = BatchProgress.STATUS_SUCCESS
        progress.save()
        
        return {'status': 'success', 'item_id': item_id, 'result': result}
        
    except Exception as exc:
        progress = BatchProgress.objects.get(batch_id=batch_id, item_id=item_id)
        progress.retry_count += 1
        progress.error_message = str(exc)
        
        if progress.retry_count >= progress.max_retries:
            progress.status = BatchProgress.STATUS_FAILED
            progress.save()
            return {'status': 'failed', 'item_id': item_id, 'error': str(exc)}
        else:
            # Calculate exponential backoff delay (max 300 seconds)
            delay = min(2 ** progress.retry_count * 60, 300)
            progress.status = BatchProgress.STATUS_PENDING
            progress.save()
            raise self.retry(
                countdown=delay,
                exc=exc,
                kwargs={
                    'batch_id': batch_id,
                    'item_id': item_id,
                    'payload': payload,
                    'retry_count': progress.retry_count
                }
            )

def process_item_logic(payload):
    """Placeholder for actual item processing logic"""
    # Simulate processing that might fail
    if payload.get('fail'):
        raise ValueError("Simulated processing failure")
    return f"Processed: {payload.get('data')}"

@shared_task
def process_batch(batch_id, items):
    """Process all items in a batch"""
    for item in items:
        process_batch_item.delay(
            batch_id=batch_id,
            item_id=item['id'],
            payload=item['payload']
        )

# views.py
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import BatchProgress

class BatchProgressViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = BatchProgress.objects.all()
    lookup_field = 'batch_id'
    
    def get_queryset(self):
        queryset = BatchProgress.objects.all()
        batch_id = self.kwargs.get('batch_id')
        if batch_id:
            queryset = queryset.filter(batch_id=batch_id)
        return queryset
    
    @action(detail=False, methods=['get'], url_path='batch/(?P<batch_id>[^/.]+)')
    def get_batch_progress(self, request, batch_id=None):
        """Get progress summary for a batch"""
        batch_progress = BatchProgress.objects.filter(batch_id=batch_id)
        total = batch_progress.count()
        completed = batch_progress.filter(status=BatchProgress.STATUS_SUCCESS).count()
        failed = batch_progress.filter(status=BatchProgress.STATUS_FAILED).count()
        pending = batch_progress.filter(status__in=[BatchProgress.STATUS_PENDING, BatchProgress.STATUS_PROCESSING]).count()
        
        return Response({
            'batch_id': batch_id,
            'total': total,
            'completed': completed,
            'failed': failed,
            'pending': pending,
            'completion_percentage': round((completed / total * 100), 2) if total > 0 else 100
        })
    
    @action(detail=False, methods=['post'], url_path='retry-failed')
    def retry_failed_items(self, request):
        """Retry all failed items in a batch"""
        batch_id = request.data.get('batch_id')
        if not batch_id:
            return Response({'error': 'batch_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        failed_items = BatchProgress.objects.filter(
            batch_id=batch_id,
            status=BatchProgress.STATUS_FAILED,
            retry_count__lt=F('max_retries')
        )
        
        for item in failed_items:
            # Re-queue failed items for retry
            process_batch_item.delay(
                batch_id=item.batch_id,
                item_id=item.item_id,
                payload={},  # In practice, store payload in DB or external system
                retry_count=item.retry_count
            )
            item.status = BatchProgress.STATUS_PENDING
            item.save()
        
        return Response({
            'message': f'Retried {failed_items.count()} failed items',
            'batch_id': batch_id
        })