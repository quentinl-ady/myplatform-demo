import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Location, NgFor, NgIf } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, timeout } from 'rxjs';
import { Invoice } from '../models';
import { TerminalAppService } from '../services';
import { ConfirmService, formatMoney } from '../shared';
import { dueText } from '../invoices/invoice-view';
import { InvoiceNavigationState, LOAD_TIMEOUT_MS, TerminalStore } from './terminal-store';
import {
  Operation, ResultKind, ResultView, amountOf, apiError, badgeOf, blockedReason, detailRows, errorResultView,
  refundCard, refundableAmount, resultView, waitingTitle,
} from './terminal-view';

/** The terminal answers within 3 minutes, and the backend then applies its answer. */
const OPERATION_TIMEOUT_MS = 200_000;
/** After this, the customer is probably entering their PIN, or the terminal needs attention. */
const SLOW_SECONDS = 45;

type OperationState =
  | { type: 'idle' }
  /** The refund waits for the confirmation of the user. */
  | { type: 'confirmRefund' }
  /** The terminal handles the payment or the refund: the backend answers once it's done. */
  | { type: 'waiting'; operation: Operation; amount: number; startedAt: number }
  /** stale: the backend didn't send the invoice back, so it's reloaded when the result closes. */
  | { type: 'done'; operation: Operation; view: ResultView; stale: boolean };

const RESULT_ICONS: Record<ResultKind, string> = {
  success: 'check_circle',
  failure: 'cancel',
  cancelled: 'info',
  error: 'warning',
  unknown: 'warning',
};

