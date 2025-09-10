import {
    Component,
    ChangeDetectionStrategy,
    Output,
    EventEmitter,
    ChangeDetectorRef
} from '@angular/core';
import { FormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from "@angular/router";
import { MyPlatformService } from "../my-platform-service";

@Component({
    selector: 'app-signup',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="auth-form">

      <div class="form-group">
        <label for="userType">Type</label>
        <select id="userType" formControlName="userType" required>
          <option *ngFor="let type of userTypes" [value]="type.value" [disabled]="type.disabled">
            {{ type.label }}
          </option>
        </select>
        <div *ngIf="individualDisabledMessage" class="info">{{ individualDisabledMessage }}</div>
      </div>

      <div class="form-group">
        <label for="activityReason">Reason of activity</label>
        <select id="activityReason" formControlName="activityReason" required>
          <option value="" disabled selected>Select one reason</option>
          <option value="marketplace">Marketplace</option>
          <option value="embeddedPayment">Embedded Payment</option>
          <option value="financialProduct">Financial Product</option>
        </select>
      </div>

      <div class="form-group" *ngIf="form.get('legalEntityName')">
        <label for="companyName">Company name</label>
        <input id="companyName" formControlName="legalEntityName" type="text" required
          [class.invalid]="companyNameInvalid()" />
        <div *ngIf="companyNameInvalid()" class="error">
          Company name required (min 3 characters).
        </div>
      </div>

      <div class="form-group" *ngIf="form.get('firstName')">
        <label for="firstName">First name</label>
        <input id="firstName" formControlName="firstName" type="text" required
          [class.invalid]="firstNameInvalid()" />
        <div *ngIf="firstNameInvalid()" class="error">
          First name required.
        </div>
      </div>

      <div class="form-group" *ngIf="form.get('lastName')">
        <label for="lastName">Last name</label>
        <input id="lastName" formControlName="lastName" type="text" required
          [class.invalid]="lastNameInvalid()" />
        <div *ngIf="lastNameInvalid()" class="error">
          Last name required.
        </div>
      </div>

      <div class="form-group">
        <label for="country">Country</label>
        <select id="country" formControlName="countryCode" required>
          <option value="NL">Netherlands</option>
          <option value="FR">France</option>
          <option value="GB">United Kingdom</option>
          <option value="DE">Germany</option>
          <option value="US">United States</option>
        </select>
      </div>

      <div class="form-group">
        <label for="currency">Currency</label>
        <select id="currency" formControlName="currencyCode" required>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
        </select>
      </div>

      <div class="form-group">
        <label for="email">Email</label>
        <input id="email" formControlName="email" type="email" required
          [class.invalid]="emailInvalid()" />
        <div *ngIf="emailInvalid()" class="error">
          Input valid email.
        </div>
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" formControlName="password" type="password" required
          [class.invalid]="passwordInvalid()" />
        <div *ngIf="passwordInvalid()" class="error">
          Password required (min 4 characters).
        </div>
      </div>

      <button type="submit" [disabled]="form.invalid">Signup</button>
      <div *ngIf="error" class="error">{{ error }}</div>

    </form>
  `,
    host: {
        class: 'auth-root'
    }
})
export class SignupComponent {
    form: FormGroup;
    error: string | null = null;

    userTypes = [
        { value: 'organization', label: 'Organization', disabled: false },
        { value: 'individual', label: 'Individual', disabled: false },
        { value: 'soleProprietorship', label: 'SoleProprietorship', disabled: false }
    ];

    individualDisabledMessage: string | null = null;

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
            activityReason: ['marketplace', Validators.required] // Sélection unique
        });

        this.form.get('userType')!.valueChanges.subscribe(type => this.updateUserTypeControls(type));
        this.form.get('activityReason')!.valueChanges.subscribe(value => this.updateUserTypeOptions(value));
    }

    updateUserTypeControls(type: string) {
        if (type === 'individual') {
            this.form.removeControl('legalEntityName');
            this.form.addControl('firstName', this.fb.control('', Validators.required));
            this.form.addControl('lastName', this.fb.control('', Validators.required));
        } else {
            this.form.addControl('legalEntityName', this.fb.control('', [Validators.required, Validators.minLength(3)]));
            this.form.removeControl('firstName');
            this.form.removeControl('lastName');
        }
        this.cdr.markForCheck();
    }

    updateUserTypeOptions(selectedActivity: string) {
        const restrictIndividual = selectedActivity === 'embeddedPayment' || selectedActivity === 'financialProduct';
        this.userTypes = this.userTypes.map(type => ({
            ...type,
            disabled: type.value === 'individual' && restrictIndividual
        }));

        // Message explicatif
        this.individualDisabledMessage = restrictIndividual
            ? "You cannot select 'Individual' if activity is Embedded Payment or Financial Product."
            : null;

        // Si current userType est individual et devient interdit, on reset
        if (restrictIndividual && this.form.get('userType')!.value === 'individual') {
            this.form.get('userType')!.setValue('organization');
        }

        this.cdr.markForCheck();
    }

    companyNameInvalid() {
        const control = this.form.get('legalEntityName');
        return control && control.invalid && (control.dirty || control.touched);
    }

    firstNameInvalid() {
        const control = this.form.get('firstName');
        return control && control.invalid && (control.dirty || control.touched);
    }

    lastNameInvalid() {
        const control = this.form.get('lastName');
        return control && control.invalid && (control.dirty || control.touched);
    }

    emailInvalid() {
        const control = this.form.get('email');
        return control && control.invalid && (control.dirty || control.touched);
    }

    passwordInvalid() {
        const control = this.form.get('password');
        return control && control.invalid && (control.dirty || control.touched);
    }

    onSubmit() {
        if (this.form.valid) {
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
                }
            });
        }
    }
}
