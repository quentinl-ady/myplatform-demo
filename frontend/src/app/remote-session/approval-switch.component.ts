import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ApprovalMode, currentDeviceKind } from '../shared';

/** Offers the other way to approve, when the account has a trusted device for each. */
@Component({
  selector: 'app-approval-switch',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <button type="button" class="switch-btn" [disabled]="disabled" (click)="switchTo.emit(other)">
      <mat-icon aria-hidden="true">{{ other === 'phone' ? 'smartphone' : 'fingerprint' }}</mat-icon>
      {{ other === 'phone' ? 'Approve on your phone instead' : 'Approve on this ' + thisName + ' instead' }}
    </button>
  `,
  styles: [`
    :host {
      display: flex;
      justify-content: center;
      margin-top: 8px;
    }
    .switch-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: none;
      padding: 4px 8px;
      font: inherit;
      font-size: 0.8125rem;
      color: var(--fintech-text-secondary);
      cursor: pointer;
      border-radius: 8px;
    }
    .switch-btn:hover:not(:disabled) { color: var(--fintech-text); background: var(--fintech-bg); }
    .switch-btn:disabled { cursor: not-allowed; color: var(--fintech-text-tertiary); }
    .switch-btn mat-icon { font-size: 1rem; width: 1rem; height: 1rem; flex-shrink: 0; }
    @media (pointer: coarse) {
      .switch-btn { min-height: 44px; }
    }
  `]
})
export class ApprovalSwitchComponent {
  @Input({ required: true }) mode!: ApprovalMode;
  @Input() disabled = false;
  @Output() readonly switchTo = new EventEmitter<ApprovalMode>();

  readonly thisName = currentDeviceKind();

  get other(): ApprovalMode {
    return this.mode === 'phone' ? 'here' : 'phone';
  }
}
