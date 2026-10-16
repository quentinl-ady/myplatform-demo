import { Component, ElementRef, OnInit, ViewChild, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { forkJoin } from 'rxjs';
import { MaterialModule } from '../material.module';

import {
  User,
  BalanceAccount,
  CardResponse,
  CreateCardRequest,
  TransactionRuleRequest,
  PhonePrefix
} from '../models';
import { AccountService, IssuingService } from '../services';
import { formatMoney, httpErrorMessage, toMinorUnits } from '../shared';
import { MCC_CODES } from '../industry-codes';

type Mcc = { code: string; label: string; risky?: boolean };

const MAX_SPENDING_RULES = 3;

@Component({
  selector: 'app-card-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule,
    MatAutocompleteModule
  ],
  templateUrl: './card-create.component.html',
  styleUrl: './card-create.component.css'
})
export class CardCreateComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private issuingService = inject(IssuingService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('successTitle') private successTitle?: ElementRef<HTMLElement>;

  readonly maxSpendingRules = MAX_SPENDING_RULES;

  userId = '';
  user?: User;
  isLoading = true;
  loadError: string | null = null;
  isProcessing = false;
  isSuccess = false;
  createdCard?: CardResponse;
  createdRules: TransactionRuleRequest[] = [];

  balanceAccounts: BalanceAccount[] = [];
  phonePrefixes: PhonePrefix[] = [];
  allMccs: Mcc[] = MCC_CODES;
  selectedMccs: Mcc[] = [];
  filteredMccs: Mcc[] = [];
  mccSearchControl = new FormControl('');

  form = this.fb.group({
    balanceAccountId: ['', Validators.required],
    cardholderName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/\S/)]],
    brand: ['visa', Validators.required],
    email: ['', [Validators.email]],
    phonePrefix: ['+31'],
    phoneNumber: ['', [Validators.pattern(/^[\d\s\-()]+$/)]],
    rules: this.fb.array<FormGroup>([])
  });

  get rulesArray() {
    return this.form.get('rules') as FormArray<FormGroup>;
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadData();
      }
    });

    this.mccSearchControl.valueChanges.subscribe(value => {
      this.filterMccs(typeof value === 'string' ? value : '');
    });
    this.filteredMccs = this.allMccs;

    this.issuingService.getPhonePrefixes().subscribe({
      next: (prefixes) => this.phonePrefixes = prefixes,
      error: () => this.phonePrefixes = [{ code: '+31', country: 'Netherlands', flag: '🇳🇱' }]
    });
  }

  loadData() {
    this.isLoading = true;
    this.loadError = null;
    forkJoin({
      user: this.accountService.getUserById(this.userId),
      accounts: this.accountService.getBalanceAccounts(this.userId)
    }).subscribe({
      next: ({ user, accounts }) => {
        this.user = user;
        this.balanceAccounts = accounts || [];
        if (user.email && !this.form.value.email) {
          this.form.patchValue({ email: user.email });
        }
        if (this.balanceAccounts.length === 1) {
          this.form.patchValue({ balanceAccountId: this.balanceAccounts[0].balanceAccountId });
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        this.loadError = httpErrorMessage(err, "Couldn't load your account details. Try again.");
        this.cdr.detectChanges();
      }
    });
  }

  /** The card spends in the default currency of the selected balance account. */
  get currency(): string {
    const id = this.form.value.balanceAccountId;
    return this.balanceAccounts.find(ba => ba.balanceAccountId === id)?.currencyCode || '';
  }

  get brandLabel(): string {
    return this.form.value.brand === 'mc' ? 'Mastercard' : 'Visa';
  }

  filterMccs(searchTerm: string) {
    const term = searchTerm.toLowerCase();
    this.filteredMccs = this.allMccs.filter(
      mcc => !this.selectedMccs.some(s => s.code === mcc.code) &&
        (!term || mcc.code.toLowerCase().includes(term) || mcc.label.toLowerCase().includes(term))
    );
  }

  addMcc(event: MatAutocompleteSelectedEvent) {
    const mcc: Mcc = event.option.value;
    if (!this.selectedMccs.some(s => s.code === mcc.code)) {
      this.selectedMccs = [...this.selectedMccs, mcc];
    }
    this.mccSearchControl.setValue('');
    this.filterMccs('');
    this.cdr.detectChanges();
  }

  removeMcc(mcc: Mcc) {
    this.selectedMccs = this.selectedMccs.filter(s => s.code !== mcc.code);
    this.filterMccs(this.mccSearchControl.value || '');
    this.cdr.detectChanges();
  }

  selectBrand(brand: string) {
    this.form.patchValue({ brand });
  }

  addRule() {
    if (this.rulesArray.length >= MAX_SPENDING_RULES) return;
    const ruleGroup = this.fb.group({
      type: ['maxAmountPerTransaction', Validators.required],
      value: [null as number | null, this.ruleValidators('maxAmountPerTransaction')]
    });
    ruleGroup.get('type')!.valueChanges.subscribe(type => {
      const value = ruleGroup.get('value')!;
      value.setValidators(this.ruleValidators(type || ''));
      value.updateValueAndValidity();
    });
    this.rulesArray.push(ruleGroup);
  }

  private ruleValidators(type: string) {
    return type === 'maxTransactions'
      ? [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]
      : [Validators.required, Validators.min(0.01)];
  }

  removeRule(index: number) {
    this.rulesArray.removeAt(index);
  }

  ruleTypeLabel(type: string): string {
    switch (type) {
      case 'maxTransactions': return 'Transaction limit';
      case 'maxAmountPerTransaction': return 'Maximum amount per transaction';
      case 'maxTotalAmount': return 'Total spending limit';
      case 'blockedMccs': return 'Blocked merchant categories';
      default: return type;
    }
  }

  ruleValueLabel(rule: TransactionRuleRequest): string {
    if (rule.type === 'maxTransactions') return `${rule.value} transactions`;
    if (rule.type === 'blockedMccs') return (rule.blockedMccs || []).join(', ');
    return formatMoney(rule.value ?? 0, rule.currencyCode);
  }

  ruleError(rule: FormGroup): string | null {
    const value = rule.get('value');
    if (!value || !value.invalid || !value.touched) return null;
    if (rule.value.type === 'maxTransactions') {
      return value.hasError('required') ? 'Enter a number of transactions.' : 'Enter a whole number of at least 1.';
    }
    return value.hasError('required') ? 'Enter an amount.' : 'The amount must be at least 0.01.';
  }

  /** Explains why the submit button is disabled. */
  get submitHint(): string | null {
    const f = this.form;
    if (!this.balanceAccounts.length) return 'You need a balance account to issue a card.';
    if (f.get('balanceAccountId')?.invalid) return 'Select a balance account.';
    if (f.get('cardholderName')?.invalid) return 'Enter the cardholder name (at least 2 characters).';
    if (f.get('email')?.invalid) return 'Enter a valid email address or leave it empty.';
    if (f.get('phoneNumber')?.invalid) return 'Enter a valid phone number or leave it empty.';
    if (this.rulesArray.invalid) return 'Complete or remove the spending limits.';
    return null;
  }

  submit() {
    if (this.form.invalid || !this.user || this.isProcessing) {
      this.form.markAllAsTouched();
      return;
    }

    const rules: TransactionRuleRequest[] = this.rulesArray.controls.map(group => {
      const type: string = group.value.type;
      const raw = Number(group.value.value);
      return {
        type,
        value: type === 'maxTransactions' ? Math.round(raw) : toMinorUnits(raw, this.currency),
        currencyCode: this.currency || undefined
      };
    });

    if (this.selectedMccs.length > 0) {
      rules.push({
        type: 'blockedMccs',
        blockedMccs: this.selectedMccs.map(m => m.code)
      });
    }

    const email = this.form.value.email?.trim() || undefined;
    const phoneNumber = this.form.value.phoneNumber?.trim();
    const phone = phoneNumber ? `${this.form.value.phonePrefix} ${phoneNumber}` : undefined;

    const request: CreateCardRequest = {
      userId: this.userId,
      balanceAccountId: this.form.value.balanceAccountId!,
      cardholderName: this.form.value.cardholderName!.trim(),
      brand: this.form.value.brand!,
      email,
      phone,
      transactionRules: rules.length > 0 ? rules : undefined
    };

    this.isProcessing = true;
    this.issuingService.createCard(request).subscribe({
      next: (card) => {
        this.createdCard = card;
        this.createdRules = rules;
        this.isSuccess = true;
        this.isProcessing = false;
        this.cdr.detectChanges();
        this.successTitle?.nativeElement.focus();
      },
      error: (err) => {
        this.isProcessing = false;
        this.snack.open(httpErrorMessage(err, "Couldn't create the card. Try again."), 'Close', {
          duration: 5000,
          panelClass: 'fintech-snack-error'
        });
        this.cdr.detectChanges();
      }
    });
  }

  createAnother() {
    this.isSuccess = false;
    this.createdCard = undefined;
    this.createdRules = [];
    this.rulesArray.clear();
    this.form.reset({
      balanceAccountId: this.balanceAccounts.length === 1 ? this.balanceAccounts[0].balanceAccountId : '',
      brand: 'visa',
      cardholderName: '',
      email: this.user?.email || '',
      phonePrefix: '+31',
      phoneNumber: ''
    });
    this.selectedMccs = [];
    this.filterMccs('');
  }

  viewCards() {
    this.router.navigate(['/', this.userId, 'cards']);
  }

  viewCardTransactions() {
    this.router.navigate(['/', this.userId, 'card-transactions']);
  }
}
