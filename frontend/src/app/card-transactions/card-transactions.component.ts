import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { MaterialModule } from '../material.module';

import {
  CardResponse,
  CardTransfer,
  CardTransferValidationFact
} from '../models';
import { IssuingService } from '../services';
import { formatMoney, httpErrorMessage } from '../shared';
import { MCC_CODES } from '../industry-codes';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = { ...DATE_FORMAT, hour: '2-digit', minute: '2-digit' };

@Component({
  selector: 'app-card-transactions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    A11yModule,
    MaterialModule
  ],
  templateUrl: './card-transactions.component.html',
  styleUrl: './card-transactions.component.css'
})
export class CardTransactionsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private issuingService = inject(IssuingService);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  cards: CardResponse[] = [];
  transfers: CardTransfer[] = [];
  selectedPaymentInstrumentId = '';
  selectedTransfer?: CardTransfer;
  isLoading = false;
  isLoadingCards = false;
  cardsError: string | null = null;
  transfersError: string | null = null;

  private detailOpener: HTMLElement | null = null;

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadCards();
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
        this.cardsError = httpErrorMessage(err, "Couldn't load your cards. Try again.");
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
        this.transfersError = httpErrorMessage(err, "Couldn't load the card transactions. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  getSelectedCard(): CardResponse | undefined {
    return this.cards.find(c => c.paymentInstrumentId === this.selectedPaymentInstrumentId);
  }

  cardOptionLabel(card: CardResponse): string {
    const brand = card.brand === 'visa' ? 'Visa' : card.brand === 'mc' ? 'Mastercard' : card.brand;
    return `${card.cardholderName} · ${brand} •••• ${card.lastFour} (${card.status})`;
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
  }

  navigateToCreate() {
    this.router.navigate(['/', this.userId, 'card-create']);
  }

  openDetail(transfer: CardTransfer, event?: Event) {
    this.detailOpener = (event?.currentTarget as HTMLElement | null) ?? null;
    this.selectedTransfer = transfer;
    this.cdr.detectChanges();
  }

  closeDetail() {
    this.selectedTransfer = undefined;
    this.cdr.detectChanges();
    const opener = this.detailOpener;
    this.detailOpener = null;
    if (opener?.isConnected) opener.focus();
  }

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

  formatDateTime(dateStr: string): string {
    return this.formatWith(dateStr, DATE_TIME_FORMAT);
  }

  private formatWith(dateStr: string, options: Intl.DateTimeFormatOptions): string {
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
