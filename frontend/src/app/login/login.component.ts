import { Component, ChangeDetectionStrategy, ChangeDetectorRef, EventEmitter, Output, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';
import { AuthService } from '../services';
import { httpErrorMessage, httpStatus } from '../shared';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  readonly form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });
  error: string | null = null;
  loading = false;
  showPassword = false;

  @Output() loginSuccess = new EventEmitter<unknown>();

  emailError(): string | null {
    const c = this.form.get('email');
    if (!c || !c.invalid || !(c.dirty || c.touched)) return null;
    return c.hasError('required') ? 'Enter your email address.' : 'Enter a valid email address.';
  }

  passwordInvalid(): boolean {
    const c = this.form.get('password');
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  onSubmit() {
    if (this.loading) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    this.error = null;

    this.authService.login(this.form.value).subscribe({
      next: (res) => {
        if (res?.id) {
          this.loginSuccess.emit(res);
          this.router.navigate([`/${res.id}/dashboard`]);
        } else {
          this.loading = false;
          this.error = 'We couldn\'t log you in. Please try again.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.error = httpStatus(err) === 401
          ? 'Incorrect email or password'
          : httpErrorMessage(err, 'We couldn\'t log you in. Please try again.');
        this.cdr.markForCheck();
      }
    });
  }
}
