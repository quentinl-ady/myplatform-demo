import { Component, ChangeDetectionStrategy, EventEmitter, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';
import { MyPlatformService } from '../my-platform-service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, MaterialModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Email</mat-label>
        <input matInput type="email" formControlName="email" required />
        <mat-error *ngIf="emailInvalid()">Please enter a valid email.</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Password</mat-label>
        <input matInput type="password" formControlName="password" required />
        <mat-error *ngIf="passwordInvalid()">Password must be at least 4 characters.</mat-error>
      </mat-form-field>

      <button mat-raised-button color="primary" class="full-width" [disabled]="form.invalid">
        Login
      </button>

      <mat-progress-spinner *ngIf="loading" mode="indeterminate" diameter="30"></mat-progress-spinner>

      <div *ngIf="error" class="error">{{ error }}</div>
    </form>
  `,
    styles: [`
    .full-width { width: 100%; margin-bottom: 1rem; }
    .error { color: red; margin-top: 0.5rem; text-align: center; }
  `]
})
export class LoginComponent {
    form: FormGroup;
    error: string | null = null;
    loading = false;

    @Output() loginSuccess = new EventEmitter<unknown>();

    constructor(private fb: FormBuilder, private authService: MyPlatformService, private router: Router) {
        this.form = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(4)]]
        });
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
        this.loading = true;
        this.error = null;

        this.authService.login(this.form.value).subscribe({
            next: (res) => {
                this.loading = false;
                if (res.id) {
                    this.loginSuccess.emit(res);
                    this.router.navigate([`/${res.id}/dashboard`]);
                }
            },
            error: (err) => {
                this.loading = false;
                this.error = err.status === 401 ? 'Email or password incorrect' : 'Network issue. Please retry.';
            }
        });
    }
}
