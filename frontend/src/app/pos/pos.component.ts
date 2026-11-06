import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TimeoutError, timeout } from 'rxjs';
import { MaterialModule } from '../material.module';
import { PosPaymentRequest, PosPaymentResponse, Store, TerminalResponse } from '../models';
import { PaymentService, StoreService } from '../services';
import { ConfirmService, InlineAlertComponent, formatMoney, httpErrorMessage, toMinorUnits } from '../shared';

/** Terminal API sync requests can legitimately take up to ~2 minutes (card entry, PIN, 3DS on device). */
const TERMINAL_TIMEOUT_MS = 180_000;
const SLOW_TERMINAL_SECONDS = 45;
/** Nexo limits the MessageHeader ServiceID to 10 characters. */
const SERVICE_ID_LENGTH = 10;
const SERVICE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Terminal error conditions that end a payment without taking money (cancelled from the app or on the terminal). */
const CANCELLED_CONDITIONS = new Set(['aborted', 'cancel']);

const TERMINAL_STATUS_LABELS: Record<string, string> = {
  boarded: 'ready',
  boarding: 'setting up',
  deployed: 'deployed',
  inventory: 'in inventory',
  reassignmentinprogress: 'being reassigned'
};

export type PosOutcomeKind = 'success' | 'failure' | 'error' | 'cancelled';

export interface PosOutcome {
  kind: PosOutcomeKind;
  title: string;
  message: string;
  /** Request that produced this outcome, so a retry charges exactly the same amount on the same terminal. */
  request: PosPaymentRequest;
  response: PosPaymentResponse | null;
  reason: string;
}

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    InlineAlertComponent
  ],
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.css'
})
export class PosComponent implements OnInit {
  userId = '';
  readonly stores = signal<Store[]>([]);
  readonly terminals = signal<TerminalResponse[]>([]);

  readonly loadingStores = signal(true);
  readonly storesError = signal<string | null>(null);
  readonly loadingTerminals = signal(false);
  readonly terminalsError = signal<string | null>(null);
  readonly isPaying = signal(false);
  readonly elapsedSeconds = signal(0);
  readonly isSlow = computed(() => this.elapsedSeconds() >= SLOW_TERMINAL_SECONDS);
  readonly outcome = signal<PosOutcome | null>(null);
  readonly cancelling = signal(false);
  readonly abortError = signal<string | null>(null);

  /** Text of the polite live region: changes only on state changes, never with the elapsed counter. */
  readonly liveMessage = computed(() => {
    if (this.isPaying()) {
      if (this.cancelling()) return 'Cancelling the payment on the terminal…';
      if (this.isSlow()) return 'This is taking longer than usual. Check the terminal screen.';
      return 'Waiting for the customer. Ask the customer to present their card on the terminal.';
    }
    const result = this.outcome();
    return result ? `${result.title}. ${result.message}` : '';
  });

  readonly currencies = [
    { code: 'EUR', label: 'EUR (€)' },
    { code: 'USD', label: 'USD ($)' },
    { code: 'GBP', label: 'GBP (£)' }
  ];

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private paymentService = inject(PaymentService);
  private storeService = inject(StoreService);
  private confirm = inject(ConfirmService);
  private destroyRef = inject(DestroyRef);
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  /** Payment currently waiting on the terminal; its serviceId is what an abort targets. */
  private pendingRequest: PosPaymentRequest | null = null;

