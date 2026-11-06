import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

export type InlineAlertKind = 'error' | 'warning' | 'info' | 'success';

const ICONS: Record<InlineAlertKind, string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  success: 'check_circle',
};

/**
 * Message shown next to the content it is about, so it stays on screen until
 * the problem is fixed instead of disappearing like a snack bar.
 * Errors are announced at once (role="alert"), other kinds politely
 * (role="status"). Set [live]="false" for a message that is part of the page
 * from the start and should not be announced.
 *
 *   <app-inline-alert *ngIf="error()" [title]="'Unable to load cards'"
 *                     actionLabel="Try again" (action)="load()">{{ error() }}</app-inline-alert>
 */
@Component({
  selector: 'app-inline-alert',
  standalone: true,
  imports: [NgIf, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="inline-alert" [class]="kind" [attr.role]="live ? (kind === 'error' ? 'alert' : 'status') : null">
      <mat-icon class="inline-alert-icon" aria-hidden="true">{{ icon }}</mat-icon>
      <div class="inline-alert-body">
        <p class="inline-alert-title" *ngIf="title">{{ title }}</p>
        <div class="inline-alert-message"><ng-content></ng-content></div>
      </div>
      <div class="inline-alert-actions" *ngIf="actionLabel || dismissible">
        <button type="button" class="inline-alert-action" *ngIf="actionLabel" (click)="action.emit()">{{ actionLabel }}</button>
        <button type="button" class="inline-alert-dismiss" *ngIf="dismissible" aria-label="Dismiss" (click)="dismiss.emit()">
          <mat-icon aria-hidden="true">close</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .inline-alert {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid var(--alert-border);
      background: var(--alert-bg);
      color: var(--fintech-text);
      font-size: 0.875rem;
      line-height: 1.45;
      text-align: left;
    }
    .inline-alert.error { --alert-bg: var(--fintech-danger-bg); --alert-border: var(--fintech-danger-border); --alert-accent: var(--fintech-danger); }
    .inline-alert.warning { --alert-bg: var(--fintech-warning-bg); --alert-border: var(--fintech-warning-border); --alert-accent: var(--fintech-warning); }
    .inline-alert.info { --alert-bg: var(--fintech-info-bg); --alert-border: var(--fintech-info-border); --alert-accent: var(--fintech-info); }
    .inline-alert.success { --alert-bg: var(--fintech-success-bg); --alert-border: var(--fintech-success-border); --alert-accent: var(--fintech-success); }
    .inline-alert-icon {
      flex: none;
      width: 1.25rem;
      height: 1.25rem;
      font-size: 1.25rem;
      color: var(--alert-accent);
    }
    .inline-alert-body { flex: 1; min-width: 0; }
    .inline-alert-title { margin: 0 0 2px; font-weight: 600; }
    .inline-alert-message { overflow-wrap: anywhere; }
    .inline-alert-actions {
      flex: none;
      display: flex;
      align-items: center;
      gap: 4px;
      margin: -6px -8px -6px 0;
    }
    .inline-alert-action,
    .inline-alert-dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      border: none;
      background: none;
      font: inherit;
      cursor: pointer;
    }
    .inline-alert-action {
      padding: 4px 8px;
      border-radius: 8px;
      font-weight: 600;
      color: var(--alert-accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .inline-alert-dismiss {
      min-width: 32px;
      border-radius: 50%;
      color: var(--fintech-text-secondary);
    }
    .inline-alert-dismiss mat-icon { width: 1.25rem; height: 1.25rem; font-size: 1.25rem; }
    @media (pointer: coarse) {
      .inline-alert-action,
      .inline-alert-dismiss { min-height: 44px; min-width: 44px; }
    }
    @media (forced-colors: active) {
      .inline-alert { border-color: CanvasText; }
    }
  `],
})
export class InlineAlertComponent {
  @Input() kind: InlineAlertKind = 'error';
  @Input() title = '';
  /** Label of an optional recovery action, for example "Try again". */
  @Input() actionLabel = '';
  @Input() dismissible = false;
  @Input() live = true;
  @Output() readonly action = new EventEmitter<void>();
  @Output() readonly dismiss = new EventEmitter<void>();

  get icon(): string {
    return ICONS[this.kind] ?? ICONS.error;
  }
}
