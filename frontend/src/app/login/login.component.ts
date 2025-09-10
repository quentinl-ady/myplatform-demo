import {
    ChangeDetectionStrategy, ChangeDetectorRef,
    Component,
    EventEmitter,
    Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from "@angular/forms";
import {Router} from "@angular/router";
import {MyPlatformService} from "../my-platform-service";

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="auth-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input id="email" formControlName="email" type="email" required
          [class.invalid]="emailInvalid()" />
        <div *ngIf="emailInvalid()" class="error">Input valid email.</div>
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" formControlName="password" type="password" required
          [class.invalid]="passwordInvalid()" />
        <div *ngIf="passwordInvalid()" class="error">Password required (min 4 characters).</div>
      </div>
      <button type="submit" [disabled]="form.invalid">Login</button>
      <div *ngIf="error" class="error">{{ error }}</div>
    </form>
  `,
    host: { class: 'auth-root' }
})
export class LoginComponent {
    form: FormGroup;
    error: string | null = null;

    @Output() loginSuccess = new EventEmitter<unknown>();

    constructor(
        private fb: FormBuilder,
        private authService: MyPlatformService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) {
        this.form = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(4)]]
        });
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
            this.authService.login(this.form.value).subscribe({
                next: (res) => {
                    if (res.id) {
                        console.log('Login success');
                        this.router.navigate([`/${res.id}/dashboard`]);
                        this.loginSuccess.emit(res);
                    }
                },
                error: (err) => {
                    if (err.status === 401 || err.error === 'ErrorWrongLoginOrPassword') {
                        this.error = 'Email or password incorrect';
                    } else {
                        this.error = 'Network issue. Please retry.';
                    }
                    this.cdr.markForCheck();
                }
            });
        }
    }
}

