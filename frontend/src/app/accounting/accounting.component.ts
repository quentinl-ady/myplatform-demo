import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Subscription, of, switchMap } from 'rxjs';
import { MaterialModule } from '../material.module';
import { AccountStatement, Ledger, LedgerEntry, LedgerPayout, LedgerPendingMovement } from '../models';
import { AccountService, DemoDataService, LedgerService, demoDataSummary } from '../services';
import {
  InlineAlertComponent, MoneyPipe, NotifyService, StatementFormat, blobHttpErrorMessage, formatDate, formatDateTime,
  formatMoney, httpErrorMessage, saveFile, statementDownloadLabel, statementFileName, statementPeriod
} from '../shared';
import {
  JournalFilter, PERIODS, balanceText, chartRows, creditsOf, debitsOf, journalName, kindView, matchesFilter,
  matchesQuery, payoutCheck, payoutExplanation, pendingStatusLabel, plural, statusView
} from './ledger-view';

type StatementsState = 'idle' | 'loading' | 'ready' | 'noBank' | 'error';

const DEFAULT_DAYS = 30;
const EXPORTS_TAB = 2;

@Component({
  selector: 'app-accounting',
  standalone: true,
  imports: [CommonModule, RouterLink, MaterialModule, MoneyPipe, InlineAlertComponent],
  templateUrl: './accounting.component.html',
  styleUrl: './accounting.component.css'
})
export class AccountingComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private ledgerService = inject(LedgerService);
  private accountService = inject(AccountService);
  private demoDataService = inject(DemoDataService);
  private notify = inject(NotifyService);
  private liveAnnouncer = inject(LiveAnnouncer);
  private destroyRef = inject(DestroyRef);

  readonly periods = PERIODS;
  readonly maxDays = PERIODS[PERIODS.length - 1];
  userId = '';
  readonly days = signal<number>(DEFAULT_DAYS);
  readonly ledger = signal<Ledger | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly tab = signal(0);

  readonly filter = signal<JournalFilter>('all');
  readonly query = signal('');
  readonly expandedEntryId = signal<string | null>(null);
  readonly expandedPayoutId = signal<string | null>(null);

  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);

  readonly statements = signal<AccountStatement[]>([]);
  readonly statementsState = signal<StatementsState>('idle');
  readonly downloading = signal<{ fileName: string; format: StatementFormat } | null>(null);
  readonly statementError = signal<{ fileName: string; message: string } | null>(null);

  readonly loadingDemo = signal(false);
  readonly demoError = signal<string | null>(null);
  readonly demoWarnings = signal<string[]>([]);

  readonly balanceText = balanceText;
  readonly creditsOf = creditsOf;
  readonly debitsOf = debitsOf;
  readonly journalName = journalName;
  readonly kindView = kindView;
  readonly payoutCheck = payoutCheck;
  readonly payoutExplanation = payoutExplanation;
  readonly pendingStatusLabel = pendingStatusLabel;
  readonly plural = plural;
  readonly statementDownloadLabel = statementDownloadLabel;
  readonly statementPeriod = statementPeriod;
  readonly statusView = statusView;

  readonly entries = computed(() => this.ledger()?.entries ?? []);
  readonly payouts = computed(() => this.ledger()?.payouts ?? []);
  readonly pending = computed(() => this.ledger()?.pending ?? []);
  readonly counts = computed(() => {
    const entries = this.entries();
    return {
      sales: entries.filter(entry => entry.journal === 'SAL').length,
      purchases: entries.filter(entry => entry.journal === 'PUR').length,
      bank: entries.filter(entry => entry.journal === 'BNK').length,
      toReview: entries.filter(entry => entry.status === 'TO_REVIEW').length,
    };
  });
  readonly visibleEntries = computed(() => {
    const filter = this.filter();
    const query = this.query();
    return this.entries().filter(entry => matchesFilter(entry, filter) && matchesQuery(entry, query));
  });
  /** The movements not booked yet are bank movements: they don't belong under the invoices, the bills or a search. */
  readonly showPending = computed(() =>
    this.pending().length > 0 && (this.filter() === 'all' || this.filter() === 'BNK') && !this.query().trim());
  readonly chart = computed(() => {
    const ledger = this.ledger();
    return ledger ? chartRows(ledger) : [];
  });
  readonly periodLabel = computed(() => {
    const ledger = this.ledger();
    return ledger ? `${formatDate(ledger.from)} – ${formatDate(ledger.to)}` : '';
  });

  private loadSub?: Subscription;
  private statementsSub?: Subscription;
  /** Set by the actions of the user, so that a screen reader hears what the new journal has. */
  private announceLoad = false;

  ngOnInit(): void {
    this.route.parent?.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('id') || '';
      this.reset();
      if (this.userId) this.load();
    });
    this.destroyRef.onDestroy(() => {
      this.loadSub?.unsubscribe();
      this.statementsSub?.unsubscribe();
    });
  }

  /** The journal is built again from Adyen: the current one stays on screen until the new one arrives. */
  load(): void {
    if (!this.userId) return;
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(null);
    this.loadSub = this.ledgerService.getLedger(this.userId, this.days()).subscribe({
      next: ledger => {
        this.ledger.set(ledger);
        this.loading.set(false);
        if (!ledger.entries.some(entry => entry.id === this.expandedEntryId())) this.expandedEntryId.set(null);
        if (!ledger.payouts.some(payout => payout.transferId === this.expandedPayoutId())) this.expandedPayoutId.set(null);
        if (this.announceLoad) {
          this.announceLoad = false;
          this.liveAnnouncer.announce(
            `Journal updated: ${plural(ledger.summary.entries, 'entry', 'entries')} from ${this.periodLabel()}.`);
        }
      },
      error: err => {
        this.announceLoad = false;
        this.ledger.set(null);
        this.loadError.set(httpErrorMessage(err, 'Unable to build the journal. Try again.'));
        this.loading.set(false);
      }
    });
  }

  refresh(): void {
    this.announceLoad = true;
    this.load();
    if (this.tab() === EXPORTS_TAB) this.loadStatements();
  }

  setDays(days: number): void {
    if (days === this.days() && this.ledger()) return;
    this.days.set(days);
    this.announceLoad = true;
    this.load();
  }

  private reset(): void {
    this.loadSub?.unsubscribe();
    this.statementsSub?.unsubscribe();
    this.ledger.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.tab.set(0);
    this.filter.set('all');
    this.query.set('');
    this.expandedEntryId.set(null);
    this.expandedPayoutId.set(null);
    this.exportError.set(null);
    this.statements.set([]);
    this.statementsState.set('idle');
    this.statementError.set(null);
    this.demoError.set(null);
    this.demoWarnings.set([]);
  }

  onTabChange(index: number): void {
    this.tab.set(index);
    if (index === EXPORTS_TAB && this.statementsState() === 'idle') this.loadStatements();
  }

  // ---------- Journal ----------

  setFilter(filter: JournalFilter): void {
    this.filter.set(filter);
  }

  showToReview(): void {
    this.tab.set(0);
    this.query.set('');
    this.filter.set('TO_REVIEW');
  }

  clearFilters(): void {
    this.filter.set('all');
    this.query.set('');
  }

  toggleEntry(entry: LedgerEntry, event?: Event): void {
    if (this.endsTextSelection(event)) return;
    this.expandedEntryId.set(this.expandedEntryId() === entry.id ? null : entry.id);
  }

  togglePayout(payout: LedgerPayout, event?: Event): void {
    if (this.endsTextSelection(event)) return;
    this.expandedPayoutId.set(this.expandedPayoutId() === payout.transferId ? null : payout.transferId);
  }

  /** A click that ends a text selection, e.g. to copy a reference, leaves the row as it is. */
  private endsTextSelection(event?: Event): boolean {
    event?.preventDefault();
    const selection = window.getSelection();
    return event?.type === 'click' && !!selection && selection.toString().length > 0;
  }

  // ---------- Exports ----------

  exportCsv(): void {
    const ledger = this.ledger();
    if (!ledger || this.exporting() || this.loading()) return;
    this.exporting.set(true);
    this.exportError.set(null);
    this.ledgerService.exportJournal(this.userId, this.days()).subscribe({
      next: blob => {
        this.exporting.set(false);
        saveFile(blob, `journal-${ledger.from}-to-${ledger.to}.csv`);
        this.notify.success(`Journal exported: ${plural(ledger.summary.entries, 'entry', 'entries')} from ${this.periodLabel()}.`);
      },
      error: async err => {
        const message = await blobHttpErrorMessage(err, 'Unable to export the journal. Try again.');
        this.exporting.set(false);
        this.exportError.set(message);
      }
    });
  }

  /** The statements come with the business bank account. */
  loadStatements(): void {
    if (!this.userId) return;
    const userId = this.userId;
    this.statementsSub?.unsubscribe();
    if (this.statementsState() !== 'ready') this.statementsState.set('loading');
    this.statementsSub = this.accountService.getUserById(userId).pipe(
      switchMap(user => user.bank ? this.accountService.getStatements(userId) : of(null))
    ).subscribe({
      next: statements => {
        this.statements.set(statements ?? []);
        this.statementsState.set(statements ? 'ready' : 'noBank');
      },
      error: () => {
        // A failed refresh keeps the statements already listed.
        if (this.statementsState() !== 'ready') this.statementsState.set('error');
      }
    });
  }

  downloadStatement(statement: AccountStatement, format: StatementFormat): void {
    if (this.downloading()) return;
    this.downloading.set({ fileName: statement.fileName, format });
    this.statementError.set(null);
    const download = format === 'xml'
      ? this.accountService.downloadStatementXml(this.userId, statement.fileName)
      : this.accountService.downloadStatement(this.userId, statement.fileName);
    download.subscribe({
      next: blob => {
        this.downloading.set(null);
        saveFile(blob, statementFileName(statement, format));
      },
      error: async err => {
        const message = await blobHttpErrorMessage(err, "The statement couldn't be downloaded. Try again.");
        this.downloading.set(null);
        this.statementError.set({ fileName: statement.fileName, message });
      }
    });
  }

  isDownloading(statement: AccountStatement, format: StatementFormat): boolean {
    const downloading = this.downloading();
    return !!downloading && downloading.fileName === statement.fileName && downloading.format === format;
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
        this.announceLoad = true;
        this.load();
      },
      error: err => {
        this.loadingDemo.set(false);
        this.demoError.set(httpErrorMessage(err, 'Unable to load the demo data. Try again.'));
      }
    });
  }

  // ---------- View ----------

  entriesHint(ledger: Ledger): string {
    const { sales, purchases } = this.counts();
    const parts = [plural(sales, 'invoice entry', 'invoice entries')];
    if (purchases) parts.push(plural(purchases, 'bill'));
    parts.push(plural(ledger.summary.movements, 'movement'));
    return parts.join(', ');
  }

  /** A card payment that doesn't pay a bill: its expense category is chosen in Card transactions. */
  isCardExpense(entry: LedgerEntry): boolean {
    return entry.kind === 'CARD' && !entry.billId;
  }

  matchHint(ledger: Ledger): string {
    const { movements, matched } = ledger.summary;
    if (!ledger.movementsLoaded) return 'Movements not loaded';
    return movements ? `${matched} of ${plural(movements, 'movement')}` : 'No movements in the period';
  }

  matchTone(ledger: Ledger): string | null {
    const { movements, toReview } = ledger.summary;
    if (!movements) return null;
    return toReview ? 'warning' : 'success';
  }

  /** "€1,234.56 on each side", per currency. */
  balanceHint(ledger: Ledger): string {
    const { balanced, totals } = ledger.summary;
    if (!totals.length) return 'No entries in the period';
    if (!balanced) return 'An entry has more debits than credits, or the reverse';
    return `${totals.map(total => formatMoney(total.debit, total.currency)).join(' · ')} on each side`;
  }

  date(value: string | null | undefined): string {
    return formatDate(value);
  }

  dateTime(value: string | null | undefined): string {
    return formatDateTime(value);
  }

  trackEntry(_: number, entry: LedgerEntry): string {
    return entry.id;
  }

  trackPayout(_: number, payout: LedgerPayout): string {
    return payout.transferId;
  }

  trackPending(_: number, movement: LedgerPendingMovement): string {
    return movement.transferId;
  }

  trackStatement(_: number, statement: AccountStatement): string {
    return statement.fileName;
  }
}