/** An invoice: collects its payment at this terminal, or refunds it. Waits for the terminal, then shows its answer. */
@Component({
  selector: 'app-terminal-invoice',
  standalone: true,
  imports: [NgIf, NgFor, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './terminal-invoice.component.html',
  styleUrls: ['./terminal.css', './terminal-invoice.component.css'],
})
export class TerminalInvoiceComponent implements OnInit, OnDestroy {
  readonly store = inject(TerminalStore);
  private readonly api = inject(TerminalAppService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly confirmService = inject(ConfirmService);

  private readonly invoiceId = Number(this.route.snapshot.paramMap.get('invoiceId'));
  /** The copy of the list shows at once, until the backend sends the invoice. */
  readonly invoice = signal<Invoice | null>(this.store.invoices().find(item => item.id === this.invoiceId) ?? null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly operation = signal<OperationState>({ type: 'idle' });
  private readonly now = signal(Date.now());

  readonly resultIcons = RESULT_ICONS;

  readonly view = computed(() => {
    const invoice = this.invoice();
    if (!invoice) return null;
    const money = (amount: number) => formatMoney(amount, invoice.currency);
    return {
      name: invoice.customer.displayName?.trim() || invoice.number,
      amount: money(amountOf(invoice)),
      badge: badgeOf(invoice),
      due: dueText(invoice),
      overdue: invoice.status === 'OVERDUE',
      rows: detailRows(invoice),
      refund: refundCard(invoice),
      lines: (invoice.lines ?? []).map(line => ({
        description: line.description,
        detail: `${line.quantity} × ${money(line.unitPrice)}`,
        amount: money(line.netAmount),
      })),
      totals: [
        { label: 'Subtotal', value: money(invoice.subtotal) },
        { label: 'Tax', value: money(invoice.taxTotal) },
        { label: 'Total', value: money(invoice.total) },
      ],
      notes: invoice.notes?.trim() || null,
      collect: invoice.terminalPayable ? `Collect ${money(invoice.amountDue)}` : null,
      refundAction: invoice.refundable ? `Refund ${money(refundableAmount(invoice))}` : null,
      blocked: blockedReason(invoice),
    };
  });

  readonly waiting = computed(() => {
    const state = this.operation();
    if (state.type !== 'waiting') return null;
    const invoice = this.invoice();
    const refund = state.operation === 'refund';
    return {
      title: waitingTitle(state.operation, state.amount, invoice?.currency),
      subtitle: invoice ? `${invoice.number} · ${invoice.customer.displayName}` : null,
      text: refund
        ? 'The terminal sends the refund to the card the customer paid with.'
        : 'The customer follows the instructions on the payment screen.',
      slowText: refund
        ? 'Taking longer than usual. Check the payment screen.'
        : 'Taking longer than usual: the customer may be entering their PIN.',
      startedAt: state.startedAt,
    };
  });
  readonly elapsed = computed(() => {
    const waiting = this.waiting();
    return waiting ? Math.max(0, Math.floor((this.now() - waiting.startedAt) / 1000)) : 0;
  });
  readonly slow = computed(() => this.elapsed() >= SLOW_SECONDS);
  readonly done = computed(() => {
    const state = this.operation();
    return state.type === 'done' ? state : null;
  });

  /** The polite live region: it changes with the state only, never with the elapsed seconds. */
  readonly liveMessage = computed(() => {
    const waiting = this.waiting();
    if (waiting) return this.slow() ? waiting.slowText : `${waiting.title}. ${waiting.text}`;
    const done = this.done();
    return done ? `${done.view.title}. ${done.view.message}` : '';
  });

  private loadSub?: Subscription;
  private operationSub?: Subscription;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly backHandler = () => this.onBack();

  ngOnInit(): void {
    this.store.backHandler = this.backHandler;
    this.load();
  }

  ngOnDestroy(): void {
    if (this.store.backHandler === this.backHandler) this.store.backHandler = null;
    this.loadSub?.unsubscribe();
    // The terminal goes on with the operation, and the backend applies its answer to the invoice.
    this.operationSub?.unsubscribe();
    this.stopTicker();
  }

  load(): void {
    const { apiBase, terminalId, inApp } = this.store.session;
    if (!terminalId || this.operation().type === 'waiting' || (this.loadSub && !this.loadSub.closed)) return;
    this.loading.set(true);
    this.error.set(null);
    this.loadSub = this.api.getInvoice(apiBase, terminalId, this.invoiceId).pipe(timeout(LOAD_TIMEOUT_MS)).subscribe({
      next: invoice => {
        this.invoice.set(invoice);
        this.store.update(invoice);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(apiError(err, inApp).message);
      },
    });
  }

  collect(): void {
    const invoice = this.invoice();
    if (!invoice || this.operation().type !== 'idle' || !invoice.terminalPayable) return;
    this.start('payment', invoice, invoice.amountDue);
  }

  async askRefund(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || this.operation().type !== 'idle' || !invoice.refundable) return;
    this.operation.set({ type: 'confirmRefund' });
    const amount = formatMoney(refundableAmount(invoice), invoice.currency);
    const confirmed = await this.confirmService.confirm({
      title: `Refund ${amount}?`,
      message: `${invoice.customer.displayName?.trim() || 'The customer'} gets ${amount} back on the card they paid with. `
        + "This can't be undone.",
      confirmText: `Refund ${amount}`,
      danger: true,
    });
    if (this.operation().type !== 'confirmRefund') return;
    const current = this.invoice();
    if (!confirmed || !current) {
      this.operation.set({ type: 'idle' });
      return;
    }
    this.start('refund', current, refundableAmount(current));
  }

  /** Back to the invoice from the result. */
  closeResult(): void {
    const state = this.operation();
    if (state.type !== 'done') return;
    this.operation.set({ type: 'idle' });
    if (state.stale) this.load();
  }

  /** Sends the same operation again, when nothing was charged or refunded. */
  tryAgain(): void {
    const state = this.operation();
    if (state.type !== 'done' || !state.view.retry) return;
    this.operation.set({ type: 'idle' });
    if (state.operation === 'payment') {
      this.collect();
    } else {
      void this.askRefund();
    }
  }

  backToList(): void {
    const state = this.location.getState() as InvoiceNavigationState | null;
    if (state?.fromList) {
      this.location.back();
    } else {
      void this.router.navigate(['/terminal'], { queryParamsHandling: 'preserve', replaceUrl: true });
    }
  }

  private start(operation: Operation, invoice: Invoice, amount: number): void {
    const { apiBase, terminalId, inApp } = this.store.session;
    if (!terminalId) return;
    this.loadSub?.unsubscribe();
    this.loading.set(false);
    this.error.set(null);
    const startedAt = Date.now();
    this.now.set(startedAt);
    this.operation.set({ type: 'waiting', operation, amount, startedAt });
    this.startTicker();
    this.focusTitle();
    const amountText = formatMoney(amount, invoice.currency);
    const request$ = operation === 'payment'
      ? this.api.pay(apiBase, terminalId, invoice.id)
      : this.api.refund(apiBase, terminalId, invoice.id);
    this.operationSub = request$.pipe(timeout(OPERATION_TIMEOUT_MS)).subscribe({
      next: result => {
        if (result.invoice) {
          this.invoice.set(result.invoice);
          this.store.update(result.invoice);
        }
        this.finish(operation, resultView(operation, result, amountText, invoice.number), !result.invoice);
      },
      error: err => this.finish(operation, errorResultView(operation, apiError(err, inApp)), true),
    });
  }

  private finish(operation: Operation, view: ResultView, stale: boolean): void {
    this.stopTicker();
    this.operation.set({ type: 'done', operation, view, stale });
    this.focusTitle();
  }

  /** The back button of the terminal app. */
  private onBack(): boolean {
    switch (this.operation().type) {
      case 'waiting':
        // The terminal is handling the card: leaving wouldn't stop it.
        return true;
      case 'done':
        this.closeResult();
        return true;
      default:
        this.backToList();
        return true;
    }
  }

  private focusTitle(): void {
    setTimeout(() => document.getElementById('operation-title')?.focus());
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}
