import { Component, ElementRef, OnInit, ViewChild, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { A11yModule, LiveAnnouncer } from '@angular/cdk/a11y';
import { MaterialModule } from '../material.module';

import {
  CardExpense,
  CardExpenseSettings,
  CardResponse,
  CardTransfer,
  CardTransferValidationFact,
  LedgerAccount
} from '../models';
import { CardExpenseService, IssuingService } from '../services';
import { InlineAlertComponent, blobHttpErrorMessage, formatMoney, httpErrorMessage, saveFile } from '../shared';
import { LineAmounts, formatRate, grossAmounts } from '../invoices/invoice-view';
import { MCC_CODES } from '../industry-codes';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = { ...DATE_FORMAT, hour: '2-digit', minute: '2-digit' };

/** Labels for transfer and event statuses; anything else is humanized. */
const STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  authorised: 'Authorised',
  captured: 'Captured',
  booked: 'Booked',
  refused: 'Declined',
  refunded: 'Refunded',
  refundPending: 'Refund pending',
  expired: 'Expired',
  error: 'Failed'
};
const CARD_STATUS_LABELS: Record<string, string> = { active: 'Active', suspended: 'Suspended', closed: 'Closed' };
const ADVICE_LABELS: Record<string, string> = {
  DenyTransaction: 'Declined by a rule',
  AllowTransaction: 'Allowed by the rules'
};

/** Card transfers that moved no money: there is nothing to book. */
const NOT_BOOKED_STATUSES = new Set(['refused', 'error', 'expired', 'cancelled', 'failed', 'rejected']);
const OTHER_EXPENSES = '6290';
/** As the backend accepts it. */
const MAX_NOTE = 500;

type ExpenseAction = 'save' | 'remove' | 'upload' | 'download' | 'deleteReceipt';
type Confirmation = 'remove' | 'deleteReceipt';

