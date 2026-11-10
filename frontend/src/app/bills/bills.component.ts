import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { Subscription, forkJoin } from 'rxjs';
import { MaterialModule } from '../material.module';
import { Bill, BillEvent, BillPaymentItem, BillPaymentResult, BillSettings, Supplier } from '../models';
import { BillService, DemoDataService, IssuingService, SupplierService, demoDataSummary } from '../services';
import {
  ConfirmService, InlineAlertComponent, MoneyPipe, NotifyService, formatDate, formatDateTime, formatMoney, formatTimeAgo,
  fromMinorUnits, httpErrorMessage
} from '../shared';
import { FormatCardNumberPipe } from '../card-list/format-card-number.pipe';
import { REVEAL_DURATION_MS, RevealedCard, revealCard } from '../card-list/card-reveal';
import { countryName, formatRate, plural } from '../invoices/invoice-view';
import { BillDialogComponent, BillDialogData } from './bill-dialog.component';
import { PayDialogComponent, PayDialogData, PayDialogResult } from './pay-dialog.component';
import { SupplierDialogComponent, SupplierDialogData } from './supplier-dialog.component';
import {
  MAX_BATCH, billDueText, cardBrandName, cardCharged, displayStatus, eventDetail, eventView, humanize, isInProgress, isOpen,
  payeeCheckView, paymentMethodLabel, vopScenarioLabel
} from './bill-view';

type Filter = 'all' | 'open' | 'inProgress' | 'paid';
type BillAction = 'card' | 'cancelCard' | 'cancelTransfer' | 'delete';

/** While a payment is under way, the list refreshes on its own, so its outcome shows without reloading the page. */
const POLL_INTERVAL_MS = 10_000;

interface Kpis {
  toPay: number;
  toPayCount: number;
  overdue: number;
  overdueCount: number;
  inProgress: number;
  inProgressCount: number;
  paid: number;
  paidCount: number;
}

/** Totals of the bills in the currency of the account. */
function kpisOf(bills: Bill[], currency: string | null): Kpis {
  const kpis: Kpis = {
    toPay: 0, toPayCount: 0, overdue: 0, overdueCount: 0, inProgress: 0, inProgressCount: 0, paid: 0, paidCount: 0
  };
  for (const bill of bills) {
    if (currency && bill.currency !== currency) continue;
    if (isOpen(bill)) {
      kpis.toPay += bill.total;
      kpis.toPayCount++;
      if (bill.status === 'OVERDUE') {
        kpis.overdue += bill.total;
        kpis.overdueCount++;
      }
    } else if (isInProgress(bill)) {
      kpis.inProgress += bill.total;
      kpis.inProgressCount++;
    } else if (bill.status === 'PAID') {
      kpis.paid += bill.total;
      kpis.paidCount++;
    }
  }
  return kpis;
}

