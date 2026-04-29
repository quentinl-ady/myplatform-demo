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
import { AuthService } from '../services';

@Component({
    selector: 'app-signup',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
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
        private authService: AuthService,
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
        this.loading = true;

        let payload = { ...this.form.value };
        if (payload.userType === 'individual') {
            delete payload.legalEntityName;
        } else if (payload.userType === 'organization') {
            delete payload.firstName;
            delete payload.lastName;
        }

        this.authService.signup(payload).subscribe({
            next: (res) => {
                this.loading = false;
                if (res.id) {
                    this.router.navigate([`/${res.id}/dashboard`]);
                    this.signupSuccess.emit(res);
                }
                this.cdr.markForCheck();
            },
            error: (err) => {
                this.loading = false;
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
