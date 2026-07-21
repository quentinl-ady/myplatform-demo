import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MaterialModule } from '../material.module';

export interface BrandingDialogData {
  platformName: string;
  logoPreview: string | null;
  themeId: string | null;
}

@Component({
  selector: 'app-branding-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  template: `
    <h2 mat-dialog-title>Customize Branding</h2>
    <mat-dialog-content class="branding-dialog-content">

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Platform Name</mat-label>
        <input matInput [(ngModel)]="platformName" placeholder="My Platform" />
      </mat-form-field>

      <div class="logo-section">
        <p class="section-label">Logo</p>

        <div class="logo-preview" *ngIf="logoPreview">
          <img [src]="logoPreview" alt="Logo preview" (error)="onImageError()" />
        </div>
        <p class="error-msg" *ngIf="errorMsg">{{ errorMsg }}</p>
        <div class="logo-preview default-preview" *ngIf="!logoPreview">
          <img src="assets/logo.svg" alt="Default logo" />
          <span class="default-badge">Default</span>
        </div>

        <div class="logo-actions">
          <button mat-stroked-button type="button" (click)="fileInput.click()">
            <mat-icon>upload</mat-icon> Upload Image
          </button>
          <input #fileInput type="file" hidden accept="image/*" (change)="onFileSelected($event)" />

          <div class="url-input-row">
            <mat-form-field appearance="outline" class="url-field">
              <mat-label>Or paste image URL</mat-label>
              <input matInput [(ngModel)]="logoUrl" placeholder="https://example.com/logo.png" />
            </mat-form-field>
            <button mat-stroked-button type="button" (click)="applyUrl()" [disabled]="!logoUrl || loadingUrl">
              <mat-icon>{{ loadingUrl ? 'hourglass_empty' : 'link' }}</mat-icon>
            </button>
          </div>
        </div>
      </div>

      <mat-form-field appearance="outline" class="full-width" style="margin-top: 16px;">
        <mat-label>Hosted Onboarding Theme ID</mat-label>
        <input matInput [(ngModel)]="themeId" placeholder="e.g. 37a3b051-..." />
        <mat-hint>Optional. The unique identifier of your hosted onboarding theme.</mat-hint>
      </mat-form-field>

    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onReset()" color="warn">Reset to Default</button>
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="onSave()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .branding-dialog-content {
      min-width: 400px;
      padding-top: 8px !important;
    }
    .full-width {
      width: 100%;
    }
    .section-label {
      font-size: 13px;
      font-weight: 600;
      color: #555;
      margin-bottom: 8px;
    }
    .logo-preview {
      height: 50px;
      background: #f5f6f8;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      display: flex;
      align-items: center;
      padding: 8px 16px;
      margin-bottom: 12px;
      gap: 8px;
    }
    .logo-preview img {
      height: 36px;
      width: auto;
      object-fit: contain;
    }
    .default-badge {
      font-size: 11px;
      color: #999;
      background: #eee;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .logo-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .url-input-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .url-field {
      flex: 1;
    }
    .error-msg {
      color: #dc2626;
      font-size: 12px;
      margin: -8px 0 8px 0;
    }
  `]
})
export class BrandingDialogComponent {
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
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      this.logoPreview = base64;
      this.logoData = base64;
      this.logoType = 'base64';
    };
    reader.readAsDataURL(file);
  }

  applyUrl() {
    if (!this.logoUrl) return;
    this.errorMsg = '';
    this.loadingUrl = true;
    fetch(this.logoUrl)
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          this.logoPreview = base64;
          this.logoData = base64;
          this.logoType = 'base64';
          this.loadingUrl = false;
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {
        this.errorMsg = 'Impossible de charger cette URL (le site bloque probablement le téléchargement). Téléchargez l\'image localement puis utilisez "Upload Image".';
        this.loadingUrl = false;
      });
  }

  onImageError() {
    this.errorMsg = 'L\'image n\'a pas pu être chargée. Essayez d\'uploader un fichier local.';
    this.logoPreview = null;
  }

  onSave() {
    this.dialogRef.close({
      action: 'save',
      platformName: this.platformName,
      logoData: this.logoData,
      logoType: this.logoType,
      themeId: this.themeId
    });
  }

  onReset() {
    this.dialogRef.close({ action: 'reset' });
  }
}
