import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';

import {
  CardResponse,
  CardTransfer
} from '../models';
import { IssuingService } from '../services';
import { MCC_CODES } from '../industry-codes';

@Component({
  selector: 'app-card-transactions',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule
  ],
  templateUrl: './card-transactions.component.html',
  styleUrl: './card-transactions.component.css'
})
export class CardTransactionsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private issuingService = inject(IssuingService);
  private snack = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  cards: CardResponse[] = [];
  transfers: CardTransfer[] = [];
  selectedPaymentInstrumentId = '';
  selectedTransfer?: CardTransfer;
  isLoading = false;
  isLoadingCards = false;
  cardDropdownOpen = false;

  allMccs = MCC_CODES;

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
    this.issuingService.getCards(Number(this.userId)).subscribe({
      next: (cards) => {
        this.cards = cards;
        this.isLoadingCards = false;
        if (this.cards.length > 0 && !this.selectedPaymentInstrumentId) {
          this.selectedPaymentInstrumentId = this.cards[0].paymentInstrumentId;
        }
        this.loadTransfers();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingCards = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadTransfers() {
    this.isLoading = true;
    this.cdr.detectChanges();

    if (!this.selectedPaymentInstrumentId) {
      this.isLoading = false;
      this.transfers = [];
      this.cdr.detectChanges();
      return;
    }

    const piId = this.selectedPaymentInstrumentId;

    this.issuingService.getCardTransfers(Number(this.userId), piId).subscribe({
      next: (transfers) => {
        this.transfers = transfers;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.transfers = [];
        this.isLoading = false;
        this.snack.open('Failed to load card transactions', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  getSelectedCard(): CardResponse | undefined {
    return this.cards.find(c => c.paymentInstrumentId === this.selectedPaymentInstrumentId);
  }

  toggleCardDropdown() {
    this.cardDropdownOpen = !this.cardDropdownOpen;
  }

  selectCardFilter(piId: string) {
    this.selectedPaymentInstrumentId = piId;
    this.cardDropdownOpen = false;
    this.loadTransfers();
  }

  onCardFilterChange() {
    this.loadTransfers();
  }

  refresh() {
    this.loadTransfers();
  }

  openDetail(transfer: CardTransfer) {
    this.selectedTransfer = transfer;
    this.cdr.detectChanges();
  }

  closeDetail() {
    this.selectedTransfer = undefined;
    this.cdr.detectChanges();
  }

  getMccLabel(code: string): string {
    const mcc = this.allMccs.find(m => m.code === code);
    return mcc ? mcc.label : code;
  }

  formatAmount(minorUnits: number): string {
    const abs = Math.abs(minorUnits);
    return (abs / 100).toFixed(2);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return dateStr;
    }
  }

  formatReason(reason: string): string {
    if (!reason) return '';
    return reason.replace(/([A-Z])/g, ' $1').trim();
  }

  formatValidationType(type: string): string {
    if (!type) return '';
    return type.replace(/([A-Z])/g, ' $1').trim();
  }

  getInvalidFacts(facts: any[]): any[] {
    return facts ? facts.filter(f => f.result === 'invalid') : [];
  }

  formatLocation(city?: string, country?: string): string {
    return [city, country].filter(Boolean).join(', ');
  }

  // Helper used in template for array filtering
  filter(arr: any[], fn: (x: any) => boolean): any[] {
    return arr ? arr.filter(fn) : [];
  }
}
