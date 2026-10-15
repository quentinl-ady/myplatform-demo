import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { httpStatus } from '../shared';

export type LoadState = 'loading' | 'ready' | 'missing' | 'error';

/** The backend answers 404 on the bank and device endpoints until the business bank account exists. */
export function failedLoadState(err: unknown): 'missing' | 'error' {
  return httpStatus(err) === 404 ? 'missing' : 'error';
}

/** Combined state of several loads: a missing account wins over an error, an error over loading. */
export function combineLoadStates(...states: LoadState[]): LoadState {
  if (states.includes('missing')) return 'missing';
  if (states.includes('error')) return 'error';
  if (states.includes('loading')) return 'loading';
  return 'ready';
}

@Component({
  selector: 'app-account-setup-state',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="state-card" *ngIf="state === 'loading'" role="status">
      <mat-spinner diameter="32"></mat-spinner>
      <p class="state-text">{{ loadingText }}</p>
    </div>

    <div class="state-card" *ngIf="state === 'missing'">
      <div class="state-icon" aria-hidden="true"><mat-icon>account_balance</mat-icon></div>
      <h2 class="state-title">Your business bank account isn't set up yet</h2>
      <p class="state-text">Create it from the Onboarding page, then come back here to {{ purpose }}.</p>
      <a class="state-btn" [routerLink]="['/', userId, 'dashboard']">Go to Onboarding</a>
    </div>

    <div class="state-card" *ngIf="state === 'error'" role="alert">
      <div class="state-icon error" aria-hidden="true"><mat-icon>error_outline</mat-icon></div>
      <h2 class="state-title">Couldn't load your account</h2>
      <p class="state-text">{{ message || 'Something went wrong. Try again.' }}</p>
      <button type="button" class="state-btn" (click)="retry.emit()">Retry</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .state-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      text-align: center;
      padding: 48px 24px;
      background: var(--fintech-surface);
      border-radius: var(--fintech-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
    }
    .state-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--fintech-bg);
      color: var(--fintech-text-secondary);
    }
    .state-icon.error { background: var(--fintech-danger-bg); color: var(--fintech-danger); }
    .state-icon mat-icon { font-size: 32px; width: 32px; height: 32px; }
    .state-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--fintech-text); }
    .state-text { margin: 0; max-width: 420px; font-size: 14px; line-height: 1.5; color: var(--fintech-text-secondary); }
    .state-btn {
      margin-top: 8px;
      border: none;
      border-radius: 24px;
      padding: 10px 24px;
      font: inherit;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      background: var(--fintech-primary);
      color: #fff;
    }
  `]
})
export class AccountSetupStateComponent {
  @Input() state: LoadState = 'loading';
  @Input() userId = '';
  @Input() message = '';
  @Input() loadingText = 'Loading your account...';
  /** End of "come back here to …", e.g. "make transfers". */
  @Input() purpose = 'use this page';
  @Output() retry = new EventEmitter<void>();
}
