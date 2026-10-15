import { Component, OnDestroy, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import * as forge from 'node-forge';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { A11yModule } from '@angular/cdk/a11y';
import { firstValueFrom, forkJoin } from 'rxjs';
import { MaterialModule } from '../material.module';

import {
  User,
  CardResponse,
  TransactionRuleResponse,
  AddTransactionRuleRequest
} from '../models';
import { AccountService, IssuingService } from '../services';
import { ConfirmService, formatMoney, httpErrorMessage, toMinorUnits } from '../shared';
import { FormatCardNumberPipe } from './format-card-number.pipe';
import { MCC_CODES } from '../industry-codes';

type Mcc = { code: string; label: string; risky?: boolean };
type CardAction = 'suspend' | 'activate' | 'close';

const REVEAL_DURATION_MS = 30000;

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    MatMenuModule,
    MatAutocompleteModule,
    A11yModule,
    FormatCardNumberPipe
  ],
  templateUrl: './card-list.component.html',
  styleUrl: './card-list.component.css'
})
export class CardListComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private issuingService = inject(IssuingService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private confirmService = inject(ConfirmService);

  userId = '';
  user?: User;
  activeCards: CardResponse[] = [];
  suspendedCards: CardResponse[] = [];
  closedCards: CardResponse[] = [];
  closedCardsLoaded = false;
  closedCardsError: string | null = null;
  filteredActiveCards: CardResponse[] = [];
  filteredSuspendedCards: CardResponse[] = [];
  searchSuggestions: CardResponse[] = [];
  searchControl = new FormControl('');
  selectedCard?: CardResponse;
  isLoadingActive = true;
  loadError: string | null = null;
  isLoadingClosed = false;
  isRevealing = false;
  isAddingRule = false;
  showRulesPanel = false;
  isRefreshingRules = false;

  /** Card currently being updated, so its actions can show a spinner and be disabled. */
  busyCard: { id: string; action: CardAction } | null = null;
  busyRuleId: string | null = null;

  revealedCardId?: string;
  revealedData?: { pan: string; cvc: string; expiryMonth: string; expiryYear: string };
  private revealTimer?: ReturnType<typeof setTimeout>;
  private rulesPanelOpener: HTMLElement | null = null;

  allMccs: Mcc[] = MCC_CODES;
  selectedMccsForRule: Mcc[] = [];
  filteredMccs: Mcc[] = [];
  mccSearchControl = new FormControl('');

  ruleForm = this.fb.group({
    type: ['maxAmountPerTransaction', Validators.required],
    value: [null as number | null, [Validators.required, Validators.min(0.01)]]
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

    this.mccSearchControl.valueChanges.subscribe(value => {
      this.filterMccsForRule(typeof value === 'string' ? value : '');
    });
  }

  ngOnDestroy() {
    clearTimeout(this.revealTimer);
  }

  loadUser() {
    this.accountService.getUserById(this.userId).subscribe({
      next: (user) => {
        this.user = user;
        this.cdr.detectChanges();
      }
    });
  }

  loadActiveAndSuspended() {
    this.isLoadingActive = true;
    this.loadError = null;
    this.cdr.detectChanges();

    forkJoin({
      active: this.issuingService.getCards(this.userId, 'active'),
      suspended: this.issuingService.getCards(this.userId, 'suspended')
    }).subscribe({
      next: ({ active, suspended }) => {
        this.activeCards = active || [];
        this.suspendedCards = suspended || [];
        this.isLoadingActive = false;
        this.filterCards(this.searchControl.value || '');
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoadingActive = false;
        this.loadError = httpErrorMessage(err, "Couldn't load your cards. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  loadClosedCards() {
    this.isLoadingClosed = true;
    this.closedCardsError = null;
    this.cdr.detectChanges();
    this.issuingService.getCards(this.userId, 'closed').subscribe({
      next: (cards) => {
        this.closedCards = cards || [];
        this.closedCardsLoaded = true;
        this.isLoadingClosed = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoadingClosed = false;
        this.closedCardsError = httpErrorMessage(err, "Couldn't load closed cards. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  get hasAnyCard(): boolean {
    return this.activeCards.length > 0 || this.suspendedCards.length > 0 || this.closedCards.length > 0;
  }

  get hasSearchTerm(): boolean {
    return !!(this.searchControl.value || '').toString().trim();
  }

  filterCards(searchTerm: string) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredActiveCards = this.activeCards;
      this.filteredSuspendedCards = this.suspendedCards;
      this.searchSuggestions = [];
      return;
    }
    const matches = (c: CardResponse) =>
      !!c.cardholderName?.toLowerCase().includes(term) || !!c.lastFour?.includes(term);
    this.searchSuggestions = [...this.activeCards, ...this.suspendedCards].filter(matches);
    this.filteredActiveCards = this.activeCards.filter(matches);
    this.filteredSuspendedCards = this.suspendedCards.filter(matches);
  }

  onSearchSelect(event: MatAutocompleteSelectedEvent) {
    const card: CardResponse = event.option.value;
    this.searchControl.setValue(card.cardholderName, { emitEvent: false });
    this.filteredActiveCards = this.activeCards.filter(c => c.paymentInstrumentId === card.paymentInstrumentId);
    this.filteredSuspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId === card.paymentInstrumentId);
    this.searchSuggestions = [];
    this.selectedCard = card;
    this.hideRevealedData();
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

  viewTransactions() {
    this.router.navigate(['/', this.userId, 'card-transactions']);
  }

  isSelected(card: CardResponse): boolean {
    return this.selectedCard?.paymentInstrumentId === card.paymentInstrumentId;
  }

  isBusy(card: CardResponse, action?: CardAction): boolean {
    return this.busyCard?.id === card.paymentInstrumentId && (!action || this.busyCard.action === action);
  }

  selectCard(card: CardResponse) {
    if (card.status === 'closed') return;
    this.selectedCard = this.isSelected(card) ? undefined : card;
    this.hideRevealedData();
  }

  shortYear(year: unknown): string {
    return year === null || year === undefined ? '' : String(year).slice(-2);
  }

  brandLabel(card: CardResponse): string {
    return card.brand === 'visa' ? 'Visa' : card.brand === 'mc' ? 'Mastercard' : (card.brand || 'Card');
  }

  cardName(card: CardResponse): string {
    return `${this.brandLabel(card)} card ending ${card.lastFour}`;
  }

  async revealCardDetails(card: CardResponse) {
    if (this.revealedCardId === card.paymentInstrumentId) {
      this.hideRevealedData();
      return;
    }

    this.hideRevealedData();
    this.isRevealing = true;
    this.cdr.detectChanges();

    try {
      const { publicKey: publicKeyRaw } = await firstValueFrom(this.issuingService.getPublicKey('panReveal'));

      let publicKeyPem = publicKeyRaw;
      if (!publicKeyPem.includes('-----BEGIN')) {
        publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyPem}\n-----END PUBLIC KEY-----`;
      }

      // Adyen PAN reveal: a random AES-256 key, encrypted with Adyen's RSA key (PKCS1 v1.5), hex encoded.
      const aesKeyBytes = forge.random.getBytesSync(32);
      const rsaPublicKey = forge.pki.publicKeyFromPem(publicKeyPem);
      const encryptedAesKey = rsaPublicKey.encrypt(aesKeyBytes, 'RSAES-PKCS1-V1_5');
      const encryptedKeyHex = forge.util.bytesToHex(encryptedAesKey);

      const { encryptedData: encryptedDataHex } = await firstValueFrom(
        this.issuingService.revealCardData(card.paymentInstrumentId, encryptedKeyHex)
      );

      // The response is AES-256-CBC encrypted with a zero IV.
      const decipher = forge.cipher.createDecipher('AES-CBC', aesKeyBytes);
      decipher.start({ iv: forge.util.createBuffer('\0'.repeat(16)) });
      decipher.update(forge.util.createBuffer(forge.util.hexToBytes(encryptedDataHex)));
      if (!decipher.finish()) {
        throw new Error('AES decryption failed');
      }

      const parsedData = JSON.parse(decipher.output.toString());

      this.revealedCardId = card.paymentInstrumentId;
      this.revealedData = {
        pan: parsedData.pan,
        cvc: parsedData.cvc,
        expiryMonth: parsedData.expiration?.month,
        expiryYear: parsedData.expiration?.year
      };
      this.isRevealing = false;
      this.cdr.detectChanges();

      this.revealTimer = setTimeout(() => {
        if (this.revealedCardId === card.paymentInstrumentId) {
          this.hideRevealedData();
        }
      }, REVEAL_DURATION_MS);
    } catch (error) {
      this.isRevealing = false;
      this.showError(httpErrorMessage(error, "Couldn't reveal the card details. Try again."));
      this.cdr.detectChanges();
    }
  }

  hideRevealedData() {
    clearTimeout(this.revealTimer);
    this.revealedCardId = undefined;
    this.revealedData = undefined;
    this.cdr.detectChanges();
  }

  async copyCardNumber(card: CardResponse) {
    if (!this.revealedData?.pan) return;
    const expiry = `${this.revealedData.expiryMonth}/${this.revealedData.expiryYear?.toString().slice(-2)}`;
    const text = `${this.revealedData.pan}\t${expiry}\t${this.revealedData.cvc}\t${card.cardholderName}`;
    try {
      await navigator.clipboard.writeText(text);
      this.snack.open('Card details copied', 'Close', { duration: 2000, panelClass: 'fintech-snack-success' });
    } catch {
      this.showError("Couldn't copy to the clipboard. Copy the details manually.");
    }
  }

  suspendCard(card: CardResponse) {
    this.updateStatus(card, 'suspend', 'suspended', 'Card suspended', "Couldn't suspend the card. Try again.");
  }

  activateCard(card: CardResponse) {
    this.updateStatus(card, 'activate', 'active', 'Card reactivated', "Couldn't reactivate the card. Try again.");
  }

  async closeCard(card: CardResponse) {
    const confirmed = await this.confirmService.confirm({
      title: `Close card ending ${card.lastFour}?`,
      message: 'Closing a card is permanent. It can no longer be used or reactivated.',
      details: [
        { label: 'Card', value: `${this.brandLabel(card)} •••• ${card.lastFour}` },
        { label: 'Cardholder', value: card.cardholderName }
      ],
      confirmText: 'Close card',
      danger: true
    });
    if (!confirmed) return;
    this.updateStatus(card, 'close', 'closed', 'Card closed', "Couldn't close the card. Try again.");
  }

  private updateStatus(card: CardResponse, action: CardAction, status: string, successMessage: string, errorFallback: string) {
    if (this.busyCard) return;
    this.busyCard = { id: card.paymentInstrumentId, action };
    this.cdr.detectChanges();

    this.issuingService.updateCardStatus(card.paymentInstrumentId, status).subscribe({
      next: () => {
        const id = card.paymentInstrumentId;
        this.activeCards = this.activeCards.filter(c => c.paymentInstrumentId !== id);
        this.suspendedCards = this.suspendedCards.filter(c => c.paymentInstrumentId !== id);
        const updated = { ...card, status };
        if (status === 'active') this.activeCards = [...this.activeCards, updated];
        if (status === 'suspended') this.suspendedCards = [...this.suspendedCards, updated];
        if (status === 'closed') {
          if (this.closedCardsLoaded) this.closedCards = [...this.closedCards, updated];
          if (this.revealedCardId === id) this.hideRevealedData();
          if (this.selectedCard?.paymentInstrumentId === id) {
            this.closeRulesPanel();
            this.selectedCard = undefined;
          }
        } else if (this.selectedCard?.paymentInstrumentId === id) {
          this.selectedCard = updated;
        }
        this.busyCard = null;
        this.filterCards(this.searchControl.value || '');
        this.snack.open(successMessage, 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyCard = null;
        this.showError(httpErrorMessage(err, errorFallback));
        this.cdr.detectChanges();
      }
    });
  }

  openRulesPanel(card: CardResponse, event?: Event) {
    this.rulesPanelOpener = (event?.currentTarget as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    this.selectedCard = card;
    this.resetRuleForm();
    this.showRulesPanel = true;
    this.cdr.detectChanges();
  }

  onRulesPanelKeydown(event: KeyboardEvent) {
    // Open autocomplete panels consume Escape first (they call preventDefault).
    if (event.key === 'Escape' && !event.defaultPrevented) {
      this.closeRulesPanel();
    }
  }

  closeRulesPanel() {
    if (!this.showRulesPanel) return;
    this.showRulesPanel = false;
    this.cdr.detectChanges();
    const opener = this.rulesPanelOpener;
    this.rulesPanelOpener = null;
    if (opener?.isConnected) opener.focus();
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
      case 'maxAmountPerTransaction': return 'Maximum amount per transaction';
      case 'maxTotalAmount': return 'Total spending limit';
      case 'blockedMccs': return 'Blocked merchant categories';
      default: return type;
    }
  }

  ruleAmount(rule: TransactionRuleResponse): string {
    return formatMoney(rule.value ?? 0, rule.currencyCode);
  }

  getMccLabel(code: string): string {
    const mcc = this.allMccs.find(m => m.code === code);
    return mcc ? mcc.label : code;
  }

  get ruleCurrency(): string {
    return this.user?.currencyCode || '';
  }

  get isCountRule(): boolean {
    return this.ruleForm.value.type === 'maxTransactions';
  }

  /** Explains why the add-rule button is disabled. */
  get ruleHint(): string | null {
    if (this.ruleForm.value.type === 'blockedMccs') {
      return this.selectedMccsForRule.length ? null : 'Select at least one merchant category to block.';
    }
    const value = this.ruleForm.get('value');
    if (value?.hasError('required')) {
      return this.isCountRule ? 'Enter the maximum number of transactions.' : 'Enter a limit amount.';
    }
    if (value?.hasError('min') || value?.hasError('pattern')) {
      return this.isCountRule ? 'Enter a whole number of at least 1.' : 'The amount must be at least 0.01.';
    }
    return null;
  }

  addRule() {
    if (!this.selectedCard || this.isAddingRule) return;

    const type = this.ruleForm.value.type!;
    let request: AddTransactionRuleRequest;

    if (type === 'blockedMccs') {
      if (this.selectedMccsForRule.length === 0) return;
      request = {
        paymentInstrumentId: this.selectedCard.paymentInstrumentId,
        type: 'blockedMccs',
        blockedMccs: this.selectedMccsForRule.map(m => m.code)
      };
    } else {
      if (this.ruleForm.invalid) {
        this.ruleForm.markAllAsTouched();
        return;
      }
      const rawValue = Number(this.ruleForm.value.value);
      request = {
        paymentInstrumentId: this.selectedCard.paymentInstrumentId,
        type,
        value: type === 'maxTransactions' ? Math.round(rawValue) : toMinorUnits(rawValue, this.user?.currencyCode),
        currencyCode: this.user?.currencyCode
      };
    }

    this.isAddingRule = true;
    this.cdr.detectChanges();
    this.issuingService.addTransactionRule(request).subscribe({
      next: () => {
        this.snack.open('Rule added', 'Close', { duration: 3000, panelClass: 'fintech-snack-success' });
        this.isAddingRule = false;
        this.resetRuleForm(type);
        this.refreshCardRules();
      },
      error: (err) => {
        this.isAddingRule = false;
        this.showError(httpErrorMessage(err, "Couldn't add the rule. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  toggleRuleStatus(rule: TransactionRuleResponse) {
    if (this.busyRuleId) return;
    const newStatus = rule.status === 'active' ? 'inactive' : 'active';
    this.busyRuleId = rule.id;
    this.cdr.detectChanges();
    this.issuingService.updateTransactionRule(rule.id, newStatus).subscribe({
      next: () => {
        rule.status = newStatus;
        this.busyRuleId = null;
        this.snack.open(newStatus === 'active' ? 'Rule enabled' : 'Rule disabled', 'Close', { duration: 2000, panelClass: 'fintech-snack-success' });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyRuleId = null;
        this.showError(httpErrorMessage(err, "Couldn't update the rule. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  async deleteRule(rule: TransactionRuleResponse) {
    if (this.busyRuleId) return;
    const value = rule.type === 'maxTransactions'
      ? `${rule.value} transactions`
      : rule.type === 'blockedMccs'
        ? (rule.blockedMccs || []).join(', ')
        : this.ruleAmount(rule);
    const confirmed = await this.confirmService.confirm({
      title: 'Delete this rule?',
      message: 'The card will no longer be restricted by this rule.',
      details: [
        { label: 'Rule', value: this.getRuleName(rule.type) },
        { label: 'Value', value },
        ...(this.selectedCard ? [{ label: 'Card', value: `•••• ${this.selectedCard.lastFour}` }] : [])
      ],
      confirmText: 'Delete rule',
      danger: true
    });
    if (!confirmed) return;

    this.busyRuleId = rule.id;
    this.cdr.detectChanges();
    this.issuingService.deleteTransactionRule(rule.id).subscribe({
      next: () => {
        this.busyRuleId = null;
        this.snack.open('Rule deleted', 'Close', { duration: 2000, panelClass: 'fintech-snack-success' });
        this.refreshCardRules();
      },
      error: (err) => {
        this.busyRuleId = null;
        this.showError(httpErrorMessage(err, "Couldn't delete the rule. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  refreshCardRules() {
    if (!this.selectedCard) return;

    this.isRefreshingRules = true;
    this.cdr.detectChanges();
    this.issuingService.getCardDetails(this.selectedCard.paymentInstrumentId).subscribe({
      next: (card) => {
        this.isRefreshingRules = false;
        this.selectedCard = card;
        const replace = (list: CardResponse[]) =>
          list.map(c => c.paymentInstrumentId === card.paymentInstrumentId ? card : c);
        this.activeCards = replace(this.activeCards);
        this.suspendedCards = replace(this.suspendedCards);
        this.filterCards(this.searchControl.value || '');
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isRefreshingRules = false;
        this.showError(httpErrorMessage(err, "Couldn't refresh the card rules. Try again."));
        this.cdr.detectChanges();
      }
    });
  }

  onRuleTypeChange() {
    this.resetRuleForm(this.ruleForm.value.type || 'maxAmountPerTransaction');
  }

  private resetRuleForm(type: string = 'maxAmountPerTransaction') {
    const value = this.ruleForm.get('value')!;
    value.setValidators(type === 'maxTransactions'
      ? [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]
      : [Validators.required, Validators.min(0.01)]);
    this.ruleForm.reset({ type, value: null });
    this.selectedMccsForRule = [];
    this.mccSearchControl.setValue('', { emitEvent: false });
    this.filterMccsForRule('');
  }

  filterMccsForRule(searchTerm: string) {
    const term = searchTerm.toLowerCase();
    this.filteredMccs = this.allMccs.filter(
      mcc => !this.selectedMccsForRule.some(s => s.code === mcc.code) &&
        (!term || mcc.code.toLowerCase().includes(term) || mcc.label.toLowerCase().includes(term))
    );
  }

  addMccToRule(event: MatAutocompleteSelectedEvent) {
    const mcc: Mcc = event.option.value;
    if (!this.selectedMccsForRule.some(s => s.code === mcc.code)) {
      this.selectedMccsForRule = [...this.selectedMccsForRule, mcc];
    }
    this.mccSearchControl.setValue('');
    this.filterMccsForRule('');
    this.cdr.detectChanges();
  }

  removeMccFromRule(mcc: Mcc) {
    this.selectedMccsForRule = this.selectedMccsForRule.filter(s => s.code !== mcc.code);
    this.filterMccsForRule(this.mccSearchControl.value || '');
    this.cdr.detectChanges();
  }

  private showError(message: string) {
    this.snack.open(message, 'Close', { duration: 5000, panelClass: 'fintech-snack-error' });
  }
}
