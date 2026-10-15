import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MaterialModule } from '../material.module';

export interface BrandingDialogData {
  platformName: string;
  logoPreview: string | null;
  themeId: string | null;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-branding-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
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
        <input matInput [(ngModel)]="themeId" placeholder="e.g. 37a3b051-..." autocomplete="off" />
        <mat-hint>Optional. The ID of your hosted onboarding theme.</mat-hint>
      </mat-form-field>

    </mat-dialog-content>

    <mat-dialog-actions class="branding-actions">
      <button mat-button type="button" class="reset-btn" (click)="onReset()">Reset to default</button>
      <span class="actions-spacer"></span>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" class="fintech-btn" (click)="onSave()" [disabled]="loadingUrl">Save</button>
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
      font-size: 13px;
      font-weight: 600;
      color: var(--fintech-text);
      margin: 8px 0;
    }
    .logo-preview {
      height: 50px;
      background: var(--fintech-bg);
      border: 1px solid var(--fintech-border);
      border-radius: 8px;
      display: flex;
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
      font-size: 11px;
      color: var(--fintech-text-secondary);
      background: #eeeeee;
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
      font-size: 12px;
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
      height: 56px;
      min-width: 72px;
      border-radius: 12px;
    }
    .url-btn mat-spinner {
      margin: 0 auto;
    }
    .theme-field {
      margin-top: 8px;
    }
    .error-msg {
      color: var(--fintech-danger);
      font-size: 13px;
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
    .fintech-btn {
      border-radius: 24px !important;
      padding: 0 24px !important;
      background-color: var(--fintech-primary) !important;
      color: #ffffff !important;
      font-weight: 600 !important;
    }
    .fintech-btn[disabled] {
      background-color: #e5e5e5 !important;
      color: #a3a3a3 !important;
    }
  `]
})
export class BrandingDialogComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<BrandingDialogComponent>);
  private data: BrandingDialogData = inject(MAT_DIALOG_DATA);

  platformName: string = '';
  logoPreview: string | null = null;
  logoUrl: string = '';
  logoData: string | null = null;
  logoType: string | null = null;
  themeId: string = '';
  errorMsg: string = '';
  loadingUrl: boolean = false;

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
      this.errorMsg = 'We couldn\'t read this file. Try another image.';
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
          this.errorMsg = 'We couldn\'t read this image. Download it and use "Upload image" instead.';
          this.loadingUrl = false;
        };
        reader.readAsDataURL(blob);
      })
      .catch((err: Error) => {
        this.errorMsg = err?.message === 'NOT_IMAGE'
          ? 'This URL doesn\'t point to an image.'
          : 'We couldn\'t load this URL (the site probably blocks downloads). Download the image and use "Upload image" instead.';
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
    this.dialogRef.close({
      action: 'save',
      platformName: this.platformName.trim(),
      logoData: this.logoData,
      logoType: this.logoType,
      themeId: this.themeId.trim()
    });
  }

  onReset() {
    this.dialogRef.close({ action: 'reset' });
  }
}
