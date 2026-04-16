import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';

import {
  MyPlatformService,
  User,
  CreateCardRequest,
  TransactionRuleRequest
} from '../my-platform-service';

@Component({
  selector: 'app-card-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatSnackBarModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatCheckboxModule
  ],
  template: `
    <div class="fintech-wrapper">
      <div class="page-header">
        <h1>Create Virtual Card</h1>
        <p class="subtitle">Issue a new virtual card for online payments</p>
      </div>

      <mat-card class="create-card-form" *ngIf="!isSuccess">
        <form [formGroup]="form" (ngSubmit)="submit()">
          
          <div class="card-preview" [class.visa]="form.value.brand === 'visa'" [class.mc]="form.value.brand === 'mc'">
            <div class="card-brand-logo">
              <svg *ngIf="form.value.brand === 'visa'" viewBox="0 0 750 471" xmlns="http://www.w3.org/2000/svg">
                <path d="M278.198 334.228l33.36-195.763h53.358l-33.384 195.763h-53.334zm246.11-191.54c-10.57-3.966-27.135-8.222-47.822-8.222-52.725 0-89.863 26.551-90.18 64.604-.297 28.129 26.514 43.821 46.754 53.185 20.77 9.597 27.752 15.716 27.652 24.283-.133 13.123-16.586 19.116-31.924 19.116-21.355 0-32.701-2.967-50.225-10.274l-6.878-3.112-7.487 43.822c12.463 5.466 35.508 10.199 59.438 10.445 56.09 0 92.502-26.248 92.916-66.884.199-22.27-14.016-39.216-44.801-53.188-18.65-9.056-30.072-15.099-29.951-24.269 0-8.137 9.668-16.838 30.559-16.838 17.447-.271 30.088 3.534 39.936 7.5l4.781 2.259 7.232-42.427m137.308-4.223h-41.23c-12.773 0-22.332 3.486-27.941 16.234l-79.244 179.402h56.031s9.16-24.121 11.232-29.418c6.123 0 60.555.084 68.336.084 1.596 6.854 6.492 29.334 6.492 29.334h49.512l-43.188-195.636zm-65.417 126.408c4.414-11.279 21.26-54.724 21.26-54.724-.314.521 4.381-11.334 7.074-18.684l3.607 16.878s10.217 46.729 12.352 56.527h-44.293v.003zM185.213 138.465L133.188 271.94l-5.562-27.129c-9.726-31.274-40.025-65.157-73.898-82.12l47.767 171.204 56.455-.064 84.004-195.386h-56.741" fill="#fff"/>
              </svg>
              <svg *ngIf="form.value.brand === 'mc'" viewBox="0 0 152 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="45" fill="#eb001b"/>
                <circle cx="102" cy="50" r="45" fill="#f79e1b"/>
                <path d="M76 18.5a45 45 0 0 0 0 63 45 45 0 0 0 0-63z" fill="#ff5f00"/>
              </svg>
            </div>
            <div class="card-number">•••• •••• •••• ••••</div>
            <div class="card-details-row">
              <div class="card-holder">
                <span class="label">CARDHOLDER</span>
                <span class="value">{{ form.value.cardholderName || 'YOUR NAME' }}</span>
              </div>
              <div class="card-expiry">
                <span class="label">EXPIRES</span>
                <span class="value">••/••</span>
              </div>
            </div>
          </div>

          <div class="form-section">
            <h3>Card Information</h3>
            
            <div class="form-group">
              <label>Cardholder Name</label>
              <input type="text" class="fintech-input" formControlName="cardholderName" 
                     placeholder="Enter cardholder name" />
            </div>

            <div class="form-group">
              <label>Card Network</label>
              <div class="brand-selector">
                <button type="button" class="brand-option" 
                        [class.selected]="form.value.brand === 'visa'"
                        (click)="selectBrand('visa')">
                  <svg viewBox="0 0 750 471" xmlns="http://www.w3.org/2000/svg">
                    <path d="M278.198 334.228l33.36-195.763h53.358l-33.384 195.763h-53.334zm246.11-191.54c-10.57-3.966-27.135-8.222-47.822-8.222-52.725 0-89.863 26.551-90.18 64.604-.297 28.129 26.514 43.821 46.754 53.185 20.77 9.597 27.752 15.716 27.652 24.283-.133 13.123-16.586 19.116-31.924 19.116-21.355 0-32.701-2.967-50.225-10.274l-6.878-3.112-7.487 43.822c12.463 5.466 35.508 10.199 59.438 10.445 56.09 0 92.502-26.248 92.916-66.884.199-22.27-14.016-39.216-44.801-53.188-18.65-9.056-30.072-15.099-29.951-24.269 0-8.137 9.668-16.838 30.559-16.838 17.447-.271 30.088 3.534 39.936 7.5l4.781 2.259 7.232-42.427m137.308-4.223h-41.23c-12.773 0-22.332 3.486-27.941 16.234l-79.244 179.402h56.031s9.16-24.121 11.232-29.418c6.123 0 60.555.084 68.336.084 1.596 6.854 6.492 29.334 6.492 29.334h49.512l-43.188-195.636zm-65.417 126.408c4.414-11.279 21.26-54.724 21.26-54.724-.314.521 4.381-11.334 7.074-18.684l3.607 16.878s10.217 46.729 12.352 56.527h-44.293v.003zM185.213 138.465L133.188 271.94l-5.562-27.129c-9.726-31.274-40.025-65.157-73.898-82.12l47.767 171.204 56.455-.064 84.004-195.386h-56.741" fill="#1a1f71"/>
                  </svg>
                  <span>Visa Debit</span>
                </button>
                <button type="button" class="brand-option"
                        [class.selected]="form.value.brand === 'mc'"
                        (click)="selectBrand('mc')">
                  <svg viewBox="0 0 152 100" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="50" cy="50" r="45" fill="#eb001b"/>
                    <circle cx="102" cy="50" r="45" fill="#f79e1b"/>
                    <path d="M76 18.5a45 45 0 0 0 0 63 45 45 0 0 0 0-63z" fill="#ff5f00"/>
                  </svg>
                  <span>Mastercard Debit</span>
                </button>
              </div>
            </div>
          </div>

          <div class="form-section">
            <div class="section-header">
              <h3>Transaction Rules</h3>
              <span class="optional-badge">Optional</span>
            </div>
            <p class="section-description">Set spending limits to control card usage. Rules can be added later.</p>

            <div class="rules-container" formArrayName="rules">
              <div class="rule-item" *ngFor="let rule of rulesArray.controls; let i = index" [formGroupName]="i">
                <div class="rule-type">
                  <select class="fintech-input" formControlName="type">
                    <option value="maxTransactions">Transaction limit</option>
                    <option value="maxAmountPerTransaction">Max amount per transaction</option>
                    <option value="maxTotalAmount">Total spending limit</option>
                  </select>
                </div>
                <div class="rule-value">
                  <input type="number" class="fintech-input" formControlName="value" 
                         [step]="rule.value.type === 'maxTransactions' ? '1' : '0.01'"
                         [placeholder]="rule.value.type === 'maxTransactions' ? 'Number of transactions' : 'Amount (e.g. 100.00)'" />
                  <span class="currency-hint" *ngIf="rule.value.type !== 'maxTransactions'">{{ user?.currencyCode }}</span>
                </div>
                <button type="button" class="remove-rule-btn" (click)="removeRule(i)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>

            <button type="button" class="add-rule-btn" (click)="addRule()" [disabled]="rulesArray.length >= 3">
              <mat-icon>add</mat-icon>
              Add Rule
            </button>
          </div>

          <button mat-flat-button class="fintech-btn primary full-width" type="submit"
                  [disabled]="form.invalid || isProcessing">
            <span *ngIf="!isProcessing">Create Card</span>
            <mat-spinner *ngIf="isProcessing" diameter="24" color="accent"></mat-spinner>
          </button>
        </form>
      </mat-card>

      <mat-card class="success-card" *ngIf="isSuccess">
        <div class="success-icon">
          <mat-icon>check_circle</mat-icon>
        </div>
        <h2>Card Created Successfully!</h2>
        <p>Your new virtual card is ready to use.</p>
        
        <div class="success-details">
          <div class="detail-row">
            <span class="label">Card Number</span>
            <span class="value">•••• •••• •••• {{ createdCard?.lastFour }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Cardholder</span>
            <span class="value">{{ createdCard?.cardholderName }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Network</span>
            <span class="value brand-badge" [class.visa]="createdCard?.brand === 'visa'" [class.mc]="createdCard?.brand === 'mc'">
              {{ createdCard?.brand === 'visa' ? 'Visa' : 'Mastercard' }}
            </span>
          </div>
        </div>

        <div class="success-actions">
          <button mat-stroked-button class="fintech-btn secondary" (click)="createAnother()">
            Create Another
          </button>
          <button mat-flat-button class="fintech-btn primary" (click)="viewCards()">
            View My Cards
          </button>
        </div>
      </mat-card>
    </div>
  `,
  styles: [`
    :host {
      --fintech-primary: #000000;
      --fintech-bg: #f5f6f8;
      --fintech-surface: #ffffff;
      --fintech-text: #1a1a1a;
      --fintech-text-secondary: #737373;
      --fintech-border: #e5e5e5;
      --fintech-radius: 16px;
      --visa-gradient: linear-gradient(135deg, #1a1f71 0%, #2d4aa8 100%);
      --mc-gradient: linear-gradient(135deg, #eb001b 0%, #f79e1b 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .fintech-wrapper { max-width: 560px; margin: 0 auto; padding: 0 16px; }
    
    .page-header { margin-bottom: 24px; }
    .page-header h1 { font-size: 28px; font-weight: 700; margin: 0 0 8px 0; color: var(--fintech-text); }
    .page-header .subtitle { font-size: 15px; color: var(--fintech-text-secondary); margin: 0; }

    mat-card { 
      background: var(--fintech-surface); 
      border-radius: var(--fintech-radius); 
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04) !important; 
      padding: 32px; 
    }

    .card-preview {
      background: var(--visa-gradient);
      border-radius: 16px;
      padding: 24px;
      color: white;
      margin-bottom: 32px;
      aspect-ratio: 1.586;
      max-height: 200px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: background 0.3s ease;
    }
    .card-preview.mc { background: var(--mc-gradient); }
    .card-preview.visa { background: var(--visa-gradient); }

    .card-brand-logo { height: 40px; width: 80px; }
    .card-brand-logo svg { height: 100%; width: auto; }
    .card-number { font-size: 22px; letter-spacing: 4px; font-weight: 500; }
    .card-details-row { display: flex; justify-content: space-between; }
    .card-details-row .label { display: block; font-size: 10px; opacity: 0.7; margin-bottom: 4px; }
    .card-details-row .value { font-size: 14px; font-weight: 500; text-transform: uppercase; }

    .form-section { margin-bottom: 32px; }
    .form-section h3 { font-size: 16px; font-weight: 600; margin: 0 0 16px 0; color: var(--fintech-text); }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .section-header h3 { margin: 0; }
    .optional-badge { 
      font-size: 11px; 
      padding: 2px 8px; 
      background: var(--fintech-bg); 
      border-radius: 4px; 
      color: var(--fintech-text-secondary);
    }
    .section-description { font-size: 13px; color: var(--fintech-text-secondary); margin: 0 0 16px 0; }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--fintech-text-secondary); margin-bottom: 6px; }
    
    .fintech-input { 
      width: 100%; 
      padding: 14px 16px; 
      border: 1px solid var(--fintech-border); 
      border-radius: 10px; 
      font-size: 15px; 
      box-sizing: border-box; 
      background: var(--fintech-surface); 
      transition: border-color 0.2s; 
    }
    .fintech-input:focus { outline: none; border-color: var(--fintech-primary); }

    .brand-selector { display: flex; gap: 12px; }
    .brand-option {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px;
      border: 2px solid var(--fintech-border);
      border-radius: 12px;
      background: var(--fintech-surface);
      cursor: pointer;
      transition: all 0.2s;
    }
    .brand-option:hover { border-color: var(--fintech-text-secondary); }
    .brand-option.selected { border-color: var(--fintech-primary); background: var(--fintech-bg); }
    .brand-option svg { height: 32px; width: 50px; }
    .brand-option span { font-size: 13px; font-weight: 500; color: var(--fintech-text); }

    .rules-container { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
    .rule-item { 
      display: flex; 
      gap: 12px; 
      align-items: center;
      padding: 12px;
      background: var(--fintech-bg);
      border-radius: 10px;
    }
    .rule-type { flex: 1.5; }
    .rule-type select { width: 100%; }
    .rule-value { flex: 1; position: relative; }
    .rule-value input { width: 100%; padding-right: 40px; }
    .currency-hint { 
      position: absolute; 
      right: 12px; 
      top: 50%; 
      transform: translateY(-50%); 
      font-size: 12px; 
      color: var(--fintech-text-secondary);
    }
    .remove-rule-btn { 
      background: none; 
      border: none; 
      cursor: pointer; 
      color: var(--fintech-text-secondary);
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .remove-rule-btn:hover { color: #f44336; }

    .add-rule-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border: 1px dashed var(--fintech-border);
      border-radius: 10px;
      background: transparent;
      color: var(--fintech-text-secondary);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
      justify-content: center;
    }
    .add-rule-btn:hover:not(:disabled) { border-color: var(--fintech-primary); color: var(--fintech-primary); }
    .add-rule-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .fintech-btn { 
      border-radius: 24px !important; 
      padding: 8px 24px !important; 
      font-weight: 600 !important; 
      letter-spacing: 0 !important; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      gap: 8px; 
    }
    .fintech-btn.primary { background-color: var(--fintech-primary) !important; color: white !important; }
    .fintech-btn.secondary { background-color: var(--fintech-bg) !important; color: var(--fintech-text) !important; border: none !important; }
    .fintech-btn:disabled { background-color: var(--fintech-border) !important; color: var(--fintech-text-secondary) !important; }
    .fintech-btn.full-width { width: 100%; padding: 14px 24px !important; font-size: 16px !important; }

    .success-card { text-align: center; padding: 48px 32px; }
    .success-icon { 
      width: 72px; 
      height: 72px; 
      background: #e8f5e9; 
      border-radius: 50%; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      margin: 0 auto 24px; 
    }
    .success-icon mat-icon { font-size: 40px; width: 40px; height: 40px; color: #4caf50; }
    .success-card h2 { font-size: 24px; margin: 0 0 8px 0; }
    .success-card > p { color: var(--fintech-text-secondary); margin: 0 0 32px 0; }

    .success-details { 
      background: var(--fintech-bg); 
      border-radius: 12px; 
      padding: 20px; 
      margin-bottom: 32px;
      text-align: left;
    }
    .detail-row { 
      display: flex; 
      justify-content: space-between; 
      padding: 12px 0; 
      border-bottom: 1px solid var(--fintech-border); 
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-row .label { color: var(--fintech-text-secondary); font-size: 14px; }
    .detail-row .value { font-weight: 600; font-size: 14px; }
    .brand-badge { 
      padding: 4px 12px; 
      border-radius: 4px; 
      font-size: 12px !important; 
      text-transform: uppercase;
    }
    .brand-badge.visa { background: #1a1f71; color: white; }
    .brand-badge.mc { background: #eb001b; color: white; }

    .success-actions { display: flex; gap: 12px; justify-content: center; }
    .success-actions button { flex: 1; max-width: 200px; }
  `]
})
export class CardCreateComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(MyPlatformService);
  private snack = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  userId = '';
  user?: User;
  isProcessing = false;
  isSuccess = false;
  createdCard?: any;

  form = this.fb.group({
    cardholderName: ['', [Validators.required, Validators.minLength(2)]],
    brand: ['visa', Validators.required],
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
  }

  loadUser() {
    this.service.getUserById(Number(this.userId)).subscribe({
      next: (user) => {
        this.user = user;
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

    const request: CreateCardRequest = {
      userId: Number(this.userId),
      cardholderName: this.form.value.cardholderName!,
      brand: this.form.value.brand!,
      transactionRules: rules.length > 0 ? rules : undefined
    };

    this.service.createCard(request).subscribe({
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
    this.form.reset({ brand: 'visa', cardholderName: '' });
    this.rulesArray.clear();
  }

  viewCards() {
    this.router.navigate(['/', this.userId, 'cards']);
  }
}
