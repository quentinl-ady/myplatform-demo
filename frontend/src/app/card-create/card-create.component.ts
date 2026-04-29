import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormControl, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MaterialModule } from '../material.module';

import {
  User,
  CreateCardRequest,
  TransactionRuleRequest,
  PhonePrefix
} from '../models';
import { AccountService, IssuingService } from '../services';
import { MCC_CODES } from '../industry-codes';

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

  userId = '';
  user?: User;
  isProcessing = false;
  isSuccess = false;
  createdCard?: any;

  phonePrefixes: PhonePrefix[] = [];
  allMccs = MCC_CODES;
  selectedMccs: { code: string; label: string; risky?: boolean }[] = [];
  filteredMccs: { code: string; label: string; risky?: boolean }[] = [];
  mccSearchControl = new FormControl('');

  form = this.fb.group({
    cardholderName: ['', [Validators.required, Validators.minLength(2)]],
    brand: ['visa', Validators.required],
    email: ['', [Validators.email]],
    phonePrefix: ['+31'],
    phoneNumber: ['', [Validators.pattern(/^[\d\s\-()]+$/)]],
    rules: this.fb.array([])
  });

  get rulesArray() {
    return this.form.get('rules') as FormArray;
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadUser();
      }
    });

    this.mccSearchControl.valueChanges.subscribe(value => {
      this.filterMccs(value || '');
    });
    this.filteredMccs = this.allMccs;

    this.issuingService.getPhonePrefixes().subscribe({
      next: (prefixes) => this.phonePrefixes = prefixes,
      error: () => this.phonePrefixes = [{ code: '+31', country: 'Netherlands', flag: '🇳🇱' }]
    });
  }

  filterMccs(searchTerm: string) {
    if (!searchTerm) {
      this.filteredMccs = this.allMccs.filter(
        mcc => !this.selectedMccs.some(s => s.code === mcc.code)
      );
      return;
    }
    const term = searchTerm.toLowerCase();
    this.filteredMccs = this.allMccs.filter(
      mcc => !this.selectedMccs.some(s => s.code === mcc.code) &&
        (mcc.code.toLowerCase().includes(term) || mcc.label.toLowerCase().includes(term))
    );
  }

  addMcc(event: any) {
    const mcc = event.option.value;
    if (!this.selectedMccs.some(s => s.code === mcc.code)) {
      this.selectedMccs.push(mcc);
    }
    this.mccSearchControl.setValue('');
    this.filterMccs('');
    this.cdr.detectChanges();
  }

  removeMcc(mcc: { code: string; label: string; risky?: boolean }) {
    this.selectedMccs = this.selectedMccs.filter(s => s.code !== mcc.code);
    this.filterMccs(this.mccSearchControl.value || '');
    this.cdr.detectChanges();
  }

  loadUser() {
    this.accountService.getUserById(Number(this.userId)).subscribe({
      next: (user) => {
        this.user = user;
        if (user.email) {
          this.form.patchValue({ email: user.email });
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.snack.open('Failed to load user information', 'Close', { duration: 3000 });
      }
    });
  }

  selectBrand(brand: string) {
    this.form.patchValue({ brand });
  }

  addRule() {
    const ruleGroup = this.fb.group({
      type: ['maxAmountPerTransaction', Validators.required],
      value: [null as number | null, [Validators.required, Validators.min(0.01)]]
    });
    this.rulesArray.push(ruleGroup);
  }

  removeRule(index: number) {
    this.rulesArray.removeAt(index);
  }

  submit() {
    if (this.form.invalid || !this.user) return;

    this.isProcessing = true;

    const rules: TransactionRuleRequest[] = this.rulesArray.value
      .filter((r: any) => r.value)
      .map((r: any) => ({
        type: r.type,
        // Convert to minor units for amount-based rules (multiply by 100)
        value: r.type === 'maxTransactions' ? r.value : Math.round(r.value * 100),
        currencyCode: this.user!.currencyCode
      }));

    // Add MCC block rule if any MCCs are selected
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
      userId: Number(this.userId),
      cardholderName: this.form.value.cardholderName!,
      brand: this.form.value.brand!,
      email,
      phone,
      transactionRules: rules.length > 0 ? rules : undefined
    };

    this.issuingService.createCard(request).subscribe({
      next: (card) => {
        this.createdCard = card;
        this.isSuccess = true;
        this.isProcessing = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isProcessing = false;
        this.snack.open('Failed to create card', 'Close', { duration: 3000 });
        this.cdr.detectChanges();
      }
    });
  }

  createAnother() {
    this.isSuccess = false;
    this.createdCard = null;
    this.form.reset({ brand: 'visa', cardholderName: '', email: this.user?.email || '', phonePrefix: '+31', phoneNumber: '' });
    this.rulesArray.clear();
    this.selectedMccs = [];
    this.filterMccs('');
  }

  viewCards() {
    this.router.navigate(['/', this.userId, 'cards']);
  }
}
