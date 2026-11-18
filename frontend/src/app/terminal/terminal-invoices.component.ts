import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject } from '@angular/core';
import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Invoice } from '../models';
import { formatMoney } from '../shared';
import { dueText } from '../invoices/invoice-view';
import { InvoiceNavigationState, TerminalStore } from './terminal-store';
import { Badge, INVOICE_FILTERS, InvoiceFilter, amountOf, badgeOf, filterInvoices, storeLabel } from './terminal-view';

interface InvoiceRow {
  id: number;
  name: string;
  amount: string;
  /** "INV-2026-0012 · Overdue by 3 days" */
  meta: string;
  overdue: boolean;
  badge: Badge;
}

function rowOf(invoice: Invoice): InvoiceRow {
  return {
    id: invoice.id,
    name: invoice.customer.displayName?.trim() || invoice.number,
    amount: formatMoney(amountOf(invoice), invoice.currency),
    meta: [invoice.number, dueText(invoice)].filter(Boolean).join(' · '),
    overdue: invoice.status === 'OVERDUE',
    badge: badgeOf(invoice),
  };
}

/** The invoices the terminal collects and refunds: the ones to collect first. */
@Component({
  selector: 'app-terminal-invoices',
  standalone: true,
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, RouterLink, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './terminal-invoices.component.html',
  styleUrls: ['./terminal.css', './terminal-invoices.component.css'],
})
export class TerminalInvoicesComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly store = inject(TerminalStore);

  readonly filters = INVOICE_FILTERS;
  readonly fromList: InvoiceNavigationState = { fromList: true };
  readonly title = computed(() => this.store.context()?.companyName?.trim() || 'Invoices');
  readonly storeText = computed(() => storeLabel(this.store.context()));
  readonly toCollect = computed(() => filterInvoices(this.store.invoices(), 'toCollect').length);
  readonly rows = computed(() => filterInvoices(this.store.invoices(), this.store.filter()).map(rowOf));

  @ViewChild('scroller') private scroller?: ElementRef<HTMLElement>;

  // Back from the payment screen of the terminal, which hid the page: the list shows what changed.
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') this.store.refresh();
  };

  ngOnInit(): void {
    // The first load, or back from an invoice.
    this.store.refresh();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngAfterViewInit(): void {
    if (this.store.loaded() && this.scroller) this.scroller.nativeElement.scrollTop = this.store.listScrollTop;
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  select(filter: InvoiceFilter): void {
    this.store.filter.set(filter);
    if (this.scroller) this.scroller.nativeElement.scrollTop = 0;
  }

  rememberScroll(): void {
    this.store.listScrollTop = this.scroller?.nativeElement.scrollTop ?? 0;
  }

  trackRow(_: number, row: InvoiceRow): number {
    return row.id;
  }
}
