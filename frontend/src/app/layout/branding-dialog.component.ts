import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { MaterialModule } from '../material.module';
import { UserBranding } from '../models';
import { InlineAlertComponent, httpErrorMessage } from '../shared';

export interface BrandingPayload {
  platformName?: string;
  logoData?: string;
  logoType?: string;
  themeId?: string;
}

export interface BrandingDialogData {
  platformName: string;
  logoPreview: string | null;
  themeId: string | null;
  /** The dialog stays open while these run, so a failure is shown next to the form. */
  save: (payload: BrandingPayload) => Observable<UserBranding>;
  reset: () => Observable<void>;
}

export type BrandingDialogResult = { action: 'saved'; branding: UserBranding } | { action: 'reset' };

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-branding-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, InlineAlertComponent],
  template: `
    <h2 mat-dialog-title>Customize branding</h2>
    <mat-dialog-content class="branding-dialog-content">

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Platform name</mat-label>
        <input matInput [(ngModel)]="platformName" placeholder="My Platform" autocomplete="organization" />
        <mat-hint>Shown in the sidebar and in the browser tab.</mat-hint>
      </mat-form-field>

      <div class="logo-section" role="group" aria-labelledby="branding-logo-label">
        <p class="section-label" id="branding-logo-label">Logo</p>

        <div class="logo-preview" *ngIf="logoPreview">
          <img [src]="logoPreview" alt="Logo preview" (error)="onImageError()" />
        </div>
        <div class="logo-preview default-preview" *ngIf="!logoPreview">
          <img src="assets/logo.svg" alt="Default logo" />
          <span class="default-badge">Default</span>
        </div>
        <p class="error-msg" *ngIf="errorMsg" role="alert">{{ errorMsg }}</p>

        <div class="logo-actions">
          <button mat-stroked-button type="button" class="upload-btn" (click)="fileInput.click()">
            <mat-icon aria-hidden="true">upload</mat-icon> Upload image
          </button>
          <input
            #fileInput
            id="branding-logo-file"
            type="file"
            hidden
            accept="image/*"
            aria-label="Logo image file"
            (change)="onFileSelected($event)" />
          <span class="field-hint">PNG, JPG or SVG, up to 2 MB.</span>

          <div class="url-input-row">
            <mat-form-field appearance="outline" class="url-field">
              <mat-label>Or paste an image URL</mat-label>
              <input
                matInput
                type="url"
                inputmode="url"
                [(ngModel)]="logoUrl"
                placeholder="https://example.com/logo.png"
                (keydown.enter)="$event.preventDefault(); applyUrl()" />
            </mat-form-field>
            <button
              mat-stroked-button
              type="button"
              class="url-btn"
              (click)="applyUrl()"
              [disabled]="!logoUrl || loadingUrl">
              <mat-spinner *ngIf="loadingUrl" diameter="18" aria-label="Loading image"></mat-spinner>
              <span *ngIf="!loadingUrl">Load</span>
            </button>
          </div>
        </div>
      </div>

      <mat-form-field appearance="outline" class="full-width theme-field">
        <mat-label>Hosted onboarding theme ID</mat-label>
        <input matInput [(ngModel)]="themeId" placeholder="e.g. 37a3b051-…" autocomplete="off" />
        <mat-hint>Optional. The ID of your hosted onboarding theme.</mat-hint>
      </mat-form-field>

      <app-inline-alert
        *ngIf="submitError"
        class="submit-error"
        [dismissible]="true"
        (dismiss)="submitError = ''">{{ submitError }}</app-inline-alert>

    </mat-dialog-content>

    <mat-dialog-actions class="branding-actions">
      <button mat-button type="button" class="reset-btn" (click)="onReset()" [disabled]="busy">Reset to default</button>
      <span class="actions-spacer"></span>
      <button mat-stroked-button type="button" class="secondary-btn" mat-dialog-close [disabled]="busy">Cancel</button>
      <button mat-flat-button type="button" class="fintech-btn" (click)="onSave()" [disabled]="loadingUrl || busy">
        {{ busy === 'save' ? 'Saving…' : 'Save branding' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .branding-dialog-content {
      padding-top: 8px !important;
    }
    .full-width {
      width: 100%;
    }
    .section-label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--fintech-text);
      margin: 8px 0;
    }
    .logo-preview {
      min-height: 50px;
      box-sizing: border-box;
      background: var(--fintech-bg);
      border: 1px solid var(--fintech-border);
      border-radius: 8px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      padding: 8px 16px;
      margin-bottom: 12px;
      gap: 8px;
    }
    .logo-preview img {
      height: 36px;
      max-width: 100%;
      width: auto;
      object-fit: contain;
    }
    .default-badge {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--fintech-text-secondary);
      background: var(--fintech-surface-muted);
      padding: 2px 8px;
      border-radius: 4px;
    }
    .logo-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .upload-btn {
      align-self: flex-start;
      border-radius: 24px;
    }
    .field-hint {
      font-size: 0.75rem;
      color: var(--fintech-text-secondary);
    }
    .url-input-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-top: 8px;
    }
    .url-field {
      flex: 1;
      min-width: 0;
    }
    .url-btn {
      min-height: 56px;
      min-width: 72px;
      border-radius: 12px;
    }
    .url-btn mat-spinner {
      margin: 0 auto;
    }
    .theme-field {
      margin-top: 8px;
    }
    .submit-error {
      margin-top: 16px;
    }
    .error-msg {
      color: var(--fintech-danger);
      font-size: 0.8125rem;
      margin: -4px 0 12px 0;
    }
    .branding-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 24px 20px !important;
    }
    .actions-spacer {
      flex: 1 1 auto;
    }
    .reset-btn {
      color: var(--fintech-danger) !important;
      margin-left: -8px;
    }
    .secondary-btn {
      border-radius: 24px !important;
    }
    .fintech-btn {
      border-radius: 24px !important;
      padding: 0 24px !important;
      background-color: var(--fintech-primary) !important;
      color: var(--fintech-on-primary) !important;
      font-weight: 600 !important;
    }
    .fintech-btn[disabled] {
      background-color: var(--fintech-surface-muted) !important;
      color: var(--fintech-text-secondary) !important;
    }
    .reset-btn[disabled] {
      color: var(--fintech-text-secondary) !important;
    }
  `]
})
export class BrandingDialogComponent implements OnInit {
  private dialogRef: MatDialogRef<BrandingDialogComponent, BrandingDialogResult> = inject(MatDialogRef);
  private data: BrandingDialogData = inject(MAT_DIALOG_DATA);