@Component({
  selector: 'app-bills',
  standalone: true,
  imports: [CommonModule, RouterLink, MaterialModule, MatMenuModule, MoneyPipe, InlineAlertComponent, FormatCardNumberPipe],
  templateUrl: './bills.component.html',
  styleUrls: ['../invoices/invoices.component.css', './bills.component.css']
})
export class BillsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private billService = inject(BillService);
  private supplierService = inject(SupplierService);
  private issuingService = inject(IssuingService);
  private demoDataService = inject(DemoDataService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  private confirmService = inject(ConfirmService);
  private liveAnnouncer = inject(LiveAnnouncer);
  private destroyRef = inject(DestroyRef);

  userId = '';
  readonly settings = signal<BillSettings | null>(null);
  readonly bills = signal<Bill[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly tab = signal(0);
  readonly filter = signal<Filter>('all');
  readonly expandedId = signal<number | null>(null);
  /** The bills to pay together by transfer. */
  readonly selectedIds = signal<ReadonlySet<number>>(new Set());
  /** One action on a bill at a time. */
  readonly pending = signal<{ id: number; action: BillAction } | null>(null);
  /** A failed action, shown under the row of its bill. */
  readonly rowError = signal<{ id: number; title: string; message: string } | null>(null);
  /** The transfers created for the last batch, until the user approves them. */
  readonly paymentResult = signal<BillPaymentResult | null>(null);
  readonly revealed = signal<{ billId: number; card: RevealedCard } | null>(null);
  readonly revealingId = signal<number | null>(null);
  readonly copiedId = signal<number | null>(null);
  readonly loadingDemo = signal(false);
  readonly demoError = signal<string | null>(null);
  readonly demoWarnings = signal<string[]>([]);
  readonly deletingSupplierId = signal<number | null>(null);
  readonly supplierError = signal<{ id: number; message: string } | null>(null);

  readonly canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  readonly billDueText = billDueText;
  readonly cardBrandName = cardBrandName;
  readonly cardCharged = cardCharged;
  readonly countryName = countryName;
  readonly displayStatus = displayStatus;
  readonly eventDetail = eventDetail;
  readonly eventView = eventView;
  readonly formatRate = formatRate;
  readonly humanize = humanize;
  readonly isOpen = isOpen;
  readonly payeeCheckView = payeeCheckView;
  readonly paymentMethodLabel = paymentMethodLabel;
  readonly plural = plural;
  readonly vopScenarioLabel = vopScenarioLabel;

  readonly currency = computed(() => this.settings()?.currency ?? this.bills()[0]?.currency ?? null);
  readonly taxLabel = computed(() => this.settings()?.taxLabel ?? 'VAT');
  readonly transfersAvailable = computed(() => !!this.settings() && !this.settings()!.transfersIssue);
  readonly cardBrands = computed(() => this.settings()?.cardBrands ?? []);
  readonly kpis = computed(() => kpisOf(this.bills(), this.currency()));
  readonly counts = computed(() => {
    const bills = this.bills();
    return {
      open: bills.filter(isOpen).length,
      inProgress: bills.filter(isInProgress).length,
    };
  });
  readonly visibleBills = computed(() => {
    const bills = this.bills();
    switch (this.filter()) {
      case 'open':
        return bills.filter(isOpen);
      case 'inProgress':
        return bills.filter(isInProgress);
      case 'paid':
        return bills.filter(bill => bill.status === 'PAID');
      default:
        return bills;
    }
  });
  readonly selectableBills = computed(() => this.visibleBills().filter(bill => bill.payableByTransfer));
  readonly selectedBills = computed(() => {
    const ids = this.selectedIds();
    return this.bills().filter(bill => ids.has(bill.id) && bill.payableByTransfer);
  });
  readonly selectedTotal = computed(() => this.selectedBills().reduce((sum, bill) => sum + bill.total, 0));
  readonly allSelected = computed(() => {
    const ids = this.selectedIds();
    const selectable = this.selectableBills();
    return selectable.length > 0 && selectable.every(bill => ids.has(bill.id));
  });
  readonly someSelected = computed(() => {
    const ids = this.selectedIds();
    return !this.allSelected() && this.selectableBills().some(bill => ids.has(bill.id));
  });

  private fetchSub?: Subscription;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private revealTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      this.reset();
      if (this.userId) this.load();
    });

    const poll = setInterval(() => this.refreshWhileWaiting(), POLL_INTERVAL_MS);
    this.destroyRef.onDestroy(() => {
      clearInterval(poll);
      clearTimeout(this.copiedTimer);
      clearTimeout(this.revealTimer);
      this.fetchSub?.unsubscribe();
    });
  }

  /** Back from approving the transfers, or from charging a card, in another tab: the outcome shows at once. */
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
      settings: this.billService.getSettings(userId),
      bills: this.billService.getBills(userId),
      suppliers: this.supplierService.getSuppliers(userId),
    }).subscribe({
      next: ({ settings, bills, suppliers }) => {
        this.settings.set(settings);
        this.setBills(bills ?? []);
        this.suppliers.set(suppliers ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.loadError.set(httpErrorMessage(err, 'Unable to load the bills. Try again.'));
        this.loading.set(false);
      }
    });
  }

  private reset(): void {
    this.fetchSub?.unsubscribe();
    this.settings.set(null);
    this.bills.set([]);
    this.suppliers.set([]);
    this.loading.set(false);
    this.refreshing.set(false);
    this.loadError.set(null);
    this.expandedId.set(null);
    this.selectedIds.set(new Set());
    this.rowError.set(null);
    this.paymentResult.set(null);
    this.supplierError.set(null);
    this.demoError.set(null);
    this.demoWarnings.set([]);
    this.hideCard();
  }

  private refreshWhileWaiting(): void {
    if (document.hidden || !this.bills().some(isInProgress)) return;
    this.refresh();
  }

  /** A silent refresh keeps the current page when it fails. The backend also settles the payments under way. */
  private refresh(): void {
    if (!this.userId || this.loading() || this.refreshing() || this.pending()) return;
    const userId = this.userId;
    this.refreshing.set(true);
    this.fetchSub = forkJoin({
      bills: this.billService.getBills(userId),
      suppliers: this.supplierService.getSuppliers(userId),
    }).subscribe({
      next: ({ bills, suppliers }) => {
        this.setBills(bills ?? []);
        this.suppliers.set(suppliers ?? []);
        this.refreshing.set(false);
      },
      error: () => this.refreshing.set(false)
    });
  }

  /** A refresh that started before an action would bring back the bill as it was. */
  private cancelRefresh(): void {
    if (this.refreshing()) {
      this.fetchSub?.unsubscribe();
      this.refreshing.set(false);
    }
  }

  private refreshSuppliers(): void {
    const userId = this.userId;
    this.supplierService.getSuppliers(userId).subscribe({
      next: suppliers => {
        if (userId === this.userId) this.suppliers.set(suppliers ?? []);
      },
      // What is still to pay each supplier is secondary: keep it until the next refresh.
      error: () => undefined
    });
  }

  private setBills(bills: Bill[]): void {
    this.announceChanges(this.bills(), bills);
    this.bills.set(bills);
    const expanded = this.expandedId();
    if (expanded !== null && !bills.some(bill => bill.id === expanded)) {
      this.expandedId.set(null);
    }
    const payable = new Set(bills.filter(bill => bill.payableByTransfer).map(bill => bill.id));
    const selected = [...this.selectedIds()];
    if (selected.some(id => !payable.has(id))) {
      this.selectedIds.set(new Set(selected.filter(id => payable.has(id))));
    }
    const revealed = this.revealed();
    if (revealed && !bills.some(bill => bill.id === revealed.billId && bill.card && bill.card.status !== 'closed')) {
      this.hideCard();
    }
  }

  /** Replaces the bill, or adds it at the top: the latest number comes first. */
  private upsert(bill: Bill): void {
    this.cancelRefresh();
    const current = this.bills();
    this.setBills(current.some(b => b.id === bill.id)
      ? current.map(b => b.id === bill.id ? bill : b)
      : [bill, ...current]);
  }

  private announceChanges(previous: Bill[], current: Bill[]): void {
    if (!previous.length) return;
    const before = new Map(previous.map(bill => [bill.id, bill.status]));
    const turnedTo = (bill: Bill, status: Bill['status']) =>
      bill.status === status && before.has(bill.id) && before.get(bill.id) !== status;
    const paid = current.filter(bill => turnedTo(bill, 'PAID'));
    const failed = current.filter(bill => turnedTo(bill, 'FAILED'));
    if (paid.length === 1) {
      const [bill] = paid;
      this.notify.success(`${bill.number} is paid: ${formatMoney(bill.total, bill.currency)} to ${bill.supplier.name}.`);
    } else if (paid.length > 1) {
      this.notify.success(`${paid.length} bills are paid: ${paid.map(bill => bill.number).join(', ')}.`);
    }
    if (failed.length === 1) {
      this.notify.error(`The payment of ${failed[0].number} failed. The bill is to pay again.`);
    } else if (failed.length > 1) {
      this.notify.error(`The payments of ${failed.map(bill => bill.number).join(', ')} failed. They're to pay again.`);
    }
  }

  // ---------- Bills ----------

  setFilter(filter: Filter): void {
    this.filter.set(filter);
  }

  emptyFilterText(): string {
    switch (this.filter()) {
      case 'open':
        return 'No bills to pay';
      case 'inProgress':
        return 'No payments under way';
      case 'paid':
        return 'No paid bills yet';
      default:
        return 'No bills';
    }
  }

  toggle(bill: Bill, event?: Event): void {
    event?.preventDefault();
    const selection = window.getSelection();
    if (event?.type === 'click' && selection && selection.toString().length > 0) return;
    const opening = this.expandedId() !== bill.id;
    this.expandedId.set(opening ? bill.id : null);
    if (opening && isInProgress(bill)) {
      // Opens on the current state of the payment.
      this.refresh();
    }
  }

  isSelected(bill: Bill): boolean {
    return this.selectedIds().has(bill.id);
  }

  toggleSelected(bill: Bill, change: MatCheckboxChange): void {
    const next = new Set(this.selectedIds());
    if (!change.checked) {
      next.delete(bill.id);
    } else if (next.size >= MAX_BATCH) {
      change.source.checked = false;
      this.notify.info(`One batch takes up to ${MAX_BATCH} transfers.`);
      return;
    } else {
      next.add(bill.id);
    }
    this.selectedIds.set(next);
  }

  toggleAll(checked: boolean): void {
    const selectable = this.selectableBills();
    const next = new Set(this.selectedIds());
    if (checked) {
      for (const bill of selectable) {
        if (next.size >= MAX_BATCH) break;
        next.add(bill.id);
      }
      if (selectable.some(bill => !next.has(bill.id))) {
        this.notify.info(`One batch takes up to ${MAX_BATCH} transfers: the first ${MAX_BATCH} bills are selected.`);
      }
    } else {
      selectable.forEach(bill => next.delete(bill.id));
    }
    this.selectedIds.set(next);
  }

  newBill(supplier?: Supplier): void {
    const settings = this.settings();
    if (!settings) return;
    this.openBillDialog({ userId: this.userId, settings, suppliers: this.suppliers(), supplierId: supplier?.id },
      supplier ? '#bill-reference' : '#bill-supplier');
  }

  edit(bill: Bill): void {
    const settings = this.settings();
    if (!settings || !bill.editable) return;
    this.openBillDialog({ userId: this.userId, settings, suppliers: this.suppliers(), bill }, '#bill-subtotal');
  }

  private openBillDialog(data: BillDialogData, autoFocus: string): void {
    const editing = !!data.bill;
    const ref = this.dialog.open<BillDialogComponent, BillDialogData, Bill>(BillDialogComponent, {
      data,
      width: '800px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus,
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(bill => {
      // A supplier may have been added from the dialog.
      this.refreshSuppliers();
      if (!bill) return;
      this.upsert(bill);
      this.rowError.set(null);
      this.tab.set(0);
      this.filter.set('all');
      this.expandedId.set(bill.id);
      this.notify.success(editing ? `${bill.number} saved.` : `${bill.number} recorded.`);
      setTimeout(() => document.getElementById(`bill-${bill.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    });
  }

  payByTransfer(bill: Bill): void {
    this.openPayDialog([bill]);
  }

  paySelected(): void {
    this.openPayDialog(this.selectedBills());
  }

  private openPayDialog(bills: Bill[]): void {
    const settings = this.settings();
    if (!settings || !bills.length || this.pending()) return;
    const ref = this.dialog.open<PayDialogComponent, PayDialogData, PayDialogResult>(PayDialogComponent, {
      data: { userId: this.userId, settings, bills },
      width: '680px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: 'dialog',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(result => {
      // Each check is in the history of its bill, and a supplier may have taken the name its bank has.
      this.cancelRefresh();
      this.refresh();
      if (!result) return;
      const { payment } = result;
      this.paymentResult.set(payment);
      this.selectedIds.set(new Set());
      this.rowError.set(null);
      this.notify.success(payment.created === 1
        ? 'The transfer waits for your approval.'
        : `${payment.created} transfers wait for your approval.`);
    });
  }

  approveTransfers(): void {
    this.router.navigate(['/', this.userId, 'batch-transfer']);
  }

  async payByCard(bill: Bill, brand?: string | null): Promise<void> {
    if (this.pending()) return;
    const amount = formatMoney(bill.total, bill.currency);
    const confirmed = await this.confirmService.confirm({
      title: `Pay ${bill.number} with a single-use card?`,
      message: `A virtual ${cardBrandName(brand ?? this.cardBrands()[0])} card for one payment of up to ${amount}. `
        + 'The bill is paid once the supplier charges it.',
      details: [
        { label: 'Supplier', value: bill.supplier.name },
        { label: 'Card limit', value: amount },
      ],
      confirmText: 'Issue the card',
      cancelText: 'Cancel',
    });
    if (!confirmed || this.pending()) return;
    this.rowError.set(null);
    this.pending.set({ id: bill.id, action: 'card' });
    this.billService.payByCard(this.userId, bill.id, brand ?? null).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.expandedId.set(updated.id);
        this.notify.success(`Single-use card issued for ${updated.number}.`);
        this.refreshSuppliers();
      },
      error: err => {
        this.pending.set(null);
        this.rowError.set({
          id: bill.id,
          title: `Unable to pay ${bill.number} with a card`,
          message: httpErrorMessage(err, "The card couldn't be issued. Try again."),
        });
      }
    });
  }

  async cancelCard(bill: Bill): Promise<void> {
    if (this.pending() || !bill.cardCancellable) return;
    const confirmed = await this.confirmService.confirm({
      title: `Close the card of ${bill.number}?`,
      message: "The supplier can't charge it anymore, and the bill is to pay again.",
      details: [
        { label: 'Card', value: `${cardBrandName(bill.card?.brand)} •••• ${bill.card?.lastFour ?? ''}`.trim() },
        { label: 'Supplier', value: bill.supplier.name },
      ],
      confirmText: 'Close card',
      cancelText: 'Keep card',
      danger: true,
    });
    if (!confirmed || this.pending()) return;
    this.rowError.set(null);
    this.pending.set({ id: bill.id, action: 'cancelCard' });
    this.billService.cancelCard(this.userId, bill.id).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.notify.success(`The card of ${updated.number} is closed. The bill is to pay again.`);
        this.refreshSuppliers();
      },
      error: err => {
        this.pending.set(null);
        this.rowError.set({
          id: bill.id,
          title: 'Unable to close the card',
          message: httpErrorMessage(err, 'Unable to close the card. Try again.'),
        });
        // The supplier may have just charged it.
        this.refresh();
      }
    });
  }

  async cancelTransfer(bill: Bill): Promise<void> {
    if (this.pending() || bill.status !== 'PENDING_APPROVAL') return;
    const confirmed = await this.confirmService.confirm({
      title: `Cancel the transfer of ${bill.number}?`,
      message: 'The transfer is cancelled before its approval, and the bill is to pay again.',
      details: [
        { label: 'Supplier', value: bill.supplier.name },
        { label: 'Amount', value: formatMoney(bill.total, bill.currency) },
      ],
      confirmText: 'Cancel transfer',
      cancelText: 'Keep transfer',
      danger: true,
    });
    if (!confirmed || this.pending()) return;
    this.rowError.set(null);
    this.pending.set({ id: bill.id, action: 'cancelTransfer' });
    this.billService.cancelTransfer(this.userId, bill.id).subscribe({
      next: updated => {
        this.pending.set(null);
        this.upsert(updated);
        this.notify.success(`The transfer of ${updated.number} is cancelled.`);
        this.refreshSuppliers();
      },
      error: err => {
        this.pending.set(null);
        this.rowError.set({
          id: bill.id,
          title: 'Unable to cancel the transfer',
          message: httpErrorMessage(err, 'Unable to cancel the transfer. Try again.'),
        });
        // It may have just been approved.
        this.refresh();
      }
    });
  }

  async deleteBill(bill: Bill): Promise<void> {
    if (this.pending() || !bill.deletable) return;
    const confirmed = await this.confirmService.confirm({
      title: `Delete ${bill.number}?`,
      message: "It leaves the purchases journal. Deleting it can't be undone.",
      details: [
        { label: 'Supplier', value: bill.supplier.name },
        { label: 'Amount', value: formatMoney(bill.total, bill.currency) },
      ],
      confirmText: 'Delete bill',
      cancelText: 'Keep bill',
      danger: true,
    });
    if (!confirmed || this.pending()) return;
    this.rowError.set(null);
    this.pending.set({ id: bill.id, action: 'delete' });
    this.billService.delete(this.userId, bill.id).subscribe({
      next: () => {
        this.pending.set(null);
        this.cancelRefresh();
        this.setBills(this.bills().filter(b => b.id !== bill.id));
        this.notify.success(`${bill.number} deleted.`);
        this.refreshSuppliers();
      },
      error: err => {
        this.pending.set(null);
        this.rowError.set({
          id: bill.id,
          title: `Unable to delete ${bill.number}`,
          message: httpErrorMessage(err, 'Unable to delete the bill. Try again.'),
        });
      }
    });
  }

  isPending(bill: Bill, action: BillAction): boolean {
    const pending = this.pending();
    return !!pending && pending.id === bill.id && pending.action === action;
  }

  // ---------- Single-use cards ----------

  revealedFor(bill: Bill): RevealedCard | null {
    const revealed = this.revealed();
    return revealed && revealed.billId === bill.id ? revealed.card : null;
  }

  /** Shows the number, expiry date and security code to give the supplier, for a while. */
  async toggleCardDetails(bill: Bill): Promise<void> {
    const card = bill.card;
    if (!card || this.revealingId() !== null) return;
    if (this.revealedFor(bill)) {
      this.hideCard();
      return;
    }
    this.rowError.set(null);
    this.revealingId.set(bill.id);
    try {
      const details = await revealCard(this.issuingService, card.paymentInstrumentId);
      this.revealed.set({ billId: bill.id, card: details });
      clearTimeout(this.revealTimer);
      this.revealTimer = setTimeout(() => this.hideCard(), REVEAL_DURATION_MS);
    } catch (err) {
      this.rowError.set({
        id: bill.id,
        title: 'Unable to show the card details',
        message: httpErrorMessage(err, "The card details couldn't be revealed. Try again."),
      });
    } finally {
      this.revealingId.set(null);
    }
  }

  hideCard(): void {
    clearTimeout(this.revealTimer);
    this.revealed.set(null);
  }

  async copyCardNumber(bill: Bill): Promise<void> {
    const pan = this.revealedFor(bill)?.pan;
    if (!pan) return;
    try {
      await navigator.clipboard.writeText(pan);
      this.copiedId.set(bill.id);
      this.liveAnnouncer.announce('Card number copied');
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedId.set(null), 2500);
    } catch {
      this.notify.info("The browser doesn't allow copying here. Select the number and copy it.");
    }
  }

  /** Prefills the test checkout, where the card is charged as the supplier would. */
  checkoutParams(bill: Bill): Record<string, string | number> {
    return { amount: fromMinorUnits(bill.total, bill.currency), currency: bill.currency, reference: bill.number };
  }

  expiryOf(card: RevealedCard): string {
    return `${card.expiryMonth}/${String(card.expiryYear ?? '').slice(-2)}`;
  }

  // ---------- Suppliers ----------

  addSupplier(): void {
    const settings = this.settings();
    if (!settings) return;
    this.openSupplierDialog({ userId: this.userId, settings });
  }

  editSupplier(supplier: Supplier): void {
    const settings = this.settings();
    if (!settings) return;
    this.openSupplierDialog({ userId: this.userId, settings, supplier });
  }

  private openSupplierDialog(data: SupplierDialogData): void {
    const ref = this.dialog.open<SupplierDialogComponent, SupplierDialogData, Supplier>(SupplierDialogComponent, {
      data,
      width: '600px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: '#supplier-name',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(saved => {
      if (!saved) return;
      this.suppliers.update(list => list.some(s => s.id === saved.id)
        ? list.map(s => s.id === saved.id ? saved : s)
        : [...list, saved].sort((a, b) => a.name.localeCompare(b.name)));
      this.notify.success(data.supplier ? `${saved.name} saved.` : `${saved.name} added.`);
      if (data.supplier) {
        // The bills show the name and bank account of their supplier.
        this.cancelRefresh();
        this.refresh();
      }
    });
  }

  async deleteSupplier(supplier: Supplier): Promise<void> {
    if (this.deletingSupplierId() !== null) return;
    const confirmed = await this.confirmService.confirm({
      title: `Delete ${supplier.name}?`,
      message: "The supplier has no bills. Deleting it can't be undone.",
      details: [{ label: 'Country', value: countryName(supplier.country) }],
      confirmText: 'Delete supplier',
      cancelText: 'Keep supplier',
      danger: true,
    });
    if (!confirmed) return;
    this.supplierError.set(null);
    this.deletingSupplierId.set(supplier.id);
    this.supplierService.delete(this.userId, supplier.id).subscribe({
      next: () => {
        this.deletingSupplierId.set(null);
        this.suppliers.update(list => list.filter(s => s.id !== supplier.id));
        this.notify.success(`${supplier.name} deleted.`);
      },
      error: err => {
        this.deletingSupplierId.set(null);
        this.supplierError.set({ id: supplier.id, message: httpErrorMessage(err, 'Unable to delete the supplier. Try again.') });
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

  paymentResultTitle(result: BillPaymentResult): string {
    const created = result.created === 1 ? '1 transfer waits for your approval' : `${result.created} transfers wait for your approval`;
    return result.failed ? `${created}, ${plural(result.failed, 'bill')} not paid` : created;
  }

  failedItems(result: BillPaymentResult): BillPaymentItem[] {
    return result.results.filter(item => !!item.error);
  }

  /** Why the bill can't be paid by transfer, unless the alerts of the page already say it. */
  payHint(bill: Bill): string | null {
    if (bill.payableByTransfer) return null;
    if (!bill.supplier.bankAccount) return `${bill.supplier.name} has no bank details.`;
    if (bill.payableByCard) return null;
    const settings = this.settings();
    return settings?.transfersIssue ?? settings?.cardsIssue ?? "This bill can't be paid yet.";
  }

  categoryLabel(code: string | null | undefined): string {
    if (!code) return '';
    const account = this.settings()?.categories.find(category => category.code === code);
    return account ? `${account.code} · ${account.name}` : code;
  }

  initialsOf(name: string): string {
    const words = name.split(/\s+/).filter(word => /[a-z0-9]/i.test(word));
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

  trackById(_: number, bill: Bill): number {
    return bill.id;
  }

  trackSupplier(_: number, supplier: Supplier): number {
    return supplier.id;
  }

  trackEvent(index: number, event: BillEvent): string {
    return `${index}-${event.type}-${event.occurredAt}`;
  }
}
