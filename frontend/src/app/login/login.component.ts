import { Component, ChangeDetectionStrategy, EventEmitter, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';
import { AuthService } from '../services';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  form: FormGroup;
  error: string | null = null;
  loading = false;

  @Output() loginSuccess = new EventEmitter<unknown>();

  constructor(private fb: FormBuilder, private authService: AuthService, private router: Router) {
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
