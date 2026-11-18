import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, timeout } from 'rxjs';
import { Invoice, TerminalContext } from '../models';
import { TerminalAppService } from '../services';
import { InvoiceFilter, TerminalSession, apiError } from './terminal-view';

/** The calls that don't wait for the terminal. The hosted backend can take up to a minute to wake up. */
export const LOAD_TIMEOUT_MS = 75_000;
/** After this, the backend is probably waking up. */
const SLOW_START_MS = 8_000;

/** Set on the way from the list to an invoice: going back to the list is then going back in the history. */
export interface InvoiceNavigationState {
  fromList?: boolean;
}

/** What the terminal app calls on the page. */
export interface TerminalPageBridge {
  /** The back button: true when the page handled it, false to let the app go back. */
  back(): boolean;
}

declare global {
  interface Window {
    terminalPage?: TerminalPageBridge;
  }
}

/** The terminal the page runs for, its store, and the invoices it collects. Shared by the pages of the terminal. */
@Injectable()
export class TerminalStore implements OnDestroy {
  private readonly api = inject(TerminalAppService);

  session: TerminalSession = { terminalId: null, apiBase: '', inApp: false };

  /** The store of the terminal, once the backend recognized it: the invoices can open. */
  readonly context = signal<TerminalContext | null>(null);
  readonly identifying = signal(false);
  readonly identifyError = signal<string | null>(null);
  readonly slowStart = signal(false);

  readonly invoices = signal<Invoice[]>([]);
  readonly filter = signal<InvoiceFilter>('toCollect');
  /** The invoices were loaded once: a failed refresh keeps them. */
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  /** Where the list was scrolled when an invoice opened. */
  listScrollTop = 0;

  /** Asked first when the back button of the terminal app is pressed: true when the page handled it. */
  backHandler: (() => boolean) | null = null;

  private identifySub?: Subscription;
  private listSub?: Subscription;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  start(session: TerminalSession): void {
    this.session = session;
    this.identify();
  }

  identify(): void {
    const { apiBase, terminalId, inApp } = this.session;
    if (!terminalId || this.identifying()) return;
    this.identifying.set(true);
    this.identifyError.set(null);
    this.slowStart.set(false);
    this.clearSlowTimer();
    this.slowTimer = setTimeout(() => this.slowStart.set(true), SLOW_START_MS);
    this.identifySub = this.api.getContext(apiBase, terminalId).pipe(timeout(LOAD_TIMEOUT_MS)).subscribe({
      next: context => {
        this.clearSlowTimer();
        this.context.set(context);
        this.identifying.set(false);
      },
      error: err => {
        this.clearSlowTimer();
        this.identifying.set(false);
        this.identifyError.set(apiError(err, inApp).message);
      },
    });
  }

  refresh(): void {
    const { apiBase, terminalId, inApp } = this.session;
    if (!terminalId || this.loading()) return;
    this.loading.set(true);
    this.listError.set(null);
    this.listSub = this.api.getInvoices(apiBase, terminalId).pipe(timeout(LOAD_TIMEOUT_MS)).subscribe({
      next: invoices => {
        this.invoices.set(invoices ?? []);
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.listError.set(apiError(err, inApp).message);
      },
    });
  }

  /** The invoice as the backend last sent it, in place of the one the list holds. */
  update(invoice: Invoice): void {
    this.invoices.update(list => list.map(item => (item.id === invoice.id ? invoice : item)));
  }

  ngOnDestroy(): void {
    this.identifySub?.unsubscribe();
    this.listSub?.unsubscribe();
    this.clearSlowTimer();
  }

  private clearSlowTimer(): void {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }
}
