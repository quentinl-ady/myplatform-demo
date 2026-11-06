import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MaterialModule } from '../material.module';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { WebhookService } from '../services';
import { WebhookEvent } from '../models';
import { InlineAlertComponent, NotifyService, formatDateTime, formatTimeAgo, httpErrorMessage } from '../shared';

@Component({
  selector: 'app-webhooks',
  standalone: true,
  imports: [CommonModule, MaterialModule, FormsModule, InlineAlertComponent],
  templateUrl: './webhooks.component.html',
  styleUrl: './webhooks.component.css'
})
export class WebhooksComponent implements OnInit, OnDestroy {
  private static readonly POLL_INTERVAL_MS = 15000;

  private route = inject(ActivatedRoute);
  private webhookService = inject(WebhookService);
  private notify = inject(NotifyService);
  private liveAnnouncer = inject(LiveAnnouncer);

  userId = '';
  events: WebhookEvent[] = [];
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly pushing = signal(false);
  readonly acknowledgingAll = signal(false);
  readonly acknowledgingIds = signal<ReadonlySet<number>>(new Set());
  /** Field error of the payload editor (invalid JSON). */
  jsonError = '';
  sendError = '';
  ackAllError = '';
  /** Failed "Mark as read" on a single row, shown under that row. */
  ackError: { id: number; message: string } | null = null;
  expandedEventId: number | null = null;
  showRawJsonId: number | null = null;
  filter: 'all' | 'unread' = 'all';
  devToolsOpen = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private subscriptions = new Subscription();
  private fetchSub?: Subscription;
  private initialLoadDone = false;

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

  ngOnInit() {
    const params$ = this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadEvents();
        this.startPolling();
      }
    });
    if (params$) this.subscriptions.add(params$);

    this.subscriptions.add(
      this.webhookService.onWebhookReceived$.subscribe(() => this.refreshEvents())
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.fetchSub?.unsubscribe();
    this.stopPolling();
  }

  private startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.refreshEvents(), WebhooksComponent.POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  loadEvents() {
    this.loading.set(true);
    this.loadError.set(null);
    this.initialLoadDone = false;
    this.fetchEvents(true);
  }

  private refreshEvents() {
    if (this.loading() || !this.userId) return;
    this.fetchEvents(false);
  }

  private fetchEvents(isFullLoad: boolean) {
    const obs = this.filter === 'unread'
      ? this.webhookService.getUnreadEvents(this.userId)
      : this.webhookService.getEvents(this.userId);

    this.fetchSub?.unsubscribe();
    this.fetchSub = obs.subscribe({
      next: incoming => {
        if (!this.initialLoadDone || isFullLoad) {
          this.events = incoming;
          this.initialLoadDone = true;
        } else {
          this.mergeEvents(incoming);
        }
        this.loadError.set(null);
        this.loading.set(false);
      },
      error: err => {
        if (isFullLoad || !this.initialLoadDone) {
          this.loadError.set(httpErrorMessage(err, 'Unable to load the notifications. Try again.'));
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
      this.events = this.events.filter(e => !e.acknowledged || e.id === this.expandedEventId);
    }
  }

  onJsonInputChange() {
    this.jsonError = '';
  }

  pushEvent() {
    if (this.pushing()) return;
    this.sendError = '';
    try {
      JSON.parse(this.jsonInput);
    } catch {
      this.jsonError = 'The payload isn\'t valid JSON. Check the brackets and quotes.';
      // After the error renders, so aria-describedby already includes it when focus lands.
      setTimeout(() => document.getElementById('webhook-json')?.focus());
      return;
    }

    this.pushing.set(true);
    this.webhookService.pushWebhook(this.jsonInput).subscribe({
      next: event => {
        this.notify.success(
          event.userId
            ? `Test event received and matched to user ${event.userId}.`
            : 'Test event received. It doesn\'t match any user.'
        );
        this.pushing.set(false);
        this.webhookService.notifyWebhookReceived();
        this.loadEvents();
      },
      error: err => {
        this.sendError = httpErrorMessage(err, 'Check the payload, then try again.');
        this.pushing.set(false);
      }
    });
  }

  isAcknowledging(event: WebhookEvent): boolean {
    return this.acknowledgingIds().has(event.id);
  }

  private setAcknowledging(id: number, busy: boolean) {
    const next = new Set(this.acknowledgingIds());
    if (busy) next.add(id); else next.delete(id);
    this.acknowledgingIds.set(next);
  }

  acknowledgeEvent(event: WebhookEvent) {
    if (this.isAcknowledging(event)) return;
    this.setAcknowledging(event.id, true);
    if (this.ackError?.id === event.id) this.ackError = null;
    this.webhookService.acknowledgeEvent(event.id).subscribe({
      next: () => {
        event.acknowledged = true;
        this.setAcknowledging(event.id, false);
        this.webhookService.notifyWebhookReceived();
        this.liveAnnouncer.announce(`"${event.title || 'Notification'}" marked as read`);
      },
      error: err => {
        this.setAcknowledging(event.id, false);
        this.ackError = { id: event.id, message: httpErrorMessage(err, 'The notification is still unread. Try again.') };
      }
    });
  }

  acknowledgeAll() {
    const count = this.unreadCount;
    if (!count || this.acknowledgingAll()) return;
    this.acknowledgingAll.set(true);
    this.ackAllError = '';
    this.webhookService.acknowledgeAll(this.userId).subscribe({
      next: () => {
        this.events.forEach(ev => ev.acknowledged = true);
        this.acknowledgingAll.set(false);
        this.webhookService.notifyWebhookReceived();
        this.notify.success(count === 1 ? '1 notification marked as read.' : `${count} notifications marked as read.`);
      },
      error: err => {
        this.acknowledgingAll.set(false);
        this.ackAllError = httpErrorMessage(err, 'The notifications are still unread. Try again.');
      }
    });
  }

  onRowClick(event: WebhookEvent) {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }
    this.toggleExpand(event);
  }

  toggleExpand(event: WebhookEvent) {
    this.expandedEventId = this.expandedEventId === event.id ? null : event.id;
    this.showRawJsonId = null;
  }

  toggleRawJson(event: WebhookEvent) {
    this.showRawJsonId = this.showRawJsonId === event.id ? null : event.id;
  }

  openSimulator() {
    this.devToolsOpen = true;
    setTimeout(() => document.getElementById('webhook-json')?.focus());
  }

  formatJson(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  getEventIcon(webhookType: string, eventType: string): string {
    eventType = eventType || '';
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
      case 'report': return 'description';
      default: return 'notifications';
    }
  }

  getCategoryLabel(webhookType: string): string {
    switch (webhookType) {
      case 'configuration': return 'Account';
      case 'transfer': return 'Transfer';
      case 'transaction': return 'Transaction';
      case 'standard': return 'Payment';
      case 'report': return 'Report';
      default: return 'System';
    }
  }

  getTimeAgo(dateStr: string): string {
    return formatTimeAgo(dateStr);
  }

  getDateTime(dateStr: string): string {
    return formatDateTime(dateStr);
  }

  setFilter(filter: 'all' | 'unread') {
    if (this.filter === filter) return;
    this.filter = filter;
    this.expandedEventId = null;
    this.showRawJsonId = null;
    this.loadEvents();
  }

  get unreadCount(): number {
    return this.events.filter(e => !e.acknowledged).length;
  }

  trackById(_: number, event: WebhookEvent) {
    return event.id;
  }
}
