import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule } from '@angular/material/dialog';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MaterialModule } from '../material.module';

import {
  User,
  CardResponse,
  TransactionRuleResponse,
  AddTransactionRuleRequest
} from '../models';
import { AccountService, IssuingService } from '../services';
import { FormatCardNumberPipe } from './format-card-number.pipe';
import { MCC_CODES } from '../industry-codes';

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    MatMenuModule,
    MatDialogModule,
    MatAutocompleteModule,
    FormatCardNumberPipe
  ],
  templateUrl: './card-list.component.html',
  styleUrl: './card-list.component.css'
})
export class CardListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private issuingService = inject(IssuingService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user?: User;
  activeCards: CardResponse[] = [];
  suspendedCards: CardResponse[] = [];
  closedCards: CardResponse[] = [];
  closedCardsLoaded = false;
  filteredActiveCards: CardResponse[] = [];
  filteredSuspendedCards: CardResponse[] = [];
  searchSuggestions: CardResponse[] = [];
  searchControl = new FormControl('');
  selectedCard?: CardResponse;
  isLoadingActive = true;
  isLoadingClosed = false;
  isRevealing = false;
  isAddingRule = false;
  showRulesPanel = false;

  revealedCardId?: string;
  revealedData?: { pan: string; cvc: string; expiryMonth: string; expiryYear: string };

  allMccs = MCC_CODES;
  selectedMccsForRule: { code: string; label: string; risky?: boolean }[] = [];
  filteredMccs: { code: string; label: string; risky?: boolean }[] = [];
  mccSearchControl = new FormControl('');

  ruleForm = this.fb.group({
    type: ['maxAmountPerTransaction', Validators.required],
    value: [null as number | null, [Validators.required, Validators.min(1)]]
  });

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
        this.loadActiveAndSuspended();
      }
    });

    this.searchControl.valueChanges.subscribe(value => {
      this.filterCards(typeof value === 'string' ? value : '');
    });
  }

  loadUser() {
    this.accountService.getUserById(Number(this.userId)).subscribe({
      next: (user) => {
        this.user = user;
        this.cdr.detectChanges();
      }
    });
  }

  loadActiveAndSuspended() {
    this.isLoadingActive = true;
    let loaded = 0;
    const onLoaded = () => {
      loaded++;
      if (loaded >= 2) {
        this.isLoadingActive = false;
        this.filterCards('');
        this.cdr.detectChanges();
      }
    };

    this.issuingService.getCards(Number(this.userId), 'active').subscribe({
      next: (cards) => {
        this.activeCards = cards;
        this.filteredActiveCards = cards;
        this.cdr.detectChanges();
        onLoaded();
      },
      error: () => {
        this.snack.open('Failed to load active cards', 'Close', { duration: 3000 });
        onLoaded();
      }
    });

    this.issuingService.getCards(Number(this.userId), 'suspended').subscribe({
      next: (cards) => {
        this.suspendedCards = cards;
        this.filteredSuspendedCards = cards;
        this.cdr.detectChanges();
        onLoaded();
      },
      error: () => {
        this.snack.open('Failed to load suspended cards', 'Close', { duration: 3000 });
        onLoaded();
      }
    });
  }

  loadClosedCards() {
    this.isLoadingClosed = true;
    this.cdr.detectChanges();
    this.issuingService.getCards(Number(this.userId), 'closed').subscribe({
      next: (cards) => {
        this.closedCards = cards;
        this.closedCardsLoaded = true;
        this.isLoadingClosed = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingClosed = false;
        this.closedCardsLoaded = true;
        this.snack.open('Failed to load closed cards', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  filterCards(searchTerm: string) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredActiveCards = this.activeCards;
      this.filteredSuspendedCards = this.suspendedCards;
      this.searchSuggestions = [];
      return;
    }
    const allCards = [...this.activeCards, ...this.suspendedCards];
    this.searchSuggestions = allCards.filter(c =>
      c.cardholderName?.toLowerCase().includes(term)
    );
    this.filteredActiveCards = this.activeCards.filter(c =>
      c.cardholderName?.toLowerCase().includes(term)
    );
    this.filteredSuspendedCards = this.suspendedCards.filter(c =>
      c.cardholderName?.toLowerCase().includes(term)
    );
  }

  onSearchSelect(event: any) {
    const card: CardResponse = event.option.value;
    this.searchControl.setValue(card.cardholderName, { emitEvent: false });
    this.filteredActiveCards = this.activeCards.filter(c => c.paymentInstrumentId === card.paymentInstrumentId);
    this.filteredSuspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId === card.paymentInstrumentId);
    this.searchSuggestions = [];
    this.selectCard(card);
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchControl.setValue('');
    this.filteredActiveCards = this.activeCards;
    this.filteredSuspendedCards = this.suspendedCards;
    this.searchSuggestions = [];
    this.cdr.detectChanges();
  }

  navigateToCreate() {
    this.router.navigate(['/', this.userId, 'card-create']);
  }

  selectCard(card: CardResponse) {
    if (this.selectedCard?.paymentInstrumentId === card.paymentInstrumentId) {
      this.selectedCard = undefined;
      this.hideRevealedData();
    } else {
      this.selectedCard = card;
      this.hideRevealedData();
    }
  }

  async revealCardDetails(card: CardResponse) {
    if (this.revealedCardId === card.paymentInstrumentId) {
      this.hideRevealedData();
      return;
    }

    this.isRevealing = true;
    this.cdr.detectChanges();

    try {
      // All crypto is now handled server-side
      const { cardData } = await this.issuingService.revealCardData(card.paymentInstrumentId).toPromise() as { cardData: string };

      // Parse the decrypted JSON data
      const parsedData = JSON.parse(cardData);

      // Map Adyen response fields to our expected format
      this.revealedCardId = card.paymentInstrumentId;
      this.revealedData = {
        pan: parsedData.pan,
        cvc: parsedData.cvc,
        expiryMonth: parsedData.expiration?.month,
        expiryYear: parsedData.expiration?.year
      };
      this.isRevealing = false;
      this.cdr.detectChanges();

      // Auto-hide after 30 seconds
      setTimeout(() => {
        if (this.revealedCardId === card.paymentInstrumentId) {
          this.hideRevealedData();
        }
      }, 30000);

    } catch (error) {
      this.isRevealing = false;
      this.snack.open('Failed to reveal card details', 'Close', { duration: 3000 });
      this.cdr.detectChanges();
    }
  }

  hideRevealedData() {
    this.revealedCardId = undefined;
    this.revealedData = undefined;
    this.cdr.detectChanges();
  }

  copyCardNumber(card: CardResponse) {
    if (this.revealedData?.pan) {
      navigator.clipboard.writeText(this.revealedData.pan);
      this.snack.open('Card number copied', 'Close', { duration: 2000 });
    }
  }

  suspendCard(card: CardResponse) {
    this.issuingService.updateCardStatus(card.paymentInstrumentId, 'suspended').subscribe({
      next: () => {
        this.activeCards = this.activeCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
        card.status = 'suspended';
        this.suspendedCards.push(card);
        this.filterCards(this.searchControl.value || '');
        this.snack.open('Card suspended', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to suspend card', 'Close', { duration: 3000 });
      }
    });
  }

  activateCard(card: CardResponse) {
    this.issuingService.updateCardStatus(card.paymentInstrumentId, 'active').subscribe({
      next: () => {
        this.suspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
        card.status = 'active';
        this.activeCards.push(card);
        this.filterCards(this.searchControl.value || '');
        this.snack.open('Card reactivated', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to reactivate card', 'Close', { duration: 3000 });
      }
    });
  }

  closeCard(card: CardResponse) {
    if (confirm('Are you sure you want to close this card? This action cannot be undone.')) {
      this.issuingService.updateCardStatus(card.paymentInstrumentId, 'closed').subscribe({
        next: () => {
          this.activeCards = this.activeCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
          this.suspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId !== card.paymentInstrumentId);
          card.status = 'closed';
          if (this.closedCardsLoaded) {
            this.closedCards.push(card);
          }
          this.filterCards(this.searchControl.value || '');
          this.snack.open('Card closed', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        },
        error: () => {
          this.snack.open('Failed to close card', 'Close', { duration: 3000 });
        }
      });
    }
  }

  openRulesPanel(card: CardResponse) {
    this.selectedCard = card;
    this.showRulesPanel = true;
    this.cdr.detectChanges();
  }

  closeRulesPanel() {
    this.showRulesPanel = false;
    this.cdr.detectChanges();
  }

  getRuleIcon(type: string): string {
    switch (type) {
      case 'maxTransactions': return 'pin';
      case 'maxAmountPerTransaction': return 'payments';
      case 'maxTotalAmount': return 'account_balance_wallet';
      case 'blockedMccs': return 'block';
      default: return 'rule';
    }
  }

  getRuleName(type: string): string {
    switch (type) {
      case 'maxTransactions': return 'Transaction limit';
      case 'maxAmountPerTransaction': return 'Max amount per transaction';
      case 'maxTotalAmount': return 'Total spending limit';
      case 'blockedMccs': return 'Blocked merchant categories';
      default: return type;
    }
  }

  getMccLabel(code: string): string {
    const mcc = this.allMccs.find(m => m.code === code);
    return mcc ? mcc.label : code;
  }

  addRule() {
    if (!this.selectedCard) return;

    const type = this.ruleForm.value.type!;

    // Handle MCC rule separately
    if (type === 'blockedMccs') {
      if (this.selectedMccsForRule.length === 0) return;

      this.isAddingRule = true;
      const request: AddTransactionRuleRequest = {
        paymentInstrumentId: this.selectedCard.paymentInstrumentId,
        type: 'blockedMccs',
        blockedMccs: this.selectedMccsForRule.map(m => m.code)
      };

      this.issuingService.addTransactionRule(request).subscribe({
        next: () => {
          this.snack.open('MCC block rule added successfully', 'Close', { duration: 3000 });
          this.selectedMccsForRule = [];
          this.mccSearchControl.setValue('');
          this.isAddingRule = false;
          this.refreshCardRules();
        },
        error: () => {
          this.isAddingRule = false;
          this.snack.open('Failed to add rule', 'Close', { duration: 3000 });
          this.cdr.detectChanges();
        }
      });
      return;
    }

    // Handle other rules
    if (this.ruleForm.invalid) return;

    this.isAddingRule = true;
    const rawValue = this.ruleForm.value.value!;
    // Convert to minor units for amount-based rules (multiply by 100)
    const value = type === 'maxTransactions' ? rawValue : Math.round(rawValue * 100);

    const request: AddTransactionRuleRequest = {
      paymentInstrumentId: this.selectedCard.paymentInstrumentId,
      type: type,
      value: value,
      currencyCode: this.user?.currencyCode
    };

    this.issuingService.addTransactionRule(request).subscribe({
      next: () => {
        this.snack.open('Rule added successfully', 'Close', { duration: 3000 });
        this.ruleForm.reset({ type: 'maxAmountPerTransaction' });
        this.isAddingRule = false;
        this.refreshCardRules();
      },
      error: () => {
        this.isAddingRule = false;
        this.snack.open('Failed to add rule', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  toggleRuleStatus(rule: TransactionRuleResponse) {
    const newStatus = rule.status === 'active' ? 'inactive' : 'active';
    this.issuingService.updateTransactionRule(rule.id, newStatus).subscribe({
      next: () => {
        rule.status = newStatus;
        this.snack.open('Rule updated', 'Close', { duration: 2000 });
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to update rule', 'Close', { duration: 3000 });
      }
    });
  }

  deleteRule(rule: TransactionRuleResponse) {
    if (confirm('Delete this rule?')) {
      this.issuingService.deleteTransactionRule(rule.id).subscribe({
        next: () => {
          this.snack.open('Rule deleted', 'Close', { duration: 2000 });
          this.refreshCardRules();
        },
        error: () => {
          this.snack.open('Failed to delete rule', 'Close', { duration: 3000 });
        }
      });
    }
  }

  refreshCardRules() {
    if (!this.selectedCard) return;

    this.issuingService.getCardDetails(this.selectedCard.paymentInstrumentId).subscribe({
      next: (card) => {
        this.selectedCard = card;
        const activeIndex = this.activeCards.findIndex(c => c.paymentInstrumentId === card.paymentInstrumentId);
        if (activeIndex >= 0) this.activeCards[activeIndex] = card;
        const suspIndex = this.suspendedCards.findIndex(c => c.paymentInstrumentId === card.paymentInstrumentId);
        if (suspIndex >= 0) this.suspendedCards[suspIndex] = card;
        this.filterCards(this.searchControl.value || '');
        this.cdr.detectChanges();
      }
    });
  }

  onRuleTypeChange() {
    if (this.ruleForm.value.type === 'blockedMccs') {
      this.filteredMccs = this.allMccs;
      this.mccSearchControl.valueChanges.subscribe(value => {
        this.filterMccsForRule(value || '');
      });
    }
    this.selectedMccsForRule = [];
  }

  filterMccsForRule(searchTerm: string) {
    if (!searchTerm) {
      this.filteredMccs = this.allMccs.filter(
        mcc => !this.selectedMccsForRule.some(s => s.code === mcc.code)
      );
      return;
    }
    const term = searchTerm.toLowerCase();
    this.filteredMccs = this.allMccs.filter(
      mcc => !this.selectedMccsForRule.some(s => s.code === mcc.code) &&
        (mcc.code.toLowerCase().includes(term) || mcc.label.toLowerCase().includes(term))
    );
  }

  addMccToRule(event: any) {
    const mcc = event.option.value;
    if (!this.selectedMccsForRule.some(s => s.code === mcc.code)) {
      this.selectedMccsForRule.push(mcc);
    }
    this.mccSearchControl.setValue('');
    this.filterMccsForRule('');
    this.cdr.detectChanges();
  }

  removeMccFromRule(mcc: { code: string; label: string; risky?: boolean }) {
    this.selectedMccsForRule = this.selectedMccsForRule.filter(s => s.code !== mcc.code);
    this.filterMccsForRule(this.mccSearchControl.value || '');
    this.cdr.detectChanges();
  }
}
