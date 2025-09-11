import {
    Component,
    ChangeDetectionStrategy,
    Output,
    EventEmitter,
    ChangeDetectorRef,
} from '@angular/core';
import {
    FormGroup,
    FormBuilder,
    Validators,
    ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MaterialModule } from '../material.module';
import { MyPlatformService } from '../my-platform-service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
    selector: 'app-signup',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MaterialModule,
        MatButtonToggleModule,
        MatTooltipModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="auth-form">
      <!-- USER TYPE -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Type</mat-label>
        <mat-select formControlName="userType">
          <mat-option
            *ngFor="let type of userTypes"
            [value]="type.value"
            [disabled]="type.disabled"
            [matTooltip]="
              type.value === 'individual' && type.disabled
                ? 'Individual not allowed with Embedded Payment or extra options'
                : ''
            "
          >
            {{ type.label }}
          </mat-option>
        </mat-select>
      </mat-form-field>
      <div *ngIf="individualDisabledMessage" class="info">
        {{ individualDisabledMessage }}
      </div>

      <!-- ACTIVITY REASON -->
      <div>
        <label class="section-label">Reason of activity</label>
        <mat-button-toggle-group
          formControlName="activityReason"
          appearance="legacy"
          class="full-width"
        >
          <mat-button-toggle value="marketplace">Marketplace</mat-button-toggle>
          <mat-button-toggle
            value="embeddedPayment"
            [disabled]="disableEmbeddedPayment"
            [matTooltip]="
              disableEmbeddedPayment
                ? 'Embedded Payment is not allowed for Individual users'
                : ''
            "
          >
            Embedded Payment
          </mat-button-toggle>
        </mat-button-toggle-group>
        <div *ngIf="disableEmbeddedPayment" class="info">
          Embedded Payment disabled because you selected Individual.
        </div>
      </div>

      <!-- EXTRA OPTIONS -->
      <div class="checkbox-group">
        <mat-checkbox
          formControlName="capital"
          [disabled]="disableExtraOptions"
          [matTooltip]="
            disableExtraOptions
              ? 'Capital option is not allowed for Individual users'
              : ''
          "
        >
          Capital
        </mat-checkbox>
        <mat-checkbox
          formControlName="bank"
          [disabled]="disableExtraOptions"
          [matTooltip]="
            disableExtraOptions
              ? 'Bank option is not allowed for Individual users'
              : ''
          "
        >
          Bank
        </mat-checkbox>
        <mat-checkbox
          formControlName="issuing"
          [disabled]="disableExtraOptions"
          [matTooltip]="
            disableExtraOptions
              ? 'Issuing option is not allowed for Individual users'
              : ''
          "
        >
          Issuing
        </mat-checkbox>
      </div>
      <div *ngIf="disableExtraOptions" class="info">
        Extra options (Capital, Bank, Issuing) are disabled for Individual users.
      </div>

      <!-- COMPANY OR INDIVIDUAL -->
      <mat-form-field
        *ngIf="form.get('legalEntityName')"
        appearance="outline"
        class="full-width"
      >
        <mat-label>Company name</mat-label>
        <input matInput formControlName="legalEntityName" />
        <mat-error *ngIf="companyNameInvalid()"
          >Company name required (min 3 characters).</mat-error
        >
      </mat-form-field>

      <mat-form-field
        *ngIf="form.get('firstName')"
        appearance="outline"
        class="full-width"
      >
        <mat-label>First name</mat-label>
        <input matInput formControlName="firstName" />
        <mat-error *ngIf="firstNameInvalid()">First name required.</mat-error>
      </mat-form-field>

      <mat-form-field
        *ngIf="form.get('lastName')"
        appearance="outline"
        class="full-width"
      >
        <mat-label>Last name</mat-label>
        <input matInput formControlName="lastName" />
        <mat-error *ngIf="lastNameInvalid()">Last name required.</mat-error>
      </mat-form-field>

      <!-- COUNTRY -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Country</mat-label>
        <mat-select formControlName="countryCode">
          <mat-option value="NL">Netherlands</mat-option>
          <mat-option value="FR">France</mat-option>
          <mat-option value="GB">United Kingdom</mat-option>
          <mat-option value="DE">Germany</mat-option>
          <mat-option value="US">United States</mat-option>
        </mat-select>
      </mat-form-field>

      <!-- CURRENCY -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Currency</mat-label>
        <mat-select formControlName="currencyCode">
          <mat-option value="EUR">EUR</mat-option>
          <mat-option value="GBP">GBP</mat-option>
          <mat-option value="USD">USD</mat-option>
        </mat-select>
      </mat-form-field>

      <!-- EMAIL -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Email</mat-label>
        <input matInput type="email" formControlName="email" />
        <mat-error *ngIf="emailInvalid()">Input valid email.</mat-error>
      </mat-form-field>

      <!-- PASSWORD -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Password</mat-label>
        <input matInput type="password" formControlName="password" />
        <mat-error *ngIf="passwordInvalid()"
          >Password required (min 4 characters).</mat-error
        >
      </mat-form-field>

      <button
        mat-raised-button
        color="accent"
        class="full-width"
        [disabled]="form.invalid"
      >
        Sign Up
      </button>
      <div *ngIf="error" class="error">{{ error }}</div>
    </form>
  `,
    styles: [
        `
      .auth-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .full-width {
        width: 100%;
      }
      .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin: 0.5rem 0;
      }
      .info {
        font-size: 0.9rem;
        color: #555;
        margin-bottom: 0.5rem;
      }
      .error {
        color: red;
        margin-top: 0.5rem;
        text-align: center;
      }
      .section-label {
        font-size: 0.95rem;
        font-weight: 500;
        margin-bottom: 0.3rem;
        display: block;
      }
    `,
    ],
})
export class SignupComponent {
    form: FormGroup;
    error: string | null = null;

    userTypes = [
        { value: 'organization', label: 'Organization', disabled: false },
        { value: 'individual', label: 'Individual', disabled: false },
        { value: 'soleProprietorship', label: 'Sole Proprietorship', disabled: false },
    ];

    individualDisabledMessage: string | null = null;

    // flags UI
    disableEmbeddedPayment = false;
    disableExtraOptions = false;

    @Output() signupSuccess = new EventEmitter<unknown>();

    constructor(
        private fb: FormBuilder,
        private authService: MyPlatformService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) {
        this.form = this.fb.group({
            legalEntityName: ['', [Validators.required, Validators.minLength(3)]],
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(4)]],
            countryCode: ['NL'],
            currencyCode: ['EUR'],
            userType: ['organization'],
            activityReason: ['marketplace', Validators.required],
            capital: [false],
            bank: [false],
            issuing: [false],
        });

        this.form.get('userType')!.valueChanges.subscribe((type) =>
            this.updateUserTypeControls(type)
        );

        // ⚠️ initialisation correcte
        this.updateRestrictions();
        this.form.valueChanges.subscribe(() => this.updateRestrictions());
    }

    updateUserTypeControls(type: string) {
        if (type === 'individual') {
            this.form.removeControl('legalEntityName');
            this.form.addControl(
                'firstName',
                this.fb.control('', Validators.required)
            );
            this.form.addControl('lastName', this.fb.control('', Validators.required));
        } else {
            this.form.addControl(
                'legalEntityName',
                this.fb.control('', [Validators.required, Validators.minLength(3)])
            );
            this.form.removeControl('firstName');
            this.form.removeControl('lastName');
        }
        this.cdr.markForCheck();
    }

    updateRestrictions() {
        const activity = this.form.get('activityReason')!.value;
        const capital = this.form.get('capital')!.value;
        const bank = this.form.get('bank')!.value;
        const issuing = this.form.get('issuing')!.value;
        const userType = this.form.get('userType')!.value;

        const restrictIndividual =
            activity === 'embeddedPayment' || capital || bank || issuing;

        this.userTypes = this.userTypes.map((type) => ({
            ...type,
            disabled: type.value === 'individual' && restrictIndividual,
        }));

        this.individualDisabledMessage = restrictIndividual
            ? "You cannot select 'Individual' if activity is Embedded Payment or extra options are selected."
            : null;

        if (restrictIndividual && userType === 'individual') {
            this.form.get('userType')!.setValue('organization');
        }

        if (userType === 'individual') {
            if (activity === 'embeddedPayment') {
                this.form.get('activityReason')!.setValue('marketplace');
            }
            if (capital || bank || issuing) {
                this.form.patchValue({ capital: false, bank: false, issuing: false });
            }
        }

        // flags UI → cases restent cochables sauf si Individual
        this.disableEmbeddedPayment = userType === 'individual';
        this.disableExtraOptions = userType === 'individual';

        this.cdr.markForCheck();
    }

    companyNameInvalid() {
        const c = this.form.get('legalEntityName');
        return c && c.invalid && (c.dirty || c.touched);
    }
    firstNameInvalid() {
        const c = this.form.get('firstName');
        return c && c.invalid && (c.dirty || c.touched);
    }
    lastNameInvalid() {
        const c = this.form.get('lastName');
        return c && c.invalid && (c.dirty || c.touched);
    }
    emailInvalid() {
        const c = this.form.get('email');
        return c && c.invalid && (c.dirty || c.touched);
    }
    passwordInvalid() {
        const c = this.form.get('password');
        return c && c.invalid && (c.dirty || c.touched);
    }

    onSubmit() {
        if (!this.form.valid) return;
        this.error = null;

        let payload = { ...this.form.value };
        if (payload.userType === 'individual') {
            delete payload.legalEntityName;
        } else {
            delete payload.firstName;
            delete payload.lastName;
        }

        this.authService.signup(payload).subscribe({
            next: (res) => {
                if (res.id) {
                    this.router.navigate([`/${res.id}/dashboard`]);
                    this.signupSuccess.emit(res);
                }
            },
            error: (err) => {
                if (err.status === 409 || err.error === 'ErrorEmailAlreadyExists') {
                    this.error = 'Email already exists';
                } else if (err.status === 400) {
                    this.error = 'Invalid signup data';
                } else {
                    this.error = 'Signup failed. Please retry.';
                }
                this.cdr.markForCheck();
            },
        });
    }
}
