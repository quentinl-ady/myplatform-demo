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
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="fintech-form">

      <mat-form-field appearance="outline" class="fintech-input">
        <mat-label>Email address</mat-label>
        <input matInput type="email" formControlName="email" placeholder="name@company.com" required />
        <mat-error *ngIf="emailInvalid()">Please enter a valid email.</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="fintech-input">
        <mat-label>Password</mat-label>
        <input matInput type="password" formControlName="password" placeholder="••••••••" required />
        <mat-error *ngIf="passwordInvalid()">Password must be at least 4 characters.</mat-error>
      </mat-form-field>

      <button mat-flat-button class="fintech-btn primary" [disabled]="form.invalid || loading">
        <span *ngIf="!loading">Log in</span>
        <mat-spinner *ngIf="loading" diameter="20" color="accent"></mat-spinner>
      </button>

      <div *ngIf="error" class="error-msg">
        <mat-icon>error_outline</mat-icon>
        <span>{{ error }}</span>
      </div>
    </form>
  `,
  styles: [`
    :host {
      --fintech-primary: #000000;
      --fintech-danger: #d32f2f;
      display: block;
      width: 100%;
    }

    .fintech-form {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    /* Espacement des champs */
    .fintech-input {
      width: 100%;
      margin-bottom: 8px;
    }

    /* Style du bouton (identique au composant Device) */
    .fintech-btn {
      width: 100%;
      margin-top: 8px !important;
      border-radius: 24px !important; /* Forme de pilule */
      padding: 12px 0 !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      letter-spacing: 0 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 48px; /* Hauteur fixe pour éviter que le bouton saute au chargement */
    }
    .fintech-btn.primary {
      background-color: var(--fintech-primary) !important;
      color: white !important;
    }
    .fintech-btn[disabled] {
      background-color: #e5e5e5 !important;
      color: #a3a3a3 !important;
    }

    /* Message d'erreur stylisé */
    .error-msg {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: var(--fintech-danger);
      background: rgba(211, 47, 47, 0.05);
      padding: 12px;
      border-radius: 8px;
      margin-top: 16px;
      font-size: 13px;
      font-weight: 500;
    }
    .error-msg mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    ::ng-deep .mat-mdc-progress-spinner {
      margin: 0 auto;
    }
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
