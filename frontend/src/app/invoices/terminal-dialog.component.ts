import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, TimeoutError, timeout } from 'rxjs';
import { Invoice, InvoiceTerminal, TerminalResult } from '../models';
import { InvoiceService } from '../services';
import { InlineAlertComponent, formatMoney, httpErrorMessage, httpStatus } from '../shared';
import { cardBrandLabel } from '../checkout/payment-outcome';

export type TerminalDialogMode = 'payment' | 'refund';

export interface TerminalDialogData {
  userId: string;
  invoice: Invoice;
  mode: TerminalDialogMode;
}

/** Closes with the invoice as the terminal left it; null when that's unknown, so the page reloads it. */
export interface TerminalDialogResult {
  invoice: Invoice | null;
}

/** The terminal answers within 3 minutes, and the backend then applies its answer. */
const TERMINAL_TIMEOUT_MS = 200_000;
const SLOW_TERMINAL_SECONDS = 45;
/** The backend registers the payment before asking the terminal: a cancel sent earlier wouldn't find it. */
const CANCEL_AFTER_SECONDS = 2;

type Step = 'choose' | 'waiting' | 'result';
type ResultKind = 'success' | 'failure' | 'cancelled' | 'error' | 'unknown';

interface StoreGroup {
  storeId: string;
  label: string;
  terminals: InvoiceTerminal[];
}

interface ResultView {
  kind: ResultKind;
  icon: string;
  title: string;
  message: string;
  /** Nothing was charged or refunded, so the same operation can be sent again. */
  retry: boolean;
  /** Something to act on, e.g. a second payment of the invoice. */
  warning?: string | null;
  card?: string | null;
  pspReference?: string | null;
}

/** The terminals store by store, in the order the backend lists them. */
function groupByStore(terminals: InvoiceTerminal[]): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const terminal of terminals) {
    let group = groups.get(terminal.storeId);
    if (!group) {
      const name = terminal.storeReference || terminal.storeId;
      group = { storeId: terminal.storeId, label: terminal.storeCity ? `${name} · ${terminal.storeCity}` : name, terminals: [] };
      groups.set(terminal.storeId, group);
    }
    group.terminals.push(terminal);
  }
  return [...groups.values()];
}

/** "Visa •••• 1111", null when the terminal didn't read a card. */
function cardText(brand: string | null | undefined, maskedPan: string | null | undefined): string | null {
  const lastFour = /(\d{4})$/.exec(maskedPan ?? '')?.[1];
  if (!brand && !lastFour) return null;
  return `${cardBrandLabel(brand)}${lastFour ? ` •••• ${lastFour}` : ''}`;
}

/**
 * Collects the payment of an invoice at a terminal of a store of the account, or refunds it there: chooses the
 * terminal, waits for its answer and shows it. Stays open while the terminal works.
 */
@Component({
  selector: 'app-terminal-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, InlineAlertComponent],
  templateUrl: './terminal-dialog.component.html',
  styleUrls: ['./dialog.css', './terminal-dialog.component.css'],
})
export class TerminalDialogComponent {
  private readonly data: TerminalDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TerminalDialogComponent, TerminalDialogResult>>(MatDialogRef);
  private readonly invoiceService = inject(InvoiceService);
  private readonly destroyRef = inject(DestroyRef);

  readonly refund = this.data.mode === 'refund';
  readonly invoice = signal(this.data.invoice);
  /** A payment collects what the customer owes; a refund gives back what the refunds haven't given back yet. */
  readonly amount = computed(() => {
    const invoice = this.invoice();
    return this.refund ? Math.max(0, invoice.total - (invoice.refundedAmount ?? 0)) : invoice.amountDue;
  });

  readonly step = signal<Step>('choose');
  readonly terminals = signal<InvoiceTerminal[]>([]);
  readonly terminalsLoaded = signal(false);
  readonly loadingTerminals = signal(false);
  readonly terminalsError = signal<string | null>(null);
  readonly groups = computed(() => groupByStore(this.terminals()));
  readonly selectedId = signal<string | null>(null);

  /** The terminal of the operation in progress, or of the last one. */
  readonly terminalId = signal<string | null>(null);
  readonly operationAmount = signal(0);
  readonly elapsedSeconds = signal(0);
  readonly isSlow = computed(() => this.elapsedSeconds() >= SLOW_TERMINAL_SECONDS);
  readonly canCancel = computed(() => this.elapsedSeconds() >= CANCEL_AFTER_SECONDS && !this.cancelling());
  readonly cancelling = signal(false);
  readonly cancelError = signal<string | null>(null);
  readonly result = signal<ResultView | null>(null);