  platformName: string = '';
  logoPreview: string | null = null;
  logoUrl: string = '';
  logoData: string | null = null;
  logoType: string | null = null;
  themeId: string = '';
  errorMsg: string = '';
  loadingUrl: boolean = false;
  busy: 'save' | 'reset' | null = null;
  submitError = '';

  ngOnInit() {
    this.platformName = this.data.platformName || '';
    this.logoPreview = this.data.logoPreview || null;
    this.themeId = this.data.themeId || '';
    if (this.logoPreview) {
      this.logoData = this.logoPreview;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    // Reset so selecting the same file again still fires (change).
    input.value = '';
    this.errorMsg = '';
    if (!file.type.startsWith('image/')) {
      this.errorMsg = 'This file isn\'t an image. Choose a PNG, JPG or SVG file.';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      this.errorMsg = 'This image is larger than 2 MB. Choose a smaller file.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.setLogo(reader.result as string);
    reader.onerror = () => {
      this.errorMsg = 'This file can\'t be read. Try another image.';
    };
    reader.readAsDataURL(file);
  }

  applyUrl() {
    const url = this.logoUrl.trim();
    if (!url || this.loadingUrl) return;
    this.errorMsg = '';
    this.loadingUrl = true;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(blob => {
        if (blob.type && !blob.type.startsWith('image/')) {
          throw new Error('NOT_IMAGE');
        }
        const reader = new FileReader();
        reader.onload = () => {
          this.setLogo(reader.result as string);
          this.loadingUrl = false;
        };
        reader.onerror = () => {
          this.errorMsg = 'This image can\'t be read. Download it and use "Upload image" instead.';
          this.loadingUrl = false;
        };
        reader.readAsDataURL(blob);
      })
      .catch((err: Error) => {
        this.errorMsg = err?.message === 'NOT_IMAGE'
          ? 'This URL doesn\'t point to an image. Check the address or use "Upload image" instead.'
          : 'This URL can\'t be loaded (the site probably blocks downloads). Download the image and use "Upload image" instead.';
        this.loadingUrl = false;
      });
  }

  onImageError() {
    this.errorMsg = 'This image couldn\'t be displayed. Try uploading a file from your computer.';
    this.logoPreview = null;
    this.logoData = null;
    this.logoType = null;
  }

  private setLogo(base64: string) {
    this.logoPreview = base64;
    this.logoData = base64;
    this.logoType = 'base64';
  }

  onSave() {
    if (this.busy) return;
    const payload: BrandingPayload = {};
    const platformName = this.platformName.trim();
    if (platformName) payload.platformName = platformName;
    if (this.logoData) {
      payload.logoData = this.logoData;
      payload.logoType = this.logoType as string;
    }
    payload.themeId = this.themeId.trim();
    this.run('save', this.data.save(payload), 'Unable to save the branding. Try again.',
      branding => ({ action: 'saved', branding }));
  }

  onReset() {
    if (this.busy) return;
    this.run('reset', this.data.reset(), 'Unable to reset the branding. Try again.',
      () => ({ action: 'reset' }));
  }

  private run<T>(kind: 'save' | 'reset', request: Observable<T>, fallback: string,
                 result: (value: T) => BrandingDialogResult) {
    this.busy = kind;
    this.submitError = '';
    this.dialogRef.disableClose = true;
    request.subscribe({
      next: (value) => {
        this.busy = null;
        this.dialogRef.disableClose = false;
        this.dialogRef.close(result(value));
      },
      error: (err) => {
        this.busy = null;
        this.dialogRef.disableClose = false;
        this.submitError = httpErrorMessage(err, fallback);
      }
    });
  }
}
