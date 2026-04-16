import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { LoginComponent } from '../login/login.component';
import { SignupComponent } from '../signup/signup.component';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';

@Component({
  selector: 'app-main',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, MaterialModule, LoginComponent, SignupComponent],
  template: `
    <div class="fintech-auth-container">
      <mat-card class="fintech-auth-card">

        <div class="brand-header">
          <div class="logo-mark">
            <img src="https://tvadvertising.co.uk/wp-content/uploads/2024/01/5_image.png" alt="Logo Treatwell"/>
          </div>
          <span class="brand-name">Treatwell</span>
        </div>

        <mat-card-header class="auth-header">
          <mat-card-title class="auth-title">
            {{ view() === 'login' ? 'Welcome back' : 'Create an account' }}
          </mat-card-title>
          <mat-card-subtitle class="auth-subtitle">
            {{ view() === 'login' ? 'Log in to your account to continue' : 'Sign up to get started with Treatwell' }}
          </mat-card-subtitle>
        </mat-card-header>

        <mat-card-content class="auth-content">
          <app-login *ngIf="view() === 'login'" (loginSuccess)="onAuthSuccess($event)"></app-login>
          <app-signup *ngIf="view() === 'signup'" (signupSuccess)="onAuthSuccess($event)"></app-signup>
        </mat-card-content>

        <mat-card-actions class="auth-actions">
          <span class="switch-text">
            {{ view() === 'login' ? "Don't have an account?" : "Already have an account?" }}
          </span>
          <a class="switch-link" (click)="toggleView()">
            {{ view() === 'login' ? "Sign up" : "Log in" }}
          </a>
        </mat-card-actions>
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: block;
    }

    .fintech-auth-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background-color: var(--fintech-bg);
      padding: 24px;
    }

    .fintech-auth-card {
      width: 100%;
      max-width: 420px;
      padding: 32px 24px;
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04) !important;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* --- BRAND LOGO --- */
    .brand-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin-bottom: 32px;
    }
    .logo-mark {
      width: 48px;
      height: 48px;
      background-color: var(--fintech-primary);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .logo-mark img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .brand-name {
      font-size: 20px;
      font-weight: 700;
      color: var(--fintech-text);
      letter-spacing: -0.5px;
    }

    /* --- HEADERS --- */
    .auth-header {
      text-align: center;
      margin-bottom: 24px;
      padding: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .auth-title {
      font-size: 24px !important;
      font-weight: 700 !important;
      color: var(--fintech-text);
      margin-bottom: 8px !important;
      letter-spacing: -0.5px;
    }
    .auth-subtitle {
      font-size: 14px !important;
      color: var(--fintech-text-secondary);
      margin: 0 !important;
    }

    .auth-content {
      width: 100%;
      padding: 0 !important;
    }

    /* --- FOOTER / SWITCH --- */
    .auth-actions {
      margin-top: 24px;
      padding: 0 !important;
      display: flex;
      justify-content: center;
      gap: 6px;
      font-size: 14px;
    }
    .switch-text {
      color: var(--fintech-text-secondary);
    }
    .switch-link {
      cursor: pointer;
      color: var(--fintech-primary);
      font-weight: 600;
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .switch-link:hover {
      opacity: 0.7;
    }
  `]
})
export class MainComponent {
  readonly view = signal<'login' | 'signup'>('login');

  onAuthSuccess(data: unknown) {
    console.log('Authentication successful!', data);
  }

  toggleView() {
    this.view.set(this.view() === 'login' ? 'signup' : 'login');
  }
}