  readonly title = this.refund ? 'Refund at a terminal' : 'Collect at a terminal';
  readonly amountText = computed(() => formatMoney(this.amount(), this.invoice().currency));
  /** The amount of the recap: once sent, the amount of the operation, which the answer doesn't change. */
  readonly recapAmount = computed(() => formatMoney(this.step() === 'choose' ? this.amount() : this.operationAmount(),
    this.invoice().currency));
  readonly waitingTitle = computed(() => {
    if (this.cancelling()) return 'Cancelling the payment';
    return this.refund ? 'Refunding at the terminal' : 'Waiting for the customer';
  });
  readonly waitingText = computed(() => this.refund
    ? 'The terminal sends the refund to the card the customer paid with. Keep this window open.'
    : 'Ask the customer to present their card on the terminal. Keep this window open.');
  readonly slowText = computed(() => this.refund
    ? 'Taking longer than usual. Check the terminal screen.'
    : 'Taking longer than usual: the customer may need to enter their PIN.');

  /** The polite live region: it changes with the state only, never with the elapsed seconds. */
  readonly liveMessage = computed(() => {
    switch (this.step()) {
      case 'waiting':
        if (this.cancelling()) return 'Cancelling the payment on the terminal…';
        if (this.isSlow()) return this.slowText();
        return `${this.waitingTitle()}. ${this.waitingText()}`;
      case 'result': {
        const result = this.result();
        return result ? `${result.title}. ${result.message}` : '';
      }
      default:
        return '';
    }
  });

