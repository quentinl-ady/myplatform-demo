import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { WebhookService } from '../services';
import { WebhookEvent } from '../models';

@Component({
  selector: 'app-webhooks',
  standalone: true,
  imports: [CommonModule, MaterialModule, FormsModule],
  templateUrl: './webhooks.component.html',
  styleUrl: './webhooks.component.css'
})
export class WebhooksComponent implements OnInit, OnDestroy {

  userId = '';
  events: WebhookEvent[] = [];
  loading = signal(false);
  pushing = signal(false);
  expandedEventId: number | null = null;
  showRawJsonId: number | null = null;
  filter: 'all' | 'unread' = 'all';
  devToolsOpen = false;
  private pollInterval?: any;
  private webhookSub?: Subscription;

  jsonInput = `{
  "type": "balancePlatform.transfer.updated",
  "data": {
    "accountHolder": { "id": "AH00000000000000000000001" },
    "balanceAccount": { "id": "BA00000000000000000000001" },
    "amount": { "value": 5000, "currency": "EUR" },
    "direction": "incoming",
    "status": "captured",
    "category": "platformPayment"
  }
}`;

  constructor(
    private route: ActivatedRoute,
    private webhookService: WebhookService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadEvents();
        this.startPolling();
      }
    });

    this.webhookSub = this.webhookService.onWebhookReceived$.subscribe(() => {
      this.refreshEvents();
    });
  }

  ngOnDestroy() {
    this.webhookSub?.unsubscribe();
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  private initialLoadDone = false;

  private startPolling() {
    this.pollInterval = setInterval(() => this.refreshEvents(), 15000);
  }

  loadEvents() {
    this.loading.set(true);
    this.initialLoadDone = false;
    this.fetchEvents(true);
  }

  private refreshEvents() {
    this.fetchEvents(false);
  }

  private fetchEvents(isFullLoad: boolean) {
    const obs = this.filter === 'unread'
      ? this.webhookService.getUnreadEvents(this.userId)
      : this.webhookService.getEvents(this.userId);

    obs.subscribe({
      next: incoming => {
        if (!this.initialLoadDone || isFullLoad) {
          this.events = incoming;
          this.initialLoadDone = true;
        } else {
          this.mergeEvents(incoming);
        }
        this.loading.set(false);
      },
      error: () => {
        if (isFullLoad) {
          this.snackBar.open('Failed to load notifications', 'Close', { duration: 3000 });
        }
        this.loading.set(false);
      }
    });
  }

  private mergeEvents(incoming: WebhookEvent[]) {
    const existingIds = new Set(this.events.map(e => e.id));
    const newEvents = incoming.filter(e => !existingIds.has(e.id));

    if (newEvents.length > 0) {
      this.events = [...newEvents, ...this.events];
    }

    const incomingMap = new Map(incoming.map(e => [e.id, e]));
    for (const event of this.events) {
      const updated = incomingMap.get(event.id);
      if (updated) {
        event.acknowledged = updated.acknowledged;
      }
    }

    if (this.filter === 'unread') {
      this.events = this.events.filter(e => !e.acknowledged);
    }
  }

  pushEvent() {
    try {
      JSON.parse(this.jsonInput);
    } catch {
      this.snackBar.open('Invalid JSON format', 'Close', { duration: 3000 });
      return;
    }

    this.pushing.set(true);
    this.webhookService.pushWebhook(this.jsonInput).subscribe({
      next: event => {
        this.snackBar.open(
          event.userId
            ? `Notification created — matched to user ${event.userId}`
            : 'Notification created — no user matched',
          'Close', { duration: 4000 }
        );
        this.pushing.set(false);
        this.webhookService.notifyWebhookReceived();
        this.loadEvents();
      },
      error: () => {
        this.snackBar.open('Failed to push event', 'Close', { duration: 3000 });
        this.pushing.set(false);
      }
    });
  }

  acknowledgeEvent(event: WebhookEvent, e: MouseEvent) {
    e.stopPropagation();
    this.webhookService.acknowledgeEvent(event.id).subscribe({
      next: () => {
        event.acknowledged = true;
        this.webhookService.notifyWebhookReceived();
      }
    });
  }

  acknowledgeAll() {
    this.webhookService.acknowledgeAll(this.userId).subscribe({
      next: () => {
        this.events.forEach(ev => ev.acknowledged = true);
        this.webhookService.notifyWebhookReceived();
        this.snackBar.open('All notifications marked as read', 'Close', { duration: 2000 });
      }
    });
  }

  toggleExpand(event: WebhookEvent) {
    this.expandedEventId = this.expandedEventId === event.id ? null : event.id;
    this.showRawJsonId = null;
  }

  toggleRawJson(event: WebhookEvent, e: MouseEvent) {
    e.stopPropagation();
    this.showRawJsonId = this.showRawJsonId === event.id ? null : event.id;
  }

  formatJson(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  getEventIcon(webhookType: string, eventType: string): string {
    if (eventType.includes('verification') || eventType.includes('accountHolder')) return 'verified_user';
    if (eventType.includes('transfer')) return 'swap_horiz';
    if (eventType.includes('paymentInstrument')) return 'credit_card';
    if (eventType.includes('balanceAccount') && !eventType.includes('Sweep')) return 'account_balance';
    if (eventType.includes('Sweep')) return 'autorenew';
    if (eventType === 'AUTHORISATION') return 'check_circle';
    if (eventType === 'CAPTURE') return 'savings';
    if (eventType === 'REFUND') return 'undo';
    if (eventType === 'CHARGEBACK') return 'warning';
    if (eventType === 'CANCELLATION') return 'cancel';
    switch (webhookType) {
      case 'configuration': return 'settings';
      case 'transfer': return 'swap_horiz';
      case 'transaction': return 'receipt_long';
      case 'standard': return 'payment';
      default: return 'notifications';
    }
  }

  getCategoryLabel(webhookType: string): string {
    switch (webhookType) {
      case 'configuration': return 'Account';
      case 'transfer': return 'Transfer';
      case 'transaction': return 'Transaction';
      case 'standard': return 'Payment';
      default: return 'System';
    }
  }

  getTimeAgo(dateStr: string): string {
    const normalized = dateStr.endsWith('Z') || dateStr.includes('+') || dateStr.includes('-', 10)
      ? dateStr
      : dateStr + 'Z';
    const date = new Date(normalized);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  setFilter(filter: 'all' | 'unread') {
    this.filter = filter;
    this.loadEvents();
  }

  get unreadCount(): number {
    return this.events.filter(e => !e.acknowledged).length;
  }
}