@Component({
  selector: 'app-card-transactions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    A11yModule,
    MaterialModule,
    RouterLink,
    InlineAlertComponent
  ],
  templateUrl: './card-transactions.component.html',
  styleUrl: './card-transactions.component.css'
})
export class CardTransactionsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private issuingService = inject(IssuingService);
  private cardExpenseService = inject(CardExpenseService);
  private liveAnnouncer = inject(LiveAnnouncer);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('confirmButton', { read: ElementRef }) private confirmButton?: ElementRef<HTMLElement>;
  @ViewChild('removeButton', { read: ElementRef }) private removeButton?: ElementRef<HTMLElement>;
  @ViewChild('deleteReceiptButton', { read: ElementRef }) private deleteReceiptButton?: ElementRef<HTMLElement>;

  userId = '';
  cards: CardResponse[] = [];
  transfers: CardTransfer[] = [];
  selectedPaymentInstrumentId = '';
  selectedTransfer?: CardTransfer;
  isLoading = false;
  isLoadingCards = false;
  cardsError: string | null = null;
  transfersError: string | null = null;

  expenseSettings: CardExpenseSettings | null = null;
  isLoadingExpenseSettings = false;
  expenseSettingsError: string | null = null;
  /** The expense form of the transaction open in the detail. */
  expenseCategory = '';
  expenseVatRate = 0;
  expenseNote = '';
  expenseCategories: LedgerAccount[] = [];
  expenseRates: number[] = [];
  expenseBusy: ExpenseAction | null = null;
  expenseError: string | null = null;
  receiptError: string | null = null;
  confirming: Confirmation | null = null;
  readonly maxNote = MAX_NOTE;
  readonly formatRate = formatRate;

  private detailOpener: HTMLElement | null = null;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadCards();
        this.loadExpenseSettings();
      }
    });
  }

  loadCards() {
    this.isLoadingCards = true;
    this.cardsError = null;
    this.cdr.detectChanges();
    this.issuingService.getCards(this.userId).subscribe({
      next: (cards) => {
        this.cards = cards || [];
        this.isLoadingCards = false;
        const stillExists = this.cards.some(c => c.paymentInstrumentId === this.selectedPaymentInstrumentId);
        if (!stillExists) {
          this.selectedPaymentInstrumentId = this.cards[0]?.paymentInstrumentId || '';
        }
        this.loadTransfers();
      },
      error: (err) => {
        this.isLoadingCards = false;
        this.cardsError = httpErrorMessage(err, "The cards couldn't be loaded. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  loadTransfers() {
    this.transfersError = null;
    if (!this.selectedPaymentInstrumentId) {
      this.isLoading = false;
      this.transfers = [];
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.cdr.detectChanges();

    this.issuingService.getCardTransfers(this.userId, this.selectedPaymentInstrumentId).subscribe({
      next: (transfers) => {
        this.transfers = transfers || [];
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.transfers = [];
        this.isLoading = false;
        this.transfersError = httpErrorMessage(err, "The card transactions couldn't be loaded. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  /** The categories, tax rates and receipt limits of the expense form. */
  loadExpenseSettings() {
    this.isLoadingExpenseSettings = true;
    this.expenseSettingsError = null;
    this.cdr.detectChanges();
    this.cardExpenseService.getSettings(this.userId).subscribe({
      next: settings => {
        this.expenseSettings = settings;
        this.isLoadingExpenseSettings = false;
        // The form only shows once the settings are there, so nothing typed is lost.
        if (this.selectedTransfer) this.resetExpenseForm(this.selectedTransfer);
        this.cdr.detectChanges();
      },
      error: err => {
        this.isLoadingExpenseSettings = false;
        this.expenseSettingsError = httpErrorMessage(err, "The expense categories couldn't be loaded. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  getSelectedCard(): CardResponse | undefined {
    return this.cards.find(c => c.paymentInstrumentId === this.selectedPaymentInstrumentId);
  }

  cardOptionLabel(card: CardResponse): string {
    const brand = card.brand === 'visa' ? 'Visa' : card.brand === 'mc' ? 'Mastercard' : card.brand;
    const currency = card.currencyCode ? ` · ${card.currencyCode}` : '';
    const status = CARD_STATUS_LABELS[card.status] ?? this.humanize(card.status);
    return `${card.cardholderName} · ${brand} •••• ${card.lastFour}${currency} (${status})`;
  }

  onCardFilterChange() {
    this.loadTransfers();
  }

  refresh() {
    if (this.cardsError || !this.cards.length) {
      this.loadCards();
    } else {
      this.loadTransfers();
    }
    if (!this.expenseSettings && !this.isLoadingExpenseSettings) {
      this.loadExpenseSettings();
    }
  }

  openDetail(transfer: CardTransfer, event?: Event) {
    this.detailOpener = (event?.currentTarget as HTMLElement | null) ?? null;
    this.selectedTransfer = transfer;
    this.resetExpenseForm(transfer);
    this.cdr.detectChanges();
  }

  closeDetail() {
    this.selectedTransfer = undefined;
    this.confirming = null;
    this.cdr.detectChanges();
    const opener = this.detailOpener;
    this.detailOpener = null;
    if (opener?.isConnected) opener.focus();
  }

  // ---------- Expense ----------

  /** A payment that moved money and doesn't pay a bill is booked to the expense category the user chooses. */
  canClassify(transfer: CardTransfer): boolean {
    return !transfer.billId && !NOT_BOOKED_STATUSES.has(transfer.status);
  }

  /** A payment without its receipt. A refund needs none. */
  receiptMissing(transfer: CardTransfer): boolean {
    if (!this.canClassify(transfer) || transfer.direction === 'incoming') return false;
    return transfer.expense ? transfer.expense.receiptMissing : true;
  }

  /** "6240 · Travel", or the bill the single-use card pays. */
  bookingLabel(transfer: CardTransfer): string {
    if (transfer.billId) return transfer.billNumber ? `Pays ${transfer.billNumber}` : 'Pays a bill';
    return transfer.expense ? `${transfer.expense.category} · ${transfer.expense.categoryName}` : '';
  }

  /** The tax included in the payment at the rate chosen in the form. */
  expenseAmounts(transfer: CardTransfer): LineAmounts {
    return grossAmounts(Math.abs(transfer.amount || 0), Number(this.expenseVatRate) || 0);
  }

  expenseChanged(transfer: CardTransfer): boolean {
    const expense = transfer.expense;
    if (!expense) return true;
    return expense.category !== this.expenseCategory
      || Number(expense.vatRate) !== Number(this.expenseVatRate)
      || (expense.note ?? '') !== this.expenseNote.trim();
  }

  saveExpense() {
    const transfer = this.selectedTransfer;
    if (!transfer || this.expenseBusy || !this.expenseCategory || !this.expenseChanged(transfer)) return;
    const request = {
      category: this.expenseCategory,
      vatRate: Number(this.expenseVatRate),
      note: this.expenseNote.trim() || null
    };
    this.startExpenseAction('save');
    this.cardExpenseService.save(this.userId, transfer.id, request).subscribe({
      next: expense => this.expenseUpdated(transfer, expense, true,
        `Expense saved: booked to ${expense.category} ${expense.categoryName}.`),
      error: err => this.expenseFailed(transfer, 'expense', httpErrorMessage(err, "The expense couldn't be saved. Try again."))
    });
  }

  removeExpense() {
    const transfer = this.selectedTransfer;
    if (!transfer?.expense || this.expenseBusy) return;
    this.startExpenseAction('remove');
    this.cardExpenseService.delete(this.userId, transfer.id).subscribe({
      next: () => this.expenseUpdated(transfer, null, true,
        'Category removed: the journal books the payment to Suspense again.'),
      error: err => this.expenseFailed(transfer, 'expense',
        httpErrorMessage(err, "The category couldn't be removed. Try again."))
    });
  }

  /** The browser sends the file as a data URL; the backend checks what it really is. */
  onReceiptChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Lets the same file be chosen again after an error.
    input.value = '';
    const transfer = this.selectedTransfer;
    if (!file || !transfer || this.expenseBusy) return;
    const problem = this.receiptProblem(file);
    if (problem) {
      this.receiptError = problem;
      this.cdr.detectChanges();
      return;
    }
    this.startExpenseAction('upload');
    const reader = new FileReader();
    reader.onload = () => {
      this.cardExpenseService.uploadReceipt(this.userId, transfer.id, { fileName: file.name, data: String(reader.result) })
        .subscribe({
          next: expense => this.expenseUpdated(transfer, expense, false, `Receipt ${expense.receipt?.name ?? file.name} added.`),
          error: err => this.expenseFailed(transfer, 'receipt',
            httpErrorMessage(err, "The receipt couldn't be added. Try again."))
        });
    };
    reader.onerror = () => this.expenseFailed(transfer, 'receipt', "The receipt couldn't be read. Choose it again.");
    reader.readAsDataURL(file);
  }

  downloadReceipt() {
    const transfer = this.selectedTransfer;
    const receipt = transfer?.expense?.receipt;
    if (!transfer || !receipt || this.expenseBusy) return;
    this.startExpenseAction('download');
    this.cardExpenseService.downloadReceipt(this.userId, transfer.id).subscribe({
      next: blob => {
        this.expenseBusy = null;
        saveFile(blob, receipt.name);
        this.cdr.detectChanges();
      },
      error: async err => {
        const message = await blobHttpErrorMessage(err, "The receipt couldn't be downloaded. Try again.");
        this.expenseFailed(transfer, 'receipt', message);
      }
    });
  }

  deleteReceipt() {
    const transfer = this.selectedTransfer;
    if (!transfer?.expense?.receipt || this.expenseBusy) return;
    this.startExpenseAction('deleteReceipt');
    this.cardExpenseService.deleteReceipt(this.userId, transfer.id).subscribe({
      next: expense => this.expenseUpdated(transfer, expense, false, 'Receipt deleted.'),
      error: err => this.expenseFailed(transfer, 'receipt',
        httpErrorMessage(err, "The receipt couldn't be deleted. Try again."))
    });
  }

  askConfirm(confirmation: Confirmation) {
    if (this.expenseBusy) return;
    this.confirming = confirmation;
    this.cdr.detectChanges();
    this.confirmButton?.nativeElement.focus();
  }

  cancelConfirm() {
    const confirmation = this.confirming;
    this.confirming = null;
    this.cdr.detectChanges();
    const trigger = confirmation === 'remove' ? this.removeButton : this.deleteReceiptButton;
    trigger?.nativeElement.focus();
  }

  receiptAccept(): string {
    return this.expenseSettings?.receiptTypes.join(',') ?? '';
  }

  receiptLimit(): string {
    return this.fileSize(this.expenseSettings?.maxReceiptBytes ?? 0);
  }

  /** "180 KB", "1.4 MB" */
  fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    const megabytes = bytes / (1024 * 1024);
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }

  isPdf(contentType: string | null | undefined): boolean {
    return contentType === 'application/pdf';
  }

  private resetExpenseForm(transfer: CardTransfer) {
    const expense = transfer.expense;
    const settings = this.expenseSettings;
    const categories = settings?.categories ?? [];
    this.expenseCategory = expense?.category ?? transfer.suggestedCategory ?? OTHER_EXPENSES;
    this.expenseVatRate = expense ? Number(expense.vatRate) : Number(settings?.defaultVatRate ?? 0);
    this.expenseNote = expense?.note ?? '';
    this.expenseCategories = expense && !categories.some(c => c.code === expense.category)
      ? [...categories, { code: expense.category, name: expense.categoryName }]
      : categories;
    this.expenseRates = [...new Set([...(settings?.vatRates ?? []).map(Number), this.expenseVatRate])]
      .sort((a, b) => b - a);
    this.expenseError = null;
    this.receiptError = null;
    this.confirming = null;
  }

  private startExpenseAction(action: ExpenseAction) {
    this.expenseBusy = action;
    this.expenseError = null;
    this.receiptError = null;
    this.confirming = null;
    this.cdr.detectChanges();
  }

  /** Saving or removing resets the form; a receipt leaves what the user is typing in it. */
  private expenseUpdated(transfer: CardTransfer, expense: CardExpense | null, resetForm: boolean, announcement: string) {
    transfer.expense = expense;
    this.expenseBusy = null;
    if (resetForm && this.selectedTransfer === transfer) this.resetExpenseForm(transfer);
    this.liveAnnouncer.announce(announcement);
    this.cdr.detectChanges();
  }

  private expenseFailed(transfer: CardTransfer, target: 'expense' | 'receipt', message: string) {
    this.expenseBusy = null;
    if (this.selectedTransfer === transfer) {
      if (target === 'expense') this.expenseError = message;
      else this.receiptError = message;
    }
    this.cdr.detectChanges();
  }

  private receiptProblem(file: File): string | null {
    const settings = this.expenseSettings;
    if (!file.size) return 'The receipt is empty.';
    if (!settings) return null;
    if (file.type && !settings.receiptTypes.includes(file.type)) {
      return 'The receipt must be a PDF or an image: PNG, JPEG, GIF or WebP.';
    }
    if (file.size > settings.maxReceiptBytes) {
      return `The receipt is larger than ${this.receiptLimit()}. Choose a smaller file.`;
    }
    return null;
  }

  // ---------- View ----------

  getMccLabel(code: string): string {
    const mcc = MCC_CODES.find(m => m.code === code);
    return mcc ? mcc.label : code;
  }

  /** Card spend is negative (money leaving the balance account); refunds and reversals are positive. */
  formatAmount(minorUnits: number, currency: string): string {
    return formatMoney(minorUnits, currency, 'exceptZero');
  }

  /** Event amounts carry no direction, so they are shown unsigned. */
  formatEventAmount(minorUnits: number, currency: string): string {
    return formatMoney(Math.abs(minorUnits || 0), currency);
  }

  money(minorUnits: number, currency: string): string {
    return formatMoney(minorUnits, currency);
  }

  /** Transfers API amounts are unsigned; the direction tells whether money left or reached the account. */
  signedAmount(transfer: CardTransfer): number {
    const value = Math.abs(transfer.amount || 0);
    if (transfer.direction === 'outgoing') return -value;
    if (transfer.direction === 'incoming') return value;
    return transfer.amount || 0;
  }

  isCredit(transfer: CardTransfer): boolean {
    return this.signedAmount(transfer) > 0;
  }

  directionLabel(transfer: CardTransfer): string {
    const status = (transfer.status || '').toLowerCase();
    if (status.startsWith('refund')) return 'Refund';
    const amount = this.signedAmount(transfer);
    if (amount > 0) return 'Credit';
    if (amount < 0) return 'Payment';
    return '';
  }

  formatDate(dateStr: string): string {
    return this.formatWith(dateStr, DATE_FORMAT);
  }

  formatDateTime(dateStr: string | null | undefined): string {
    return this.formatWith(dateStr, DATE_TIME_FORMAT);
  }

  private formatWith(dateStr: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleString('en-GB', options);
  }

  /** "refundPending" -> "Refund pending", "TransactionValidation" -> "Transaction validation". */
  humanize(value: string): string {
    if (!value) return '';
    const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? (this.humanize(status) || 'Unknown');
  }

  adviceLabel(advice: string): string {
    return ADVICE_LABELS[advice] ?? this.humanize(advice);
  }

  channelLabel(processingType: string): string {
    if (processingType === 'ecommerce') return 'Online';
    if (processingType === 'pos') return 'In store';
    return processingType ? this.humanize(processingType) : '—';
  }

  getInvalidFacts(facts: CardTransferValidationFact[] | null | undefined): CardTransferValidationFact[] {
    return facts ? facts.filter(f => f.result === 'invalid') : [];
  }

  formatLocation(city?: string, country?: string): string {
    return [city, country].filter(Boolean).join(', ');
  }
}
