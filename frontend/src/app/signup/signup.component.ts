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
    FormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MaterialModule } from '../material.module';
import { AuthService } from '../services';
import { INDUSTRY_CODES } from '../industry-codes';
import { httpErrorMessage, httpStatus } from '../shared';

const EXTRA_OPTION_CONTROLS = ['capital', 'bank', 'issuing'] as const;

const FIELD_LABELS: Record<string, string> = {
    legalEntityName: 'company name',
    firstName: 'first name',
    lastName: 'last name',
    email: 'email address',
    password: 'password',
};

@Component({
    selector: 'app-signup',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        MaterialModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './signup.component.html',
    styleUrl: './signup.component.css',
})
export class SignupComponent {
    form: FormGroup;
    error: string | null = null;
    loading = false;
    showPassword = false;

    userTypes = [
        { value: 'organization', label: 'Organization', disabled: false },
        { value: 'individual', label: 'Individual', disabled: false },
        { value: 'soleProprietorship', label: 'Sole proprietorship', disabled: false },
    ];

    readonly countryCurrencyMap: Record<string, string> = {
        NL: 'EUR',
        FR: 'EUR',
        DE: 'EUR',
        GB: 'GBP',
        US: 'USD',
    };

    individualDisabledMessage: string | null = null;

    // flags UI
    disableEmbeddedPayment = false;
    disableExtraOptions = false;

    // business activities for embedded payment
    readonly INDUSTRY_CODES = INDUSTRY_CODES;
    filteredIndustries = [...INDUSTRY_CODES];
    industrySearch = '';
    businessActivities: { industryCode: string; salesChannels: string[] }[] = [];
    newActivity = { industryCode: '' };
    businessActivityError: string | null = null;

    @Output() signupSuccess = new EventEmitter<unknown>();

