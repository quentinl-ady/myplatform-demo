import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { LoginComponent } from '../login/login.component';
import { SignupComponent } from '../signup/signup.component';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';
import { PageTitleStrategy } from '../layout/page-title.strategy';

@Component({
  selector: 'app-main',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, MaterialModule, LoginComponent, SignupComponent],
  template: `
    <main class="fintech-auth-container">
      <mat-card class="fintech-auth-card" [class.wide]="view() === 'signup'">

        <div class="brand-header">
          <div class="logo-mark">
            <img src="assets/logo.svg" alt="My Platform" />
          </div>
        </div>

        <mat-card-header class="auth-header">
          <mat-card-title class="auth-title">
            <h1>{{ view() === 'login' ? 'Welcome back' : 'Create an account' }}</h1>
          </mat-card-title>
          <mat-card-subtitle class="auth-subtitle">
            {{ view() === 'login' ? 'Log in to your account to continue' : 'Set up a test platform account in a few steps' }}
          </mat-card-subtitle>
        </mat-card-header>

        <mat-card-content class="auth-content">
          <app-login *ngIf="view() === 'login'"></app-login>
          <app-signup *ngIf="view() === 'signup'"></app-signup>
        </mat-card-content>

        <mat-card-actions class="auth-actions">
          <span class="switch-text">
            {{ view() === 'login' ? "Don't have an account?" : "Already have an account?" }}
          </span>
          <button type="button" class="switch-link" (click)="toggleView()">
            {{ view() === 'login' ? "Sign up" : "Log in" }}
          </button>
        </mat-card-actions>
      </mat-card>
    </main>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }

    .fintech-auth-container {
      flex: 1 0 auto;
      display: flex;
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
      background-color: var(--fintech-bg);
      padding: 24px;
    }

    .fintech-auth-card {
      width: 100%;
      max-width: 420px;
      box-sizing: border-box;
      padding: 32px 24px;
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04) !important;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .fintech-auth-card.wide {
      max-width: 560px;
    }

    .brand-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 32px;
    }
    .logo-mark {
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-mark img {
      height: 100%;
      width: auto;
      object-fit: contain;
    }

    .auth-header {
      text-align: center;
      margin-bottom: 24px;
      padding: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .auth-title {
      margin-bottom: 8px !important;
    }
    .auth-title h1 {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.25;
      color: var(--fintech-text);
      letter-spacing: -0.5px;
      margin: 0;
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

    .auth-actions {
      margin-top: 24px;
      padding: 0 !important;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }
    .switch-text {
      color: var(--fintech-text-secondary);
    }
    .switch-link {
      cursor: pointer;
      color: var(--fintech-primary);
      font: inherit;
      font-weight: 600;
      background: none;
      border: none;
      padding: 4px;
      border-radius: 4px;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .switch-link:hover {
      opacity: 0.7;
    }

    @media (max-width: 599.98px) {
      .fintech-auth-container {
        padding: 16px;
        align-items: flex-start;
      }
      .fintech-auth-card {
        padding: 24px 16px;
      }
      .brand-header {
        margin-bottom: 24px;
      }
    }
  `]
})
export class MainComponent {
  private titleStrategy = inject(PageTitleStrategy);
  readonly view = signal<'login' | 'signup'>('login');

  toggleView() {
    this.view.set(this.view() === 'login' ? 'signup' : 'login');
    this.titleStrategy.setPageTitle(this.view() === 'login' ? 'Log in' : 'Sign up');
  }
}
