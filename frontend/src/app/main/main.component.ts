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
    <div class="main-container">
      <mat-card class="auth-card">
        <mat-card-header>
          <mat-card-title>Welcome to MyPlatform</mat-card-title>
          <mat-card-subtitle>{{ view() === 'login' ? 'Log in to continue' : 'Create your account' }}</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <app-login *ngIf="view() === 'login'" (loginSuccess)="onAuthSuccess($event)"></app-login>
          <app-signup *ngIf="view() === 'signup'" (signupSuccess)="onAuthSuccess($event)"></app-signup>
        </mat-card-content>

        <mat-card-actions class="switch-link">
          <a class="link-button" (click)="toggleView()">
            {{ view() === 'login' ? "Don't have an account? Sign up" : "Already have an account? Log in" }}
          </a>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
    styles: [`
    .main-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #e0f7fa, #80deea);
      padding: 1rem;
    }
    .auth-card {
      width: 100%;
      max-width: 450px;
      padding: 2rem;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    }
    mat-card-header { text-align: center; margin-bottom: 1rem; }
    .switch-link { justify-content: center; text-align: center; margin-top: 1rem; }
    .link-button { cursor: pointer; color: #1976d2; text-decoration: underline; font-weight: 500; }
  `]
})
export class MainComponent {
    readonly view = signal<'login' | 'signup'>('login');

    onAuthSuccess(data: unknown) { console.log('Authentication successful!', data); }
    toggleView() { this.view.set(this.view() === 'login' ? 'signup' : 'login'); }
}