  readonly posForm = this.fb.group({
    storeId: ['', Validators.required],
    terminalId: [{ value: '', disabled: true }, Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currency: ['EUR', Validators.required],
    reference: [this.generateReference(), [Validators.required, Validators.maxLength(64)]]
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.stopTimer());
  }

  ngOnInit() {
    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadStores();
      }
    });

    this.posForm.controls.storeId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(storeId => {
      // A terminal belongs to a single store: never keep the previous store's terminal selected.
      this.posForm.controls.terminalId.reset('');
      this.posForm.controls.terminalId.disable();
      this.terminals.set([]);
      this.terminalsError.set(null);
      if (storeId) {
        this.loadTerminals(storeId);
      }
    });
  }

  loadStores(): void {
    this.loadingStores.set(true);
    this.storesError.set(null);
    this.storeService.getStores(this.userId).subscribe({
      next: (res) => {
        this.stores.set(res || []);
        this.loadingStores.set(false);
      },
      error: (err) => {
        this.storesError.set(httpErrorMessage(err, 'Unable to load stores. Try again.'));
        this.loadingStores.set(false);
      }
    });
  }

  loadTerminals(storeId: string): void {
    this.loadingTerminals.set(true);
    this.terminalsError.set(null);
    const terminalCtrl = this.posForm.controls.terminalId;
    terminalCtrl.disable();

    this.storeService.listTerminals(storeId).subscribe({
      next: (res) => {
        if (this.posForm.controls.storeId.value !== storeId) return;
        const list = res || [];
        this.terminals.set(list);
        if (!list.some(t => t.id === terminalCtrl.value)) {
          terminalCtrl.reset(list.length === 1 ? list[0].id : '');
        }
        if (list.length > 0) {
          terminalCtrl.enable();
        }
        this.loadingTerminals.set(false);
      },
      error: (err) => {
        if (this.posForm.controls.storeId.value !== storeId) return;
        this.terminalsError.set(httpErrorMessage(err, 'Unable to load terminals for this store.'));
        this.terminals.set([]);
        this.loadingTerminals.set(false);
      }
    });
  }

  retryTerminals(): void {
    const storeId = this.posForm.controls.storeId.value;
    if (storeId) this.loadTerminals(storeId);
  }

  terminalStatusLabel(status: string | null | undefined): string {
    if (!status) return '';
    return TERMINAL_STATUS_LABELS[status.toLowerCase()] ?? this.humanize(status).toLowerCase();
  }

  submitHint(): string {
    const c = this.posForm.controls;
    if (!c.storeId.value) return this.stores().length ? 'Select a store to continue.' : '';
    if (this.loadingTerminals()) return 'Loading terminals…';
    if (!this.terminals().length) return 'This store has no terminal assigned.';
    if (!c.terminalId.value) return 'Select a terminal to continue.';
    if (c.amount.hasError('required')) return 'Enter an amount to continue.';
    if (c.amount.hasError('min')) return 'The amount must be at least 0.01.';
    if (c.reference.hasError('required')) return 'Enter a transaction reference to continue.';
    if (c.reference.hasError('maxlength')) return 'The reference must be 64 characters or fewer.';
    return '';
  }

  showError(name: 'amount' | 'reference'): boolean {
    const c = this.posForm.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  onSubmit(): void {
    if (this.isPaying()) return;
    if (this.posForm.invalid) {
      this.posForm.markAllAsTouched();
      return;
    }

    const raw = this.posForm.getRawValue();
    const currency = raw.currency || 'EUR';
    this.startPayment({
      reference: (raw.reference || '').trim(),
      amount: toMinorUnits(Number(raw.amount), currency),
      currency,
      terminalId: raw.terminalId || ''
    });
  }

  formatAmount(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  terminalLabel(terminalId: string): string {
    const terminal = this.terminals().find(t => t.id === terminalId);
    return terminal ? `${terminal.model} · ${terminal.id}` : terminalId;
  }

  /** New payment on the same terminal: keeps store, terminal and currency. */
  resetPayment(): void {
    this.outcome.set(null);
    this.posForm.controls.amount.reset(null);
    this.posForm.controls.reference.reset(this.generateReference());
  }

  /** After a declined payment no money was taken, so the same payment can be sent again right away. */
  retryPayment(): void {
    const result = this.outcome();
    if (!result || this.isPaying()) return;
    this.resendPayment(result.request);
  }

  /** The first attempt may have been charged (timeout, unknown answer): ask before charging again. */
  async chargeAgain(): Promise<void> {
    const result = this.outcome();
    if (!result || this.isPaying()) return;
    const amount = this.formatAmount(result.request.amount, result.request.currency);
    const confirmed = await this.confirm.confirm({
      title: `Charge ${amount} again?`,
      message: 'If the first payment went through, the customer is charged twice. Check the terminal screen or the transactions list first.',
      details: [
        { label: 'Amount', value: amount },
        { label: 'First reference', value: result.request.reference },
        { label: 'Terminal', value: this.terminalLabel(result.request.terminalId) }
      ],
      confirmText: 'Charge again',
      cancelText: 'Cancel',
      danger: true
    });
    if (!confirmed || this.outcome() !== result || this.isPaying()) return;
    this.resendPayment(result.request);
  }

  /** Asks the terminal to stop waiting for the card; the pending payment then ends as cancelled. */
  cancelPayment(): void {
    const pending = this.pendingRequest;
    if (!pending?.serviceId || this.cancelling()) return;
    this.cancelling.set(true);
    this.abortError.set(null);
    this.paymentService.abortPosPayment({ terminalId: pending.terminalId, serviceId: pending.serviceId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // On success the button keeps showing "Cancelling…" until the terminal answers the payment.
        error: (err) => {
          if (this.pendingRequest !== pending) return;
          this.cancelling.set(false);
          this.abortError.set(httpErrorMessage(err, 'The cancel request did not reach the terminal.'));
        }
      });
  }

  /** Same amount, currency and terminal as the previous attempt, with a fresh reference so it is not rejected as a duplicate. */
  private resendPayment(previous: PosPaymentRequest): void {
    const reference = this.generateReference(previous.reference);
    this.posForm.controls.reference.setValue(reference);
    this.startPayment({
      reference,
      amount: previous.amount,
      currency: previous.currency,
      terminalId: previous.terminalId
    });
  }

  private startPayment(request: Omit<PosPaymentRequest, 'serviceId'>): void {
    const payload: PosPaymentRequest = { ...request, serviceId: this.generateServiceId() };

    this.pendingRequest = payload;
    this.cancelling.set(false);
    this.abortError.set(null);
    this.outcome.set(null);
    this.isPaying.set(true);
    this.startTimer();

    this.paymentService.makePosPayment(payload)
      .pipe(timeout(TERMINAL_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.finishPayment(this.toOutcome(res, payload)),
        error: (err) => {
          const timedOut = err instanceof TimeoutError;
          this.finishPayment({
            kind: 'error',
            title: timedOut ? 'No answer from the terminal' : 'Unable to reach the terminal',
            message: timedOut
              ? 'The terminal did not answer in time, so the payment may have gone through. Check the terminal screen or the transactions list before charging again.'
              : httpErrorMessage(err, 'The payment may not have reached the terminal. Check that the terminal is online and check its screen before charging again.'),
            request: payload,
            response: null,
            reason: ''
          });
        }
      });
  }

  private finishPayment(result: PosOutcome): void {
    this.stopTimer();
    this.pendingRequest = null;
    this.cancelling.set(false);
    this.abortError.set(null);
    this.outcome.set(result);
    this.isPaying.set(false);
  }

  private toOutcome(res: PosPaymentResponse, payload: PosPaymentRequest): PosOutcome {
    const base = {
      request: { ...payload, reference: res.reference || payload.reference },
      response: res,
      reason: this.readableReason(res)
    };
    switch (res.status) {
      case 'SUCCESS':
        return { ...base, kind: 'success', title: 'Payment approved', message: 'The customer can take their card.' };
      case 'FAILURE':
        if (CANCELLED_CONDITIONS.has((res.errorCondition || '').toLowerCase())) {
          return { ...base, kind: 'cancelled', title: 'Payment cancelled', message: 'No money was taken.', reason: '' };
        }
        return {
          ...base,
          kind: 'failure',
          title: 'Payment declined',
          message: 'No money was taken. Ask the customer for another card or try again.'
        };
      default:
        return {
          ...base,
          kind: 'error',
          title: 'Payment status unknown',
          message: 'The terminal returned an unexpected response, so the payment may have gone through. Check the terminal screen or the transactions list before charging again.'
        };
    }
  }

  /** additionalResponse is a URL-encoded key/value string; surface the human part only. */
  private readableReason(res: PosPaymentResponse): string {
    const raw = res.refusalReason || '';
    if (raw.includes('=')) {
      try {
        const params = new URLSearchParams(raw);
        const reason = params.get('refusalReason') || params.get('message') || params.get('errors');
        if (reason) return reason;
      } catch {
        // fall through to the raw value
      }
    }
    return raw || this.humanize(res.errorCondition);
  }

  private humanize(value: string | null | undefined): string {
    if (!value) return '';
    return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  }

  /** Time-based reference; a suffix keeps it distinct from a previous attempt made in the same second. */
  private generateReference(previous?: string): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const reference = `POS-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return reference === previous ? `${reference}-${this.generateServiceId().slice(0, 4)}` : reference;
  }

  private generateServiceId(): string {
    const bytes = new Uint8Array(SERVICE_ID_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => SERVICE_ID_ALPHABET[b % SERVICE_ID_ALPHABET.length]).join('');
  }

  private startTimer(): void {
    this.stopTimer();
    this.elapsedSeconds.set(0);
    const started = Date.now();
    this.elapsedTimer = setInterval(() => this.elapsedSeconds.set(Math.floor((Date.now() - started) / 1000)), 1000);
  }

  private stopTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }
}
