import { Component, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

export interface ConfirmDialogDetail {
  label: string;
  value: string;
}

export interface ConfirmDialogData {
  title: string;
  message?: string;
  /** Optional recap rows (amount, beneficiary...) shown under the message. */
  details?: ConfirmDialogDetail[];
  confirmText?: string;
  cancelText?: string;
  /** Destructive action: red confirm button and initial focus on Cancel. */
  danger?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title class="confirm-title">{{ data.title }}</h2>
    <mat-dialog-content class="confirm-content">
      <p class="confirm-message" *ngIf="data.message">{{ data.message }}</p>
      <dl class="confirm-details" *ngIf="data.details?.length">
        <div class="confirm-row" *ngFor="let row of data.details">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="confirm-actions">
      <button type="button" class="confirm-btn secondary confirm-cancel" [mat-dialog-close]="false">
        {{ data.cancelText || 'Cancel' }}
      </button>
      <button type="button" class="confirm-btn confirm-ok" [class.danger]="data.danger" [mat-dialog-close]="true">
        {{ data.confirmText || 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .confirm-title {
      font-family: var(--fintech-font);
      font-weight: 700;
      color: var(--fintech-text);
    }
    .confirm-message {
      margin: 0 0 12px;
      color: var(--fintech-text-secondary);
      line-height: 1.5;
    }
    .confirm-details {
      margin: 0;
      padding: 12px 16px;
      background: var(--fintech-bg);
      border-radius: 12px;
    }
    .confirm-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 0;
    }
    .confirm-row + .confirm-row {
      border-top: 1px solid var(--fintech-border);
    }
    .confirm-row dt {
      color: var(--fintech-text-secondary);
    }
    .confirm-row dd {
      margin: 0;
      font-weight: 600;
      color: var(--fintech-text);
      text-align: right;
      word-break: break-word;
    }
    .confirm-actions {
      gap: 8px;
      padding: 8px 24px 20px;
    }
    .confirm-btn {
      border: none;
      border-radius: 24px;
      padding: 10px 24px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      background: var(--fintech-primary);
      color: #fff;
    }
    .confirm-btn.secondary {
      background: var(--fintech-bg);
      color: var(--fintech-text);
    }
    .confirm-btn.danger {
      background: var(--fintech-danger);
    }
  `]
})
export class ConfirmDialogComponent {
  readonly data: ConfirmDialogData = inject(MAT_DIALOG_DATA);
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  /** Resolves to true only when the user explicitly confirms. */
  confirm(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      data,
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: data.danger ? '.confirm-cancel' : '.confirm-ok',
      restoreFocus: true,
    });
    return firstValueFrom(ref.afterClosed()).then(result => result === true);
  }
}
