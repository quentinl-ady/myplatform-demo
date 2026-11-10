import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription, catchError, forkJoin, of, switchMap } from 'rxjs';
import { MaterialModule } from '../material.module';
import { Customer, Invoice, InvoiceEvent, InvoiceSettings } from '../models';
import { CustomerService, DemoDataService, InvoiceService, demoDataSummary } from '../services';
import {
  ConfirmService, InlineAlertComponent, MoneyPipe, NotifyService, blobHttpErrorMessage, formatDate, formatDateTime,
  formatMoney, formatTimeAgo, httpErrorMessage, parseServerDate, saveFile
} from '../shared';
// Not in the shared barrel: the QR code library would end up in the initial bundle.
import { qrCode } from '../shared/qr';
import { CustomerDialogComponent, CustomerDialogData } from './customer-dialog.component';
import { InvoiceDialogComponent, InvoiceDialogData, InvoiceDialogResult } from './invoice-dialog.component';
import {
  awaitingPayment, chargeText, countryName, displayStatus, dueText, eventView, formatRate, linkStatusLabel, linkTone, plural
} from './invoice-view';

type Filter = 'all' | 'unpaid' | 'draft' | 'paid';
type InvoiceAction = 'send' | 'void';

/** While a payment link is open, the list refreshes on its own, so a payment shows without reloading the page. */
const POLL_INTERVAL_MS = 10_000;

interface Kpis {
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  collected: number;
  collectedCount: number;
  /** From sending to payment; null before the first payment. */
  averageDaysToPay: number | null;
}

function isUnpaid(invoice: Invoice): boolean {
  return invoice.status === 'SENT' || invoice.status === 'OVERDUE';
}