    constructor(
        private fb: FormBuilder,
        private authService: AuthService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) {
        this.form = this.fb.group({
            legalEntityName: ['', [Validators.required, Validators.minLength(3)]],
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(4)]],
            countryCode: ['NL'],
            currencyCode: [{ value: 'EUR', disabled: true }],
            userType: ['organization'],
            activityReason: ['marketplace', Validators.required],
            capital: [false],
            bank: [false],
            issuing: [false],
        });

        this.form.get('userType')!.valueChanges.subscribe((type) =>
            this.updateUserTypeControls(type)
        );

        this.form.get('countryCode')!.valueChanges.subscribe((country) => {
            const currency = this.countryCurrencyMap[country] || 'EUR';
            this.form.get('currencyCode')!.setValue(currency);
        });

        this.updateRestrictions();
        this.form.valueChanges.subscribe(() => this.updateRestrictions());
    }

    updateUserTypeControls(type: string) {
        if (type === 'individual') {
            this.form.removeControl('legalEntityName');
            this.form.addControl('firstName', this.fb.control('', Validators.required));
            this.form.addControl('lastName', this.fb.control('', Validators.required));
        } else if (type === 'organization') {
            this.form.addControl('legalEntityName', this.fb.control('', [Validators.required, Validators.minLength(3)]));
            this.form.removeControl('firstName');
            this.form.removeControl('lastName');
        } else if (type === 'soleProprietorship') {
            this.form.addControl('firstName', this.fb.control('', Validators.required));
            this.form.addControl('lastName', this.fb.control('', Validators.required));
            this.form.addControl('legalEntityName', this.fb.control('', [Validators.required, Validators.minLength(3)]));
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
            ? 'Individual accounts can\'t use embedded payments, Capital, Bank or Issuing. Clear those options to choose Individual.'
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

        this.disableEmbeddedPayment = userType === 'individual';
        this.disableExtraOptions = userType === 'individual';
        // Toggled on the controls rather than with [disabled] (unsupported with reactive forms);
        // getRawValue() still sends the values.
        for (const name of EXTRA_OPTION_CONTROLS) {
            const control = this.form.get(name)!;
            if (this.disableExtraOptions && control.enabled) {
                control.disable({ emitEvent: false });
            } else if (!this.disableExtraOptions && control.disabled) {
                control.enable({ emitEvent: false });
            }
        }

        if (activity !== 'embeddedPayment') {
            this.businessActivities = [];
            this.businessActivityError = null;
        }

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
    emailError(): string | null {
        const c = this.form.get('email');
        if (!c || !c.invalid || !(c.dirty || c.touched)) return null;
        return c.hasError('required') ? 'Enter your email address.' : 'Enter a valid email address, e.g. name@company.com.';
    }
    passwordInvalid() {
        const c = this.form.get('password');
        return c && c.invalid && (c.dirty || c.touched);
    }

    isEmbeddedPayment(): boolean {
        return this.form.get('activityReason')!.value === 'embeddedPayment';
    }

    filterIndustries() {
        const term = this.industrySearch.toLowerCase();
        this.filteredIndustries = INDUSTRY_CODES.filter(
            i => i.label.toLowerCase().includes(term) || i.code.toLowerCase().includes(term)
        );
        this.cdr.markForCheck();
    }

    onIndustrySelected(code: string) {
        this.newActivity.industryCode = code;
        this.industrySearch = this.getIndustryLabel(code);
        this.cdr.markForCheck();
    }

    addActivity() {
        if (!this.newActivity.industryCode) {
            this.businessActivityError = 'Select an industry from the list first.';
            this.cdr.markForCheck();
            return;
        }

        this.businessActivities.push({
            industryCode: this.newActivity.industryCode,
            salesChannels: ['pos', 'eCommerce', 'payByLink'],
        });
        this.newActivity = { industryCode: '' };
        this.industrySearch = '';
        this.filteredIndustries = [...INDUSTRY_CODES];
        this.businessActivityError = null;
        this.cdr.markForCheck();
    }

    removeActivity(index: number) {
        this.businessActivities.splice(index, 1);
        this.cdr.markForCheck();
    }

    getIndustryLabel(code: string): string {
        const ind = INDUSTRY_CODES.find(i => i.code === code);
        return ind ? ind.label : code;
    }

    togglePassword() {
        this.showPassword = !this.showPassword;
    }

    /** What still blocks the submit button, in reading order. */
    missingFields(): string[] {
        const missing: string[] = [];
        for (const name of ['legalEntityName', 'firstName', 'lastName', 'email', 'password']) {
            const control = this.form.get(name);
            if (!control || control.valid) continue;
            if (name === 'email' && !control.hasError('required')) {
                missing.push('a valid email address');
            } else if (name === 'password' && control.hasError('minlength')) {
                missing.push('a password of at least 4 characters');
            } else if (name === 'legalEntityName' && control.hasError('minlength')) {
                missing.push('a company name of at least 3 characters');
            } else {
                missing.push(FIELD_LABELS[name]);
            }
        }
        if (this.isEmbeddedPayment() && this.businessActivities.length === 0) {
            missing.push('at least one business activity');
        }
        return missing;
    }

    canSubmit(): boolean {
        if (this.form.invalid || this.loading) return false;
        if (this.isEmbeddedPayment() && this.businessActivities.length === 0) return false;
        return true;
    }

    onSubmit() {
        if (this.loading) return;
        if (!this.form.valid) {
            this.form.markAllAsTouched();
            this.cdr.markForCheck();
            return;
        }
        if (this.isEmbeddedPayment() && this.businessActivities.length === 0) {
            this.businessActivityError = 'Add at least one business activity to use embedded payments.';
            this.cdr.markForCheck();
            return;
        }
        this.error = null;
        this.loading = true;

        let payload: any = { ...this.form.getRawValue() };
        if (payload.userType === 'individual') {
            delete payload.legalEntityName;
        } else if (payload.userType === 'organization') {
            delete payload.firstName;
            delete payload.lastName;
        }

        if (this.isEmbeddedPayment()) {
            payload.businessActivities = this.businessActivities;
        }

        this.authService.signup(payload).subscribe({
            next: (res) => {
                if (res?.id) {
                    this.router.navigate([`/${res.id}/dashboard`]);
                    this.signupSuccess.emit(res);
                } else {
                    this.loading = false;
                    this.error = 'We couldn\'t create your account. Please try again.';
                }
                this.cdr.markForCheck();
            },
            error: (err) => {
                this.loading = false;
                const body = err?.error;
                const emailTaken = httpStatus(err) === 409
                    || body === 'ErrorEmailAlreadyExists'
                    || body?.error === 'ErrorEmailAlreadyExists';
                if (emailTaken) {
                    this.error = 'An account with this email address already exists. Log in instead or use another email.';
                } else if (httpStatus(err) === 400) {
                    this.error = httpErrorMessage(err, 'Some details are invalid. Check the form and try again.');
                } else {
                    this.error = httpErrorMessage(err, 'We couldn\'t create your account. Please try again.');
                }
                this.cdr.markForCheck();
            },
        });
    }
}
