import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TimeoutError, timeout } from 'rxjs';
import { MaterialModule } from '../material.module';
import { PosPaymentRequest, PosPaymentResponse, Store, TerminalResponse } from '../models';
import { PaymentService, StoreService } from '../services';
import { formatMoney, httpErrorMessage, toMinorUnits } from '../shared';

/** Terminal API sync requests can legitimately take up to ~2 minutes (card entry, PIN, 3DS on device). */
const TERMINAL_TIMEOUT_MS = 180_000;
const SLOW_TERMINAL_SECONDS = 45;

export interface PosOutcome {
  kind: 'success' | 'failure' | 'error';
  title: string;
  message: string;
  amount: number;
  currency: string;
  reference: string;
  response: PosPaymentResponse | null;
  reason: string;
}

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule
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

  readonly currencies = [
    { code: 'EUR', label: 'EUR (€)' },
    { code: 'USD', label: 'USD ($)' },
    { code: 'GBP', label: 'GBP (£)' }
  ];

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private paymentService = inject(PaymentService);
  private storeService = inject(StoreService);
  private destroyRef = inject(DestroyRef);
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

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
        this.storesError.set(httpErrorMessage(err, 'Could not load your stores.'));
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
        this.terminalsError.set(httpErrorMessage(err, 'Could not load the terminals for this store.'));
        this.terminals.set([]);
        this.loadingTerminals.set(false);
      }
    });
  }

  retryTerminals(): void {
    const storeId = this.posForm.controls.storeId.value;
    if (storeId) this.loadTerminals(storeId);
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
    const amount = toMinorUnits(Number(raw.amount), currency);
    const reference = (raw.reference || '').trim();

    const payload: PosPaymentRequest = {
      reference,
      amount,
      currency,
      terminalId: raw.terminalId || ''
    };

    this.isPaying.set(true);
    this.outcome.set(null);
    this.startTimer();

    this.paymentService.makePosPayment(payload).pipe(timeout(TERMINAL_TIMEOUT_MS)).subscribe({
      next: (res) => {
        this.stopTimer();
        this.outcome.set(this.toOutcome(res, payload));
        this.isPaying.set(false);
      },
      error: (err) => {
        this.stopTimer();
        const message = err instanceof TimeoutError
          ? 'The terminal did not answer in time. Check the terminal screen before trying again so the customer is not charged twice.'
          : httpErrorMessage(err, 'Could not reach the terminal. Check that it is online and try again.');
        this.outcome.set({
          kind: 'error',
          title: 'Terminal not reachable',
          message,
          amount: payload.amount,
          currency: payload.currency,
          reference: payload.reference,
          response: null,
          reason: ''
        });
        this.isPaying.set(false);
      }
    });
  }

  formatAmount(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  /** New payment on the same terminal: keeps store, terminal and currency. */
  resetPayment(): void {
    this.outcome.set(null);
    this.posForm.controls.amount.reset(null);
    this.posForm.controls.reference.reset(this.generateReference());
  }

  /** Retry the same payment with a fresh reference so it is not rejected as a duplicate. */
  retryPayment(): void {
    this.outcome.set(null);
    this.posForm.controls.reference.setValue(this.generateReference());
    this.onSubmit();
  }

  private toOutcome(res: PosPaymentResponse, payload: PosPaymentRequest): PosOutcome {
    const base = {
      amount: payload.amount,
      currency: payload.currency,
      reference: res.reference || payload.reference,
      response: res,
      reason: this.readableReason(res)
    };
    switch (res.status) {
      case 'SUCCESS':
        return { ...base, kind: 'success', title: 'Payment approved', message: 'The customer can take their card.' };
      case 'FAILURE':
        return {
          ...base,
          kind: 'failure',
          title: 'Payment declined',
          message: 'The payment was not approved. Ask the customer for another card or try again.'
        };
      default:
        return {
          ...base,
          kind: 'error',
          title: 'Payment status unknown',
          message: 'The terminal returned an unexpected response. Check the terminal and the Transactions page before trying again.'
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

  private generateReference(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `POS-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
