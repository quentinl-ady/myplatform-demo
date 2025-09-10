import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import {LoginComponent} from "../login/login.component";
import {SignupComponent} from "../signup/signup.component";
import {CommonModule} from "@angular/common";

@Component({
    selector: 'app-main',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, LoginComponent, SignupComponent],
    standalone: true,
    template: `
    <div class="main-container">
      <h1>Welcome to MyPlatform</h1>
      <h2>{{ view() === 'login' ? 'Log in' : 'Sign up' }}</h2>
     <section>
        <app-login *ngIf="view() === 'login'" (loginSuccess)="onAuthSuccess($event)"></app-login>
        <app-signup *ngIf="view() === 'signup'" (signupSuccess)="onAuthSuccess($event)"></app-signup>
      </section>
      <footer class="switch-link">
        <a href="#" (click)="toggleView()">
          {{ view() === 'login' ? "Don't have an account? Sign up" : "Already have an account? Log in" }}
        </a>
      </footer>
    </div>
  `,
    host: {
        class: 'main-root'
    }
})
export class MainComponent {
    readonly view = signal<'login' | 'signup'>('login');

    setView(next: 'login' | 'signup'): void {
        this.view.set(next);
    }

    onAuthSuccess(data: unknown): void {
        console.log('Authentication successful!')
    }

    toggleView(): void {
        this.view.set(this.view() === 'login' ? 'signup' : 'login');
    }
}
