import { Component, OnDestroy, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import * as forge from 'node-forge';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatMenuModule } from '@angular/material/menu';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { A11yModule } from '@angular/cdk/a11y';
import { firstValueFrom, forkJoin } from 'rxjs';
import { MaterialModule } from '../material.module';

import {
  CardResponse,
  TransactionRuleResponse,
  AddTransactionRuleRequest
} from '../models';
import { IssuingService } from '../services';
import { ConfirmService, InlineAlertComponent, NotifyService, formatMoney, httpErrorMessage, toMinorUnits } from '../shared';
import { FormatCardNumberPipe } from './format-card-number.pipe';
import { MCC_CODES } from '../industry-codes';

type Mcc = { code: string; label: string; risky?: boolean };
type CardAction = 'suspend' | 'activate' | 'close';
type PageError = { title: string; message: string; retry?: () => void };

const STATUS_LABELS: Record<string, string> = { active: 'Active', suspended: 'Suspended', closed: 'Closed' };

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
    RouterLink,
    InlineAlertComponent,
    FormatCardNumberPipe
  ],
  templateUrl: './card-list.component.html',
  styleUrl: './card-list.component.css'
})
export class CardListComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private issuingService = inject(IssuingService);
  private notify = inject(NotifyService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private confirmService = inject(ConfirmService);

  userId = '';
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

  /** A failed card action, shown under the card it is about. */
  cardError: (PageError & { id: string }) | null = null;
  /** A failed rule update or refresh, shown at the top of the rules panel. */
  rulesError: PageError | null = null;
  addRuleError: string | null = null;

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
        this.loadError = httpErrorMessage(err, "The cards couldn't be loaded. Try again.");
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
        this.closedCardsError = httpErrorMessage(err, "The closed cards couldn't be loaded. Try again.");
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

  statusLabel(status: string | undefined): string {
    return STATUS_LABELS[status || ''] ?? 'Unknown status';
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
    this.cardError = null;
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
      this.showCardError(card, 'Unable to reveal the card details', httpErrorMessage(error, "The card details couldn't be revealed. Try again."), () => this.revealCardDetails(card));
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
      this.notify.success('Card details copied');
    } catch {
      this.showCardError(card, 'Unable to copy the card details', 'The clipboard is not available. Copy the details from the card manually.');
    }
  }

  /** Suspending is reversible, so it is confirmed with an Undo action rather than a dialog. */
  suspendCard(card: CardResponse) {
    this.updateStatus(card, 'suspend', 'suspended', "The card couldn't be suspended. Try again.", updated => {
      this.notify.undoable(`Card ending ${card.lastFour} suspended`, () => this.activateCard(updated));
    });
  }

  activateCard(card: CardResponse) {
    this.updateStatus(card, 'activate', 'active', "The card couldn't be reactivated. Try again.", () => {
      this.notify.success(`Card ending ${card.lastFour} reactivated`);
    });
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
      cancelText: 'Cancel',
      danger: true
    });
    if (!confirmed) return;
    this.updateStatus(card, 'close', 'closed', "The card couldn't be closed. Try again.", () => {
      this.notify.success(`Card ending ${card.lastFour} closed`);
    });
  }

  private updateStatus(card: CardResponse, action: CardAction, status: string, errorFallback: string,
                       onSuccess: (updated: CardResponse) => void) {
    if (this.busyCard) return;
    this.busyCard = { id: card.paymentInstrumentId, action };
    if (this.cardError?.id === card.paymentInstrumentId) this.cardError = null;
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
        onSuccess(updated);
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyCard = null;
        const titles: Record<CardAction, string> = {
          suspend: 'Unable to suspend the card',
          activate: 'Unable to reactivate the card',
          close: 'Unable to close the card'
        };
        const retry = action === 'close' ? undefined : () => this.updateStatus(card, action, status, errorFallback, onSuccess);
        this.showCardError(card, titles[action], httpErrorMessage(err, errorFallback), retry);
        this.cdr.detectChanges();
      }
    });
  }

  openRulesPanel(card: CardResponse, event?: Event) {
    this.rulesPanelOpener = (event?.currentTarget as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    this.selectedCard = card;
    this.resetRuleForm();
    this.rulesError = null;
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
    return this.selectedCard?.currencyCode || '';
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
        value: type === 'maxTransactions' ? Math.round(rawValue) : toMinorUnits(rawValue, this.ruleCurrency),
        currencyCode: this.ruleCurrency || undefined
      };
    }

    this.isAddingRule = true;
    this.addRuleError = null;
    this.cdr.detectChanges();
    this.issuingService.addTransactionRule(request).subscribe({
      next: () => {
        this.notify.success('Rule added');
        this.isAddingRule = false;
        this.resetRuleForm(type);
        this.refreshCardRules();
      },
      error: (err) => {
        this.isAddingRule = false;
        this.addRuleError = httpErrorMessage(err, "The rule couldn't be added. Check the value and try again.");
        this.cdr.detectChanges();
      }
    });
  }

  toggleRuleStatus(rule: TransactionRuleResponse) {
    if (this.busyRuleId) return;
    const newStatus = rule.status === 'active' ? 'inactive' : 'active';
    this.busyRuleId = rule.id;
    this.rulesError = null;
    this.cdr.detectChanges();
    this.issuingService.updateTransactionRule(rule.id, newStatus).subscribe({
      next: () => {
        rule.status = newStatus;
        this.busyRuleId = null;
        this.notify.success(newStatus === 'active' ? 'Rule enabled' : 'Rule disabled');
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyRuleId = null;
        this.rulesError = {
          title: 'Unable to update the rule',
          message: httpErrorMessage(err, "The rule couldn't be updated. Try again."),
          retry: () => this.toggleRuleStatus(rule)
        };
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
      cancelText: 'Cancel',
      danger: true
    });
    if (!confirmed) return;

    this.busyRuleId = rule.id;
    this.rulesError = null;
    this.cdr.detectChanges();
    this.issuingService.deleteTransactionRule(rule.id).subscribe({
      next: () => {
        this.busyRuleId = null;
        this.notify.success('Rule deleted');
        this.refreshCardRules();
      },
      error: (err) => {
        this.busyRuleId = null;
        this.rulesError = {
          title: 'Unable to delete the rule',
          message: httpErrorMessage(err, "The rule couldn't be deleted. Try again.")
        };
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
        this.rulesError = {
          title: 'Unable to refresh the rules',
          message: httpErrorMessage(err, "The card rules couldn't be refreshed. Try again."),
          retry: () => this.refreshCardRules()
        };
        this.cdr.detectChanges();
      }
    });
  }

  onRuleTypeChange() {
    this.resetRuleForm(this.ruleForm.value.type || 'maxAmountPerTransaction');
  }

  private resetRuleForm(type: string = 'maxAmountPerTransaction') {
    this.addRuleError = null;
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

  retryCardError() {
    const retry = this.cardError?.retry;
    this.cardError = null;
    retry?.();
  }

  retryRulesError() {
    const retry = this.rulesError?.retry;
    this.rulesError = null;
    retry?.();
  }

  private showCardError(card: CardResponse, title: string, message: string, retry?: () => void) {
    this.cardError = { id: card.paymentInstrumentId, title, message, retry };
  }
}