/** Totals of the invoices in the currency of the account. */
function kpisOf(invoices: Invoice[], currency: string | null): Kpis {
  const kpis: Kpis = {
    outstanding: 0, outstandingCount: 0, overdue: 0, overdueCount: 0, collected: 0, collectedCount: 0, averageDaysToPay: null
  };
  let days = 0;
  let timed = 0;
  for (const invoice of invoices) {
    if (currency && invoice.currency !== currency) continue;
    if (isUnpaid(invoice)) {
      kpis.outstanding += invoice.amountDue;
      kpis.outstandingCount++;
      if (invoice.status === 'OVERDUE') {
        kpis.overdue += invoice.amountDue;
        kpis.overdueCount++;
      }
    } else if (invoice.status === 'PAID') {
      kpis.collected += invoice.total;
      kpis.collectedCount++;
      const sent = parseServerDate(invoice.sentAt);
      const paid = parseServerDate(invoice.paidAt);
      if (sent && paid && paid >= sent) {
        days += (paid.getTime() - sent.getTime()) / 86_400_000;
        timed++;
      }
    }
  }
  kpis.averageDaysToPay = timed ? days / timed : null;
  return kpis;
}

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [CommonModule, RouterLink, MaterialModule, MatMenuModule, MoneyPipe, InlineAlertComponent],
  templateUrl: './invoices.component.html',
  styleUrl: './invoices.component.css'
})
export class InvoicesComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private invoiceService = inject(InvoiceService);
  private customerService = inject(CustomerService);
  private demoDataService = inject(DemoDataService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  private confirmService = inject(ConfirmService);
  private liveAnnouncer = inject(LiveAnnouncer);
  private destroyRef = inject(DestroyRef);

  userId = '';
  readonly settings = signal<InvoiceSettings | null>(null);
  readonly invoices = signal<Invoice[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly tab = signal(0);
  readonly filter = signal<Filter>('all');
  readonly expandedId = signal<number | null>(null);
  /** One send or void at a time. */
  readonly pending = signal<{ id: number; action: InvoiceAction } | null>(null);
  readonly downloadingId = signal<number | null>(null);
  /** A failed action, shown under the row of its invoice. */
  readonly rowError = signal<{ id: number; title: string; message: string } | null>(null);
  readonly copiedId = signal<number | null>(null);
  readonly loadingDemo = signal(false);
  readonly demoError = signal<string | null>(null);
  readonly demoWarnings = signal<string[]>([]);
  readonly deletingCustomerId = signal<number | null>(null);
  readonly customerError = signal<{ id: number; message: string } | null>(null);

  readonly canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  readonly awaitingPayment = awaitingPayment;
  readonly chargeText = chargeText;
  readonly displayStatus = displayStatus;
  readonly dueText = dueText;
  readonly eventView = eventView;
  readonly formatRate = formatRate;
  readonly linkStatusLabel = linkStatusLabel;
  readonly linkTone = linkTone;
  readonly plural = plural;
  readonly countryName = countryName;

  readonly currency = computed(() => this.settings()?.currency ?? this.invoices()[0]?.currency ?? null);
  readonly taxLabel = computed(() => this.settings()?.taxLabel ?? 'VAT');
  /** Why invoices can't be sent yet, e.g. no store to process their payments. */
  readonly sendBlocked = computed(() => this.settings()?.paymentLinksReady === false);
  readonly kpis = computed(() => kpisOf(this.invoices(), this.currency()));
  readonly counts = computed(() => {
    const invoices = this.invoices();
    return {
      unpaid: invoices.filter(isUnpaid).length,
      draft: invoices.filter(invoice => invoice.status === 'DRAFT').length,
    };
  });
  readonly visibleInvoices = computed(() => {
    const invoices = this.invoices();
    switch (this.filter()) {
      case 'unpaid':
        return invoices.filter(isUnpaid);
      case 'draft':
        return invoices.filter(invoice => invoice.status === 'DRAFT');
      case 'paid':
        return invoices.filter(invoice => invoice.status === 'PAID');
      default:
        return invoices;
    }
  });
  readonly expandedInvoice = computed(() => this.invoices().find(invoice => invoice.id === this.expandedId()) ?? null);
  /** Only while the link takes payments: a pending payment may not be paid twice. */
  private readonly qrUrl = computed(() => {
    const invoice = this.expandedInvoice();
    return invoice && awaitingPayment(invoice) && invoice.paymentLink?.status === 'active' ? invoice.paymentLink.url : null;
  });
  readonly qr = computed(() => {
    const url = this.qrUrl();
    return url ? qrCode(url) : null;
  });

  private fetchSub?: Subscription;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  /** The invoice to open once the list is loaded, e.g. when coming from its subscription. */
  private focusId: number | null = null;

  ngOnInit(): void {
    const focus = Number(this.route.snapshot.queryParamMap.get('invoice'));
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

  /** Back from paying an invoice in another tab: the payment shows at once. */
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
      settings: this.invoiceService.getSettings(userId),
      invoices: this.invoiceService.getInvoices(userId),
      customers: this.customerService.getCustomers(userId),
    }).subscribe({
      next: ({ settings, invoices, customers }) => {
        this.settings.set(settings);
        this.setInvoices(invoices ?? []);
        this.customers.set(customers ?? []);
        this.loading.set(false);
        this.openFocused();
      },
      error: err => {
        this.loadError.set(httpErrorMessage(err, 'Unable to load the invoices. Try again.'));
        this.loading.set(false);
      }
    });
  }

  private reset(): void {
    this.fetchSub?.unsubscribe();
    this.settings.set(null);
    this.invoices.set([]);
    this.customers.set([]);
    this.loading.set(false);
    this.refreshing.set(false);
    this.loadError.set(null);
    this.expandedId.set(null);
    this.rowError.set(null);
    this.customerError.set(null);
    this.demoError.set(null);
    this.demoWarnings.set([]);
  }

  private openFocused(): void {
    const id = this.focusId;
    this.focusId = null;
    if (id === null || !this.invoices().some(invoice => invoice.id === id)) return;
    this.tab.set(0);
    this.filter.set('all');
    this.expandedId.set(id);
    setTimeout(() => document.getElementById(`invoice-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  private refreshWhileWaiting(): void {
    if (document.hidden || !this.invoices().some(awaitingPayment)) return;
    this.refresh();
  }

  /** A silent refresh keeps the current page when it fails. */
  private refresh(): void {
    if (!this.userId || this.loading() || this.refreshing() || this.pending()) return;
    const userId = this.userId;
    const expanded = this.expandedInvoice();
    // The backend checks the payment link of an open invoice at Adyen more often than the links of the list.
    const detail$ = expanded && awaitingPayment(expanded)
      ? this.invoiceService.getInvoice(userId, expanded.id).pipe(catchError(() => of(null)))
      : of(null);
    this.refreshing.set(true);
    this.fetchSub = detail$.pipe(
      switchMap(() => forkJoin({
        invoices: this.invoiceService.getInvoices(userId),
        customers: this.customerService.getCustomers(userId),
      }))
    ).subscribe({
      next: ({ invoices, customers }) => {
        this.setInvoices(invoices ?? []);
        this.customers.set(customers ?? []);
        this.refreshing.set(false);
      },
      error: () => this.refreshing.set(false)
    });
  }

  /** A refresh that started before an action would bring back the invoice as it was. */
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
      // The counts of the customers are secondary: keep them until the next refresh.
      error: () => undefined
    });
  }

  private setInvoices(invoices: Invoice[]): void {
    this.announcePayments(this.invoices(), invoices);
    this.invoices.set(invoices);
    const expanded = this.expandedId();
    if (expanded !== null && !invoices.some(invoice => invoice.id === expanded)) {
      this.expandedId.set(null);
    }
  }

  /** Replaces the invoice, or adds it at the top: the latest number comes first. */
  private upsert(invoice: Invoice): void {
    this.cancelRefresh();
    const current = this.invoices();
    this.setInvoices(current.some(i => i.id === invoice.id)
      ? current.map(i => i.id === invoice.id ? invoice : i)
      : [invoice, ...current]);
  }

  private announcePayments(previous: Invoice[], current: Invoice[]): void {
    const before = new Map(previous.map(invoice => [invoice.id, invoice.status]));
    const paid = current.filter(invoice =>
      invoice.status === 'PAID' && before.has(invoice.id) && before.get(invoice.id) !== 'PAID');
    if (paid.length === 1) {
      const [invoice] = paid;
      this.notify.success(`${invoice.number} is paid: ${formatMoney(invoice.total, invoice.currency)} from ${invoice.customer.displayName}.`);
    } else if (paid.length > 1) {
      this.notify.success(`${paid.length} invoices are paid: ${paid.map(invoice => invoice.number).join(', ')}.`);
    }
  }

  // ---------- Invoices ----------

  setFilter(filter: Filter): void {
    this.filter.set(filter);
  }

  emptyFilterText(): string {
    switch (this.filter()) {
      case 'unpaid':
        return 'No unpaid invoices';
      case 'draft':
        return 'No drafts';
      case 'paid':
        return 'No paid invoices yet';
      default:
        return 'No invoices';
    }
  }

  toggle(invoice: Invoice, event?: Event): void {
    event?.preventDefault();
    const selection = window.getSelection();
    if (event?.type === 'click' && selection && selection.toString().length > 0) return;
    const opening = this.expandedId() !== invoice.id;
    this.expandedId.set(opening ? invoice.id : null);
    if (opening && awaitingPayment(invoice)) {
      // Opens on the current status of the payment link.
      this.refresh();
    }
  }

  newInvoice(customer?: Customer): void {
    const settings = this.settings();
    if (!settings) return;
    this.openInvoiceDialog({ userId: this.userId, settings, customers: this.customers(), customerId: customer?.id },
      customer ? '#invoice-line-0-description' : '#invoice-customer');
  }

  edit(invoice: Invoice): void {
    const settings = this.settings();
    if (!settings || !invoice.editable) return;
    this.openInvoiceDialog({ userId: this.userId, settings, customers: this.customers(), invoice },
      '#invoice-line-0-description');
  }

  private openInvoiceDialog(data: InvoiceDialogData, autoFocus: string): void {
    const editing = !!data.invoice;
    const ref = this.dialog.open<InvoiceDialogComponent, InvoiceDialogData, InvoiceDialogResult>(InvoiceDialogComponent, {
      data,
      width: '880px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus,
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(result => {
      // A customer may have been added from the dialog.
      this.refreshCustomers();
      if (!result) return;
      const { invoice, sent } = result;
      this.upsert(invoice);
      this.rowError.set(null);
      this.tab.set(0);
      this.filter.set('all');
      this.expandedId.set(invoice.id);
      this.notify.success(sent
        ? `${invoice.number} sent with a payment link.`
        : editing ? `${invoice.number} saved.` : `${invoice.number} saved as a draft.`);
      setTimeout(() => document.getElementById(`invoice-${invoice.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    });
  }

  /** Issues a draft with a payment link, replaces the link that expired, or sends one for a refused charge. */
  send(invoice: Invoice): void {
    if (this.pending()) return;
    const renewal = !!invoice.paymentLink;
    this.rowError.set(null);
    this.pending.set({ id: invoice.id, action: 'send' });
    this.invoiceService.send(this.userId, invoice.id).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.expandedId.set(updated.id);
        this.notify.success(renewal
          ? `New payment link created for ${updated.number}.`
          : `${updated.number} sent with a payment link.`);
        this.refreshCustomers();
      },
      error: err => {
        this.pending.set(null);
        this.rowError.set({
          id: invoice.id,
          title: renewal ? 'Unable to create a new payment link' : `Unable to send ${invoice.number}`,
          message: httpErrorMessage(err, "The payment link couldn't be created. Try again."),
        });
      }
    });
  }

  async voidInvoice(invoice: Invoice): Promise<void> {
    if (this.pending()) return;
    const confirmed = await this.confirmService.confirm({
      title: `Void ${invoice.number}?`,
      message: invoice.paymentLink
        ? "Its payment link stops working. A void invoice can't be sent again."
        : "A void invoice can't be edited or sent afterwards.",
      details: [
        { label: 'Customer', value: invoice.customer.displayName },
        { label: 'Amount', value: formatMoney(invoice.total, invoice.currency) },
      ],
      confirmText: 'Void invoice',
      cancelText: 'Keep invoice',
      danger: true,
    });
    if (!confirmed || this.pending()) return;
    this.rowError.set(null);
    this.pending.set({ id: invoice.id, action: 'void' });
    this.invoiceService.voidInvoice(this.userId, invoice.id).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.notify.success(`${updated.number} is void.`);
        this.refreshCustomers();
      },
      error: err => {
        this.pending.set(null);
        this.rowError.set({
          id: invoice.id,
          title: `Unable to void ${invoice.number}`,
          message: httpErrorMessage(err, 'Unable to void the invoice. Try again.'),
        });
        // The customer may have just paid it.
        this.refresh();
      }
    });
  }

  downloadPdf(invoice: Invoice): void {
    if (this.downloadingId() !== null) return;
    this.rowError.set(null);
    this.downloadingId.set(invoice.id);
    this.invoiceService.downloadPdf(this.userId, invoice.id).subscribe({
      next: blob => {
        this.downloadingId.set(null);
        saveFile(blob, `${invoice.number}.pdf`);
      },
      error: async err => {
        const message = await blobHttpErrorMessage(err, 'Unable to create the PDF. Try again.');
        this.downloadingId.set(null);
        this.rowError.set({ id: invoice.id, title: 'Unable to download the PDF', message });
      }
    });
  }

  async copyLink(invoice: Invoice): Promise<void> {
    const url = invoice.paymentLink?.url;
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

  isPending(invoice: Invoice, action: InvoiceAction): boolean {
    const pending = this.pending();
    return !!pending && pending.id === invoice.id && pending.action === action;
  }

  // ---------- Customers ----------

  addCustomer(): void {
    this.openCustomerDialog({ userId: this.userId, defaultCountry: this.settings()?.country });
  }

  editCustomer(customer: Customer): void {
    this.openCustomerDialog({ userId: this.userId, customer, defaultCountry: this.settings()?.country });
  }

  private openCustomerDialog(data: CustomerDialogData): void {
    const ref = this.dialog.open<CustomerDialogComponent, CustomerDialogData, Customer>(CustomerDialogComponent, {
      data,
      width: '560px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: '#customer-company',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(saved => {
      if (!saved) return;
      this.customers.update(list => list.some(c => c.id === saved.id)
        ? list.map(c => c.id === saved.id ? saved : c)
        : [...list, saved].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      this.notify.success(data.customer ? `${saved.displayName} saved.` : `${saved.displayName} added.`);
      if (data.customer) {
        // The invoices show the name and address of their customer.
        this.refresh();
      }
    });
  }

  async deleteCustomer(customer: Customer): Promise<void> {
    if (this.deletingCustomerId() !== null) return;
    const confirmed = await this.confirmService.confirm({
      title: `Delete ${customer.displayName}?`,
      message: "The customer has no invoices. Deleting it can't be undone.",
      details: [{ label: 'Email', value: customer.email }],
      confirmText: 'Delete customer',
      cancelText: 'Keep customer',
      danger: true,
    });
    if (!confirmed) return;
    this.customerError.set(null);
    this.deletingCustomerId.set(customer.id);
    this.customerService.delete(this.userId, customer.id).subscribe({
      next: () => {
        this.deletingCustomerId.set(null);
        this.customers.update(list => list.filter(c => c.id !== customer.id));
        this.notify.success(`${customer.displayName} deleted.`);
      },
      error: err => {
        this.deletingCustomerId.set(null);
        this.customerError.set({ id: customer.id, message: httpErrorMessage(err, 'Unable to delete the customer. Try again.') });
      }
    });
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
        this.tab.set(0);
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

  collectedHint(kpis: Kpis): string {
    if (!kpis.collectedCount) return 'No payments yet';
    const count = plural(kpis.collectedCount, 'paid invoice');
    if (kpis.averageDaysToPay === null) return count;
    const days = Math.round(kpis.averageDaysToPay);
    return `${count}, paid in ${days < 1 ? 'less than a day' : plural(days, 'day')} on average`;
  }

  addressOf(invoice: Invoice): string {
    const customer = invoice.customer;
    const city = [customer.postalCode, customer.city].filter(Boolean).join(' ');
    return [customer.addressLine, city, countryName(customer.country)].filter(Boolean).join(', ');
  }

  initialsOf(customer: Customer): string {
    const words = customer.displayName.split(/\s+/).filter(word => /[a-z0-9]/i.test(word));
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
    return letters.toUpperCase();
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

  trackById(_: number, invoice: Invoice): number {
    return invoice.id;
  }

  trackCustomer(_: number, customer: Customer): number {
    return customer.id;
  }

  trackEvent(index: number, event: InvoiceEvent): string {
    return `${index}-${event.type}-${event.occurredAt}`;
  }
}
