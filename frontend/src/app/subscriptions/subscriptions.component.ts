import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { MaterialModule } from '../material.module';
import { Customer, CustomerSubscription, SubscriptionEvent, SubscriptionInvoice, SubscriptionSettings } from '../models';
import { CustomerService, DemoDataService, InvoiceService, SubscriptionService, demoDataSummary } from '../services';
import {
  ConfirmService, InlineAlertComponent, InlineAlertKind, MoneyPipe, NotifyService, formatDate, formatDateTime, formatMoney,
  formatTimeAgo, httpErrorMessage
} from '../shared';
import { formatRate, plural } from '../invoices/invoice-view';
import { SubscriptionDialogComponent, SubscriptionDialogData } from './subscription-dialog.component';
import {
  OutcomeOption, cycleStatus, firstInvoice, monthlyRevenue, nextStepText, openInvoice, periodNoun, periodText, rescuing,
  settling, subscriptionEventView, subscriptionStatus, testOutcomes, unpaid
} from './subscription-view';

type Filter = 'all' | 'active' | 'pastDue' | 'awaiting' | 'cancelled';
type SubscriptionAction = 'run' | 'stop' | 'cancel' | 'send';

/** While Adyen settles a payment or a charge, the list refreshes on its own, so the outcome shows without reloading. */
const POLL_INTERVAL_MS = 10_000;

interface Kpis {
  /** Excluding tax, from the active and past due subscriptions. */
  mrr: number;
  billing: number;
  active: number;
  awaiting: number;
  pastDue: number;
  /** The unpaid invoices of the past due subscriptions. */
  pastDueAmount: number;
  rescuing: number;
}

interface RowNotice {
  id: number;
  kind: InlineAlertKind;
  title: string;
  message: string;
}

interface Announcement {
  text: string;
  good: boolean;
}

/** Totals of the subscriptions in the currency of the account. */
function kpisOf(subscriptions: CustomerSubscription[], currency: string | null): Kpis {
  const kpis: Kpis = { mrr: 0, billing: 0, active: 0, awaiting: 0, pastDue: 0, pastDueAmount: 0, rescuing: 0 };
  for (const subscription of subscriptions) {
    if (currency && subscription.currency !== currency) continue;
    switch (subscription.status) {
      case 'ACTIVE':
        kpis.active++;
        break;
      case 'AWAITING_PAYMENT_METHOD':
        kpis.awaiting++;
        break;
      case 'PAST_DUE':
        kpis.pastDue++;
        for (const invoice of subscription.invoices) {
          if (unpaid(invoice)) kpis.pastDueAmount += invoice.total;
          if (rescuing(invoice)) kpis.rescuing++;
        }
        break;
    }
    if (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') {
      kpis.mrr += monthlyRevenue(subscription);
      kpis.billing++;
    }
  }
  return kpis;
}

function matches(subscription: CustomerSubscription, filter: Filter): boolean {
  switch (filter) {
    case 'active':
      return subscription.status === 'ACTIVE';
    case 'pastDue':
      return subscription.status === 'PAST_DUE';
    case 'awaiting':
      return subscription.status === 'AWAITING_PAYMENT_METHOD';
    case 'cancelled':
      return subscription.status === 'CANCELLED';
    default:
      return true;
  }
}

/** What Adyen settled for the subscription since the page last showed it, if anything worth telling. */
function changeOf(before: CustomerSubscription, after: CustomerSubscription): Announcement | null {
  const name = after.customer.displayName;
  const previous = new Map(before.invoices.map(invoice => [invoice.id, invoice]));
  const paid = after.invoices.find(invoice => invoice.status === 'PAID' && previous.get(invoice.id)?.status !== 'PAID');
  if (before.status !== after.status) {
    if (after.status === 'ACTIVE' && before.status === 'AWAITING_PAYMENT_METHOD') {
      const method = after.paymentMethod?.label ?? 'the stored payment method';
      return { text: `The subscription of ${name} is active: the next cycles are charged to ${method}.`, good: true };
    }
    if (after.status === 'ACTIVE' && before.status === 'PAST_DUE') {
      if (paid && previous.get(paid.id)?.chargeStatus === 'RESCUING') {
        return { text: `Auto Rescue recovered ${paid.number}: the subscription of ${name} is active again.`, good: true };
      }
      return { text: `${paid ? paid.number : 'The unpaid invoice'} is paid: the subscription of ${name} is active again.`, good: true };
    }
    if (after.status === 'PAST_DUE') {
      return { text: `A charge was refused: the subscription of ${name} is past due.`, good: false };
    }
    return null;
  }
  if (paid) {
    return { text: `${paid.number} is paid: ${formatMoney(paid.total, after.currency)} from ${name}.`, good: true };
  }
  const ended = after.invoices.find(invoice =>
    invoice.chargeStatus === 'REFUSED' && previous.get(invoice.id)?.chargeStatus === 'RESCUING');
  return ended ? { text: `Auto Rescue couldn't recover ${ended.number}: it's still unpaid.`, good: false } : null;
}