  /** Undefined until the terminal is asked: the page then has nothing to update. */
  private latest: Invoice | null | undefined;
  private terminalsSub?: Subscription;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Escape and the backdrop go through close(): the page gets the invoice as the terminal left it.
    this.dialogRef.disableClose = true;
    this.dialogRef.backdropClick().pipe(takeUntilDestroyed()).subscribe(() => this.close());
    this.dialogRef.keydownEvents().pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    this.destroyRef.onDestroy(() => this.stopTimer());
    this.loadTerminals();
  }

  loadTerminals(): void {
    this.terminalsSub?.unsubscribe();
    this.loadingTerminals.set(true);
    this.terminalsError.set(null);
    this.terminalsSub = this.invoiceService.getTerminals(this.data.userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: terminals => {
          const list = terminals ?? [];
          this.terminals.set(list);
          this.terminalsLoaded.set(true);
          this.loadingTerminals.set(false);
          if (!list.some(terminal => terminal.id === this.selectedId())) {
            const last = this.lastUsed();
            this.selectedId.set(list.length === 1 ? list[0].id
              : list.some(terminal => terminal.id === last) ? last : null);
          }
        },
        error: err => {
          this.loadingTerminals.set(false);
          this.terminalsError.set(httpErrorMessage(err, 'Unable to load the terminals of your stores. Try again.'));
        }
      });
  }

  select(terminalId: string): void {
    this.selectedId.set(terminalId);
  }

  start(): void {
    const terminalId = this.selectedId();
    if (!terminalId || this.step() !== 'choose' || this.loadingTerminals()) return;
    const invoice = this.invoice();
    this.remember(terminalId);
    this.terminalId.set(terminalId);
    this.operationAmount.set(this.amount());
    this.result.set(null);
    this.cancelling.set(false);
    this.cancelError.set(null);
    this.step.set('waiting');
    this.startTimer();
    this.focus('terminal-step-title');
    const request$ = this.refund
      ? this.invoiceService.refundAtTerminal(this.data.userId, invoice.id, terminalId)
      : this.invoiceService.payAtTerminal(this.data.userId, invoice.id, terminalId);
    request$.pipe(timeout(TERMINAL_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => this.finish(result.invoice ?? null, this.viewOf(result)),
      error: err => this.finish(null, this.errorView(err)),
    });
  }

  /** Asks the terminal to stop waiting for the card: the payment then ends as cancelled, unless the customer just paid. */
  cancelPayment(): void {
    if (this.refund || this.step() !== 'waiting' || !this.canCancel()) return;
    this.cancelling.set(true);
    this.cancelError.set(null);
    this.invoiceService.cancelTerminalPayment(this.data.userId, this.invoice().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // Once the terminal took it, "Cancelling…" stays until the terminal answers the payment.
        error: err => {
          if (this.step() !== 'waiting') return;
          this.cancelling.set(false);
          this.cancelError.set(httpErrorMessage(err, "The cancellation didn't reach the terminal. Cancel the payment on its screen."));
        }
      });
  }

  tryAgain(): void {
    if (this.step() !== 'result' || !this.result()?.retry) return;
    this.result.set(null);
    this.step.set('choose');
    if (!this.terminals().length) this.loadTerminals();
    this.focus('terminal-dialog-title');
  }

  close(): void {
    if (this.step() === 'waiting') return;
    this.dialogRef.close(this.latest === undefined ? undefined : { invoice: this.latest });
  }

  trackGroup(_: number, group: StoreGroup): string {
    return group.storeId;
  }

  trackTerminal(_: number, terminal: InvoiceTerminal): string {
    return terminal.id;
  }

  private finish(invoice: Invoice | null, view: ResultView): void {
    this.stopTimer();
    this.latest = invoice;
    if (invoice) this.invoice.set(invoice);
    this.cancelling.set(false);
    this.result.set(view);
    this.step.set('result');
    this.focus('terminal-step-title');
  }

  private viewOf(result: TerminalResult): ResultView {
    const message = result.message?.trim() || null;
    const amount = formatMoney(this.operationAmount(), this.invoice().currency);
    if (this.refund) {
      switch (result.outcome) {
        case 'REQUESTED':
          return {
            kind: 'success', icon: 'check_circle', title: 'Refund requested', retry: false, pspReference: result.pspReference,
            message: `${amount} goes back to the card the customer paid with. The invoice shows Refunded once the refund is confirmed.`,
          };
        case 'DECLINED':
        case 'CANCELLED':
          return {
            kind: 'failure', icon: 'cancel', title: 'Refund declined', retry: true,
            message: `${message ?? 'The terminal refused the refund.'} Nothing was refunded.`,
          };
        case 'ERROR':
          return {
            kind: 'error', icon: 'portable_wifi_off', title: "Couldn't reach the terminal", retry: true,
            message: `${message ?? "The terminal didn't take the refund."} Nothing was refunded.`,
          };
        default:
          return {
            kind: 'unknown', icon: 'warning', title: 'Status unknown', retry: false,
            message: `${message ?? "The terminal's answer was lost."} The invoice shows the refund once it's confirmed.`,
          };
      }
    }
    const card = cardText(result.cardBrand, result.maskedPan);
    switch (result.outcome) {
      case 'APPROVED':
        return {
          kind: 'success', icon: 'check_circle', title: 'Payment approved', retry: false, card,
          pspReference: result.pspReference, warning: message,
          message: `${this.invoice().number} is paid. The customer can take their card.`,
        };
      case 'DECLINED':
        return {
          kind: 'failure', icon: 'cancel', title: 'Payment declined', retry: true, card,
          message: `${message ?? 'The card was declined.'} No money was taken.`,
        };
      case 'CANCELLED':
        return { kind: 'cancelled', icon: 'do_not_disturb_on', title: 'Payment cancelled', retry: true, message: 'No money was taken.' };
      case 'ERROR':
        return {
          kind: 'error', icon: 'portable_wifi_off', title: "Couldn't reach the terminal", retry: true,
          message: `${message ?? "The terminal didn't take the payment."} Nothing was charged.`,
        };
      default:
        return {
          kind: 'unknown', icon: 'warning', title: 'Status unknown', retry: false,
          message: `${message ?? "The terminal's answer was lost."} If the customer paid, the invoice turns to Paid on its own.`,
        };
    }
  }

  /** Without an answer of the backend, the terminal may still have taken the payment or the refund. */
  private errorView(err: unknown): ResultView {
    const settled = this.refund
      ? 'Check the terminal screen: the invoice shows the refund once it\'s confirmed.'
      : 'Check the terminal screen: if the customer paid, the invoice turns to Paid on its own.';
    if (err instanceof TimeoutError) {
      return { kind: 'unknown', icon: 'warning', title: 'Status unknown', retry: false, message: `The terminal didn't answer in time. ${settled}` };
    }
    const status = httpStatus(err) ?? 0;
    if (status === 0 || status >= 500) {
      return {
        kind: 'unknown', icon: 'warning', title: 'Status unknown', retry: false,
        message: `${status === 0 ? 'The connection to the server was lost.' : 'Something went wrong on the server.'} ${settled}`,
      };
    }
    return {
      kind: 'error', icon: 'error_outline', title: this.refund ? "Couldn't start the refund" : "Couldn't start the payment",
      // The backend refused before asking the terminal: nothing was charged or refunded.
      retry: status !== 404,
      message: httpErrorMessage(err, 'The request was refused. Try again.'),
    };
  }

  private storageKey(): string {
    return `invoice-terminal:${this.data.userId}`;
  }

  private lastUsed(): string | null {
    try {
      return localStorage.getItem(this.storageKey());
    } catch {
      return null;
    }
  }

  private remember(terminalId: string): void {
    try {
      localStorage.setItem(this.storageKey(), terminalId);
    } catch {
      // Storage is off, e.g. in a private window: the next payment preselects nothing.
    }
  }

  private focus(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus());
  }

  private startTimer(): void {
    this.stopTimer();
    this.elapsedSeconds.set(0);
    const started = Date.now();
    this.timer = setInterval(() => this.elapsedSeconds.set(Math.floor((Date.now() - started) / 1000)), 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
