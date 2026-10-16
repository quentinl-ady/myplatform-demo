import { Component, ElementRef, OnInit, ViewChild, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MaterialModule } from '../material.module';

import {
  User,
  BalanceAccount,
  CardNetworkOption,
  CardResponse,
  CreateCardRequest,
  TransactionRuleRequest
} from '../models';
import { AccountService, IssuingService } from '../services';
import { formatMoney, httpErrorMessage, toMinorUnits } from '../shared';
// Imported directly, not through the shared barrel, so the country list stays in this page's lazy chunk.
import {
  PHONE_COUNTRIES,
  ParsedPhoneNumber,
  PhoneCountry,
  findPhoneCountry,
  mobileNumberValidator,
  parsePhoneNumber,
  tidyPhoneNumber,
  toE164
} from '../shared/phone';
import { MCC_CODES } from '../industry-codes';

type Mcc = { code: string; label: string; risky?: boolean };

const MAX_SPENDING_RULES = 3;
const CARD_BRANDS = ['visa', 'mc'];
/** Used when the account holder's country isn't in the phone country list. */
const DEFAULT_PHONE_COUNTRY = 'NL';

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
  /** null when unknown: every network stays selectable and the backend checks the choice. */
  cardNetworks: CardNetworkOption[] | null = null;
  readonly phoneCountries = PHONE_COUNTRIES;
  allMccs: Mcc[] = MCC_CODES;
  selectedMccs: Mcc[] = [];
  filteredMccs: Mcc[] = [];
  mccSearchControl = new FormControl('');

  form = this.fb.group({
    balanceAccountId: ['', Validators.required],
    cardholderName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/\S/)]],
    brand: ['visa', Validators.required],
    email: ['', [Validators.email]],
    phoneCountry: [DEFAULT_PHONE_COUNTRY],
    phoneNumber: ['', [mobileNumberValidator('phoneCountry')]],
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

    // form.value still holds the previous account while the control emits, hence the emitted id.
    this.form.get('balanceAccountId')!.valueChanges.subscribe(id => {
      this.ensureConfiguredBrand(this.currencyOf(id || ''));
    });

    this.form.get('phoneCountry')!.valueChanges.subscribe(() => {
      this.form.get('phoneNumber')!.updateValueAndValidity();
    });
  }

  loadData() {
    this.isLoading = true;
    this.loadError = null;
    forkJoin({
      user: this.accountService.getUserById(this.userId),
      accounts: this.accountService.getBalanceAccounts(this.userId),
      networks: this.issuingService.getCardNetworks().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ user, accounts, networks }) => {
        this.user = user;
        this.balanceAccounts = accounts || [];
        this.cardNetworks = networks;
        if (user.email && !this.form.value.email) {
          this.form.patchValue({ email: user.email });
        }
        if (this.form.get('phoneCountry')!.pristine) {
          this.form.patchValue({ phoneCountry: this.defaultPhoneCountry });
        }
        if (this.balanceAccounts.length === 1) {
          this.form.patchValue({ balanceAccountId: this.balanceAccounts[0].balanceAccountId });
        }
        this.ensureConfiguredBrand();
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
    return this.currencyOf(this.form.value.balanceAccountId || '');
  }

  private currencyOf(balanceAccountId: string): string {
    return this.balanceAccounts.find(ba => ba.balanceAccountId === balanceAccountId)?.currencyCode || '';
  }

  get brandLabel(): string {
    return this.form.value.brand === 'mc' ? 'Mastercard' : 'Visa';
  }

  /** Whether the platform has a card range for this network in the currency (in any currency when none is given). */
  isBrandConfigured(brand: string, currency = this.currency): boolean {
    if (!this.cardNetworks) return true;
    const network = this.cardNetworks.find(n => n.brand === brand);
    return !!network && (!currency || !network.currencies || network.currencies.includes(currency));
  }

  hasConfiguredBrand(currency: string): boolean {
    return CARD_BRANDS.some(brand => this.isBrandConfigured(brand, currency));
  }

  brandNote(brand: string): string | null {
    if (this.isBrandConfigured(brand)) return null;
    const onPlatform = this.cardNetworks?.some(n => n.brand === brand);
    return onPlatform && this.currency ? `Not configured for ${this.currency}` : 'Not configured';
  }

  private ensureConfiguredBrand(currency = this.currency) {
    if (this.isBrandConfigured(this.form.get('brand')!.value || '', currency)) return;
    const brand = CARD_BRANDS.find(b => this.isBrandConfigured(b, currency));
    if (brand) {
      this.form.patchValue({ brand });
    }
  }

  /** The account holder's country, so most cardholders don't have to change it. */
  private get defaultPhoneCountry(): string {
    return findPhoneCountry(this.user?.countryCode)?.code ?? DEFAULT_PHONE_COUNTRY;
  }

  get selectedPhoneCountry(): PhoneCountry {
    return findPhoneCountry(this.form.value.phoneCountry) ?? findPhoneCountry(DEFAULT_PHONE_COUNTRY)!;
  }

  get phoneError(): string | null {
    const control = this.form.get('phoneNumber')!;
    const parsed: ParsedPhoneNumber | undefined = control.errors?.['mobileNumber'];
    if (!parsed || !control.touched) return null;
    if (parsed.error === 'characters') return 'Use digits only. Spaces, dashes and brackets are fine.';
    if (parsed.error === 'countryCode') return 'Unknown country code. Choose the country from the list.';
    const { lengths, dialCode } = parsed.country;
    if (lengths) return `Enter ${lengths.join(' or ')} digits after +${dialCode}.`;
    return parsed.error === 'tooShort' ? 'This number is too short.' : 'This number is too long.';
  }

  onPhonePaste() {
    // Runs once the pasted text is in the field.
    setTimeout(() => this.tidyPhone());
  }

  /** Moves a typed or pasted country code to the country picker and cleans up the number. */
  tidyPhone() {
    const tidy = tidyPhoneNumber(this.form.value.phoneNumber, this.selectedPhoneCountry);
    if (tidy) {
      this.form.patchValue({ phoneCountry: tidy.country.code, phoneNumber: tidy.number });
    }
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
    if (this.isBrandConfigured(brand)) {
      this.form.patchValue({ brand });
    }
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
    if (!this.isBrandConfigured(f.value.brand || '')) return `No card network is configured for ${this.currency}.`;
    if (f.get('cardholderName')?.invalid) return 'Enter the cardholder name (at least 2 characters).';
    if (f.get('email')?.invalid) return 'Enter a valid email address or leave it empty.';
    if (f.get('phoneNumber')?.invalid) return 'Check the mobile number or leave it empty.';
    if (this.rulesArray.invalid) return 'Complete or remove the spending limits.';
    return null;
  }

  submit() {
    if (this.form.invalid || !this.user || this.isProcessing || !this.isBrandConfigured(this.form.value.brand || '')) {
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
    const mobileNumber = parsePhoneNumber(this.form.value.phoneNumber, this.selectedPhoneCountry);
    const phone = mobileNumber ? toE164(mobileNumber) : undefined;

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
      phoneCountry: this.defaultPhoneCountry,
      phoneNumber: ''
    });
    this.ensureConfiguredBrand();
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