@Component({
  selector: 'app-subscriptions',
  standalone: true,
  imports: [CommonModule, RouterLink, MaterialModule, MatMenuModule, MoneyPipe, InlineAlertComponent],
  templateUrl: './subscriptions.component.html',
  styleUrls: ['../invoices/invoices.component.css', './subscriptions.component.css']
})
export class SubscriptionsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private subscriptionService = inject(SubscriptionService);
  private invoiceService = inject(InvoiceService);
  private customerService = inject(CustomerService);
  private demoDataService = inject(DemoDataService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  private confirmService = inject(ConfirmService);
  private liveAnnouncer = inject(LiveAnnouncer);
  private destroyRef = inject(DestroyRef);

  userId = '';
  readonly settings = signal<SubscriptionSettings | null>(null);
  readonly subscriptions = signal<CustomerSubscription[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly filter = signal<Filter>('all');
  readonly expandedId = signal<number | null>(null);
  /** One action at a time. */
  readonly pending = signal<{ id: number; action: SubscriptionAction; invoiceId?: number } | null>(null);
  /** The outcome of an action, shown under the row of its subscription. */
  readonly rowNotice = signal<RowNotice | null>(null);
  /** The invoice whose payment link was just copied. */
  readonly copiedId = signal<number | null>(null);
  readonly loadingDemo = signal(false);
  readonly demoError = signal<string | null>(null);
  readonly demoWarnings = signal<string[]>([]);

  readonly canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  readonly subscriptionStatus = subscriptionStatus;
  readonly cycleStatus = cycleStatus;
  readonly eventView = subscriptionEventView;
  readonly firstInvoice = firstInvoice;
  readonly openInvoice = openInvoice;
  readonly periodNoun = periodNoun;
  readonly periodText = periodText;
  readonly nextStepText = nextStepText;
  readonly testOutcomes = testOutcomes;
  readonly unpaid = unpaid;
  readonly formatRate = formatRate;
  readonly plural = plural;

  readonly currency = computed(() => this.settings()?.currency ?? this.subscriptions()[0]?.currency ?? null);
  readonly taxLabel = computed(() => this.settings()?.taxLabel ?? 'VAT');
  readonly kpis = computed(() => kpisOf(this.subscriptions(), this.currency()));
  readonly counts = computed(() => {
    const subscriptions = this.subscriptions();
    return {
      pastDue: subscriptions.filter(s => s.status === 'PAST_DUE').length,
      awaiting: subscriptions.filter(s => s.status === 'AWAITING_PAYMENT_METHOD').length,
    };
  });
  readonly visibleSubscriptions = computed(() => {
    const filter = this.filter();
    return this.subscriptions().filter(subscription => matches(subscription, filter));
  });
  readonly expandedSubscription = computed(() => this.subscriptions().find(s => s.id === this.expandedId()) ?? null);

  private fetchSub?: Subscription;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  /** The subscription to open once the list is loaded, e.g. when coming from one of its invoices. */
  private focusId: number | null = null;

  ngOnInit(): void {
    const focus = Number(this.route.snapshot.queryParamMap.get('subscription'));
    this.focusId = Number.isInteger(focus) && focus > 0 ? focus : null;

    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      this.reset();
      if (this.userId) this.load();
    });

    const poll = setInterval(() => this.refreshWhileWaiting(), POLL_INTERVAL_MS);
    this.destroyRef.onDestroy(() => {
      clearInterval(poll);
      clearTimeout(this.copiedTimer);
      this.fetchSub?.unsubscribe();
    });
  }

  /** Back from paying the first invoice in another tab: the payment shows at once. */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    this.refreshWhileWaiting();
  }

  load(): void {
    if (!this.userId) return;
    const userId = this.userId;
    this.fetchSub?.unsubscribe();
    this.loading.set(true);
    this.refreshing.set(false);
    this.loadError.set(null);
    this.fetchSub = forkJoin({
      settings: this.subscriptionService.getSettings(userId),
      subscriptions: this.subscriptionService.getSubscriptions(userId),
      customers: this.customerService.getCustomers(userId),
    }).subscribe({
      next: ({ settings, subscriptions, customers }) => {
        this.settings.set(settings);
        this.setSubscriptions(subscriptions ?? [], true);
        this.customers.set(customers ?? []);
        this.loading.set(false);
        this.openFocused();
      },
      error: err => {
        this.loadError.set(httpErrorMessage(err, 'Unable to load the subscriptions. Try again.'));
        this.loading.set(false);
      }
    });
  }

  private reset(): void {
    this.fetchSub?.unsubscribe();
    this.settings.set(null);
    this.subscriptions.set([]);
    this.customers.set([]);
    this.loading.set(false);
    this.refreshing.set(false);
    this.loadError.set(null);
    this.expandedId.set(null);
    this.rowNotice.set(null);
    this.demoError.set(null);
    this.demoWarnings.set([]);
  }

  private openFocused(): void {
    const id = this.focusId;
    this.focusId = null;
    if (id === null || !this.subscriptions().some(subscription => subscription.id === id)) return;
    this.filter.set('all');
    this.expandedId.set(id);
    setTimeout(() => document.getElementById(`subscription-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  private refreshWhileWaiting(): void {
    if (document.hidden || !this.subscriptions().some(settling)) return;
    this.refresh();
  }

  /** A silent refresh keeps the current page when it fails. */
  private refresh(): void {
    if (!this.userId || this.loading() || this.refreshing() || this.pending()) return;
    const userId = this.userId;
    const expanded = this.expandedSubscription();
    // The backend checks the invoices of an open subscription at Adyen more often than those of the list.
    const detail$ = expanded && settling(expanded)
      ? this.subscriptionService.getSubscription(userId, expanded.id).pipe(catchError(() => of(null)))
      : of(null);
    this.refreshing.set(true);
    this.fetchSub = detail$.pipe(
      switchMap(() => this.subscriptionService.getSubscriptions(userId))
    ).subscribe({
      next: subscriptions => {
        this.setSubscriptions(subscriptions ?? [], true);
        this.refreshing.set(false);
      },
      error: () => this.refreshing.set(false)
    });
  }

  /** A refresh that started before an action would bring back the subscription as it was. */
  private cancelRefresh(): void {
    if (this.refreshing()) {
      this.fetchSub?.unsubscribe();
      this.refreshing.set(false);
    }
  }

  private refreshCustomers(): void {
    const userId = this.userId;
    this.customerService.getCustomers(userId).subscribe({
      next: customers => {
        if (userId === this.userId) this.customers.set(customers ?? []);
      },
      // The dialog lists them again next time it opens.
      error: () => undefined
    });
  }

  /** What an action changed is told by the action itself: only the refreshes announce changes. */
  private setSubscriptions(subscriptions: CustomerSubscription[], announce: boolean): void {
    if (announce) this.announceChanges(this.subscriptions(), subscriptions);
    this.subscriptions.set(subscriptions);
    const expanded = this.expandedId();
    if (expanded !== null && !subscriptions.some(subscription => subscription.id === expanded)) {
      this.expandedId.set(null);
    }
  }

  /** Replaces the subscription, or adds it at the top: the latest comes first. */
  private upsert(subscription: CustomerSubscription): void {
    this.cancelRefresh();
    const current = this.subscriptions();
    this.setSubscriptions(current.some(s => s.id === subscription.id)
      ? current.map(s => s.id === subscription.id ? subscription : s)
      : [subscription, ...current], false);
  }

  private announceChanges(previous: CustomerSubscription[], current: CustomerSubscription[]): void {
    if (!previous.length) return;
    const before = new Map(previous.map(subscription => [subscription.id, subscription]));
    const announcements: Announcement[] = [];
    for (const subscription of current) {
      const old = before.get(subscription.id);
      const change = old ? changeOf(old, subscription) : null;
      if (change) announcements.push(change);
    }
    if (!announcements.length) return;
    const message = announcements.map(announcement => announcement.text).join(' ');
    if (announcements.every(announcement => announcement.good)) {
      this.notify.success(message);
    } else {
      this.notify.info(message);
    }
  }

  // ---------- List ----------

  setFilter(filter: Filter): void {
    this.filter.set(filter);
  }

  emptyFilterText(): string {
    switch (this.filter()) {
      case 'active':
        return 'No active subscriptions';
      case 'pastDue':
        return 'No past due subscriptions';
      case 'awaiting':
        return 'No subscriptions awaiting their first payment';
      case 'cancelled':
        return 'No cancelled subscriptions';
      default:
        return 'No subscriptions';
    }
  }

  toggle(subscription: CustomerSubscription, event?: Event): void {
    event?.preventDefault();
    const selection = window.getSelection();
    if (event?.type === 'click' && selection && selection.toString().length > 0) return;
    const opening = this.expandedId() !== subscription.id;
    this.expandedId.set(opening ? subscription.id : null);
    if (opening && settling(subscription)) {
      // Opens on what Adyen reports now.
      this.refresh();
    }
  }

  // ---------- Actions ----------

  newSubscription(): void {
    const settings = this.settings();
    if (!settings) return;
    const ref = this.dialog.open<SubscriptionDialogComponent, SubscriptionDialogData, CustomerSubscription>(
      SubscriptionDialogComponent, {
        data: { userId: this.userId, settings, customers: this.customers() },
        width: '720px',
        maxWidth: 'calc(100vw - 32px)',
        autoFocus: '#subscription-customer',
        restoreFocus: true,
      });
    ref.afterClosed().subscribe(subscription => {
      // A customer may have been added from the dialog.
      this.refreshCustomers();
      if (!subscription) return;
      this.upsert(subscription);
      this.filter.set('all');
      this.expandedId.set(subscription.id);
      if (subscription.warning) {
        this.rowNotice.set({
          id: subscription.id, kind: 'warning', title: "The first invoice wasn't sent", message: subscription.warning,
        });
      } else {
        this.rowNotice.set(null);
        const first = firstInvoice(subscription);
        this.notify.success(first?.paymentLinkUrl
          ? `Subscription created: ${first.number} sent to ${subscription.customer.email} with a payment link.`
          : 'Subscription created.');
      }
      setTimeout(() => document.getElementById(`subscription-${subscription.id}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    });
  }

  /** Bills the next cycle and charges it, or charges the unpaid invoice of the last cycle again. */
  runCycle(subscription: CustomerSubscription, outcome?: OutcomeOption): void {
    if (this.pending() || subscription.runCycleBlocked) return;
    const retry = subscription.retryInvoiceNumber ?? null;
    this.rowNotice.set(null);
    this.pending.set({ id: subscription.id, action: 'run' });
    this.subscriptionService.runCycle(this.userId, subscription.id, outcome?.value).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.announceCharge(updated, retry);
      },
      error: err => {
        this.pending.set(null);
        this.rowNotice.set({
          id: subscription.id,
          kind: 'error',
          title: retry ? `Unable to charge ${retry} again` : 'Unable to run the billing cycle',
          message: httpErrorMessage(err, "The invoice couldn't be charged. Try again."),
        });
        // Adyen may have rejected the charge after the cycle was invoiced.
        this.refresh();
      }
    });
  }

  /** How Adyen answered the charge: paid at once, pending, or refused. */
  private announceCharge(subscription: CustomerSubscription, retryNumber: string | null): void {
    const invoice = retryNumber
      ? subscription.invoices.find(i => i.number === retryNumber)
      : subscription.invoices[0];
    if (!invoice) return;
    const method = subscription.paymentMethod?.label ?? 'the stored payment method';
    const reason = invoice.chargeRefusalReason ? ` (${invoice.chargeRefusalReason})` : '';
    if (invoice.status === 'PAID') {
      this.notify.success(`${invoice.number} charged to ${method}: ${formatMoney(invoice.total, subscription.currency)}.`);
      return;
    }
    switch (invoice.chargeStatus) {
      case 'PENDING':
        this.notify.info(`${invoice.number} charged to ${method}. It turns to Paid once confirmed.`);
        break;
      case 'RESCUING':
        this.notify.info(`The charge of ${invoice.number} was refused${reason}. Auto Rescue will retry it.`);
        break;
      case 'REFUSED':
        this.notify.info(`The charge of ${invoice.number} was refused${reason}: the subscription is past due.`);
        break;
    }
  }

  async stopRescue(subscription: CustomerSubscription): Promise<void> {
    if (this.pending() || !subscription.rescueStoppable) return;
    const invoice = subscription.invoices.find(rescuing);
    const confirmed = await this.confirmService.confirm({
      title: invoice ? `Stop the Auto Rescue of ${invoice.number}?` : 'Stop Auto Rescue?',
      message: 'The charge is no longer retried. The invoice stays unpaid.',
      details: invoice ? [
        { label: 'Customer', value: subscription.customer.displayName },
        { label: 'Amount', value: formatMoney(invoice.total, subscription.currency) },
      ] : undefined,
      confirmText: 'Stop Auto Rescue',
      cancelText: 'Keep retrying',
    });
    if (!confirmed || this.pending()) return;
    this.rowNotice.set(null);
    this.pending.set({ id: subscription.id, action: 'stop' });
    this.subscriptionService.stopRescue(this.userId, subscription.id).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.notify.success(invoice ? `Auto Rescue of ${invoice.number} stopped.` : 'Auto Rescue stopped.');
      },
      error: err => {
        this.pending.set(null);
        this.rowNotice.set({
          id: subscription.id,
          kind: 'error',
          title: 'Unable to stop Auto Rescue',
          message: httpErrorMessage(err, 'Unable to stop Auto Rescue. Try again.'),
        });
        // Auto Rescue may have ended meanwhile.
        this.refresh();
      }
    });
  }

  async cancel(subscription: CustomerSubscription): Promise<void> {
    if (this.pending() || !subscription.cancellable) return;
    const open = subscription.invoices.filter(unpaid);
    const confirmed = await this.confirmService.confirm({
      title: `Cancel the subscription of ${subscription.customer.displayName}?`,
      message: open.length
        ? "No more cycles are billed and unpaid invoices are voided. This can't be undone."
        : "No more cycles are billed. This can't be undone.",
      details: [
        { label: 'Plan', value: subscription.plan },
        { label: 'Price', value: `${formatMoney(subscription.total, subscription.currency)} per ${periodNoun(subscription.frequency)}` },
        ...(open.length ? [{ label: 'Unpaid', value: open.map(invoice => invoice.number).join(', ') }] : []),
      ],
      confirmText: 'Cancel subscription',
      cancelText: 'Keep subscription',
      danger: true,
    });
    if (!confirmed || this.pending()) return;
    this.rowNotice.set(null);
    this.pending.set({ id: subscription.id, action: 'cancel' });
    this.subscriptionService.cancel(this.userId, subscription.id).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.notify.success(`The subscription of ${updated.customer.displayName} is cancelled.`);
      },
      error: err => {
        this.pending.set(null);
        this.rowNotice.set({
          id: subscription.id,
          kind: 'error',
          title: 'Unable to cancel the subscription',
          message: httpErrorMessage(err, 'Unable to cancel the subscription. Try again.'),
        });
        this.refresh();
      }
    });
  }

  /** Sends the invoice with a payment link: its first one, or one the customer can pay a refused charge with. */
  sendInvoice(subscription: CustomerSubscription, invoice: SubscriptionInvoice): void {
    if (this.pending() || !invoice.sendable) return;
    const userId = this.userId;
    this.rowNotice.set(null);
    this.pending.set({ id: subscription.id, action: 'send', invoiceId: invoice.id });
    this.invoiceService.send(userId, invoice.id).pipe(
      switchMap(sent => this.subscriptionService.getSubscription(userId, subscription.id).pipe(
        catchError(() => of(null)),
        map(updated => ({ sent, updated }))))
    ).subscribe({
      next: ({ sent, updated }) => {
        this.pending.set(null);
        if (updated) {
          this.upsert(updated);
        } else {
          this.refresh();
        }
        this.notify.success(`${sent.number} sent to ${sent.customer.email} with a payment link.`);
      },
      error: err => {
        this.pending.set(null);
        this.rowNotice.set({
          id: subscription.id,
          kind: 'error',
          title: `Unable to send ${invoice.number}`,
          message: httpErrorMessage(err, "The payment link couldn't be created. Try again."),
        });
        this.refresh();
      }
    });
  }

  async copyLink(invoice: SubscriptionInvoice): Promise<void> {
    const url = invoice.paymentLinkUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copiedId.set(invoice.id);
      this.liveAnnouncer.announce('Payment link copied');
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedId.set(null), 2500);
    } catch {
      this.notify.info("The browser doesn't allow copying here. Select the link and copy it.");
    }
  }

  isPending(subscription: CustomerSubscription, action: SubscriptionAction): boolean {
    const pending = this.pending();
    return !!pending && pending.id === subscription.id && pending.action === action;
  }

  isSending(invoice: SubscriptionInvoice): boolean {
    const pending = this.pending();
    return !!pending && pending.action === 'send' && pending.invoiceId === invoice.id;
  }

  // ---------- Demo data ----------

  /** Creates what's missing, so loading it again doesn't duplicate anything. */
  loadDemoData(): void {
    if (!this.userId || this.loadingDemo()) return;
    const userId = this.userId;
    this.loadingDemo.set(true);
    this.demoError.set(null);
    this.demoWarnings.set([]);
    this.demoDataService.load(userId).subscribe({
      next: result => {
        this.loadingDemo.set(false);
        if (userId !== this.userId) return;
        this.demoWarnings.set(result.warnings ?? []);
        this.notify.success(demoDataSummary(result));
        this.filter.set('all');
        this.load();
      },
      error: err => {
        this.loadingDemo.set(false);
        this.demoError.set(httpErrorMessage(err, 'Unable to load the demo data. Try again.'));
      }
    });
  }

  // ---------- View ----------

  mrrHint(kpis: Kpis): string {
    return kpis.billing
      ? `${plural(kpis.billing, 'subscription')}, excluding ${this.taxLabel()}`
      : 'Starts with the first payment';
  }

  activeHint(kpis: Kpis): string {
    return kpis.awaiting
      ? `${kpis.awaiting} awaiting the first payment`
      : 'Charged automatically each cycle';
  }

  pastDueHint(kpis: Kpis): string {
    if (!kpis.pastDue) return 'Nothing past due';
    const count = plural(kpis.pastDue, 'subscription');
    return kpis.rescuing ? `${count}, ${kpis.rescuing} retried by Auto Rescue` : count;
  }

  /** Under the first invoice, while the subscription waits for its payment method. */
  firstPaymentHint(subscription: CustomerSubscription): string {
    const first = firstInvoice(subscription);
    if (!first) return '';
    if (first.status === 'PAID') {
      return subscription.runCycleBlocked ?? 'Saving the payment method…';
    }
    if (first.paymentLinkUrl) {
      return 'Paying it saves the payment method for the next cycles.';
    }
    if (first.sendable) {
      return first.status === 'DRAFT' ? "Its payment link wasn't created. Send it again." : 'Its payment link expired. Send a new one.';
    }
    return '';
  }

  chargeTitle(subscription: CustomerSubscription): string {
    const open = openInvoice(subscription);
    if (!open) return 'Next charge';
    return open.chargeStatus === 'PENDING' ? 'Charge in progress' : 'Unpaid invoice';
  }

  /** Under the charge button: what running the cycle does, or why it can't run now. */
  chargeHint(subscription: CustomerSubscription): string {
    if (subscription.runCycleBlocked) return subscription.runCycleBlocked;
    const sepa = subscription.paymentMethod?.card === false;
    const later = sepa
      ? ` SEPA Direct Debit charges are confirmed later${subscription.autoRescue ? " and aren't retried" : ''}.`
      : '';
    const retry = subscription.retryInvoiceNumber;
    if (retry) {
      // The backend deactivates the payment link before charging, so the invoice can't be paid twice.
      const link = openInvoice(subscription)?.paymentLinkUrl ? ' Its payment link stops working.' : '';
      return `Charges ${retry} again to the saved payment method.${link}${later}`;
    }
    return `Bills and charges cycle ${subscription.cyclesBilled + 1} now instead of on ${formatDate(subscription.nextBillingDate)}.${later}`;
  }

  date(value: string | null | undefined): string {
    return formatDate(value);
  }

  dateTime(value: string | null | undefined): string {
    return formatDateTime(value);
  }

  timeAgo(value: string | null | undefined): string {
    return formatTimeAgo(value);
  }

  trackById(_: number, subscription: CustomerSubscription): number {
    return subscription.id;
  }

  trackInvoice(_: number, invoice: SubscriptionInvoice): number {
    return invoice.id;
  }

  trackEvent(index: number, event: SubscriptionEvent): string {
    return `${index}-${event.type}-${event.occurredAt}`;
  }
}
