import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MaterialModule } from '../material.module';
import { AccountService, BrandingService } from '../services';
import { User } from '../models';
import { BrandingDialogComponent } from './branding-dialog.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MaterialModule
  ],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css'
})
export class LayoutComponent {
  userId = '';
  userEmail = '';
  user: User | null = null;
  customLogoSrc: string | null = null;
  customPlatformName: string | null = null;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private brandingService = inject(BrandingService);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

  get capitalEnabled(): boolean { return !!this.user?.capital; }
  get bankEnabled(): boolean { return !!this.user?.bank; }
  get issuingEnabled(): boolean { return !!this.user?.issuing; }
  get isEmbeddedPayment(): boolean { return this.user?.activityReason === 'embeddedPayment'; }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.accountService.getUserById(this.userId).subscribe({
          next: (user) => {
            this.user = user;
            this.userEmail = user.email;
            this.cdr.detectChanges();
          },
          error: () => {
            this.user = null;
            this.userEmail = '';
            this.cdr.detectChanges();
          }
        });
        this.loadBranding();
      }
    });
  }

  private loadBranding() {
    this.brandingService.getBranding(this.userId).subscribe(branding => {
      if (branding) {
        this.customPlatformName = branding.platformName || null;
        this.customLogoSrc = branding.logoData || null;
      } else {
        this.customPlatformName = null;
        this.customLogoSrc = null;
      }
      this.cdr.detectChanges();
    });
  }

  openBrandingDialog() {
    const ref = this.dialog.open(BrandingDialogComponent, {
      data: {
        platformName: this.customPlatformName || 'My Platform',
        logoPreview: this.customLogoSrc
      }
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      if (result.action === 'reset') {
        this.brandingService.resetBranding(this.userId).subscribe(() => {
          this.customPlatformName = null;
          this.customLogoSrc = null;
          this.cdr.detectChanges();
        });
      } else if (result.action === 'save') {
        const payload: any = {};
        if (result.platformName) payload.platformName = result.platformName;
        if (result.logoData) {
          payload.logoData = result.logoData;
          payload.logoType = result.logoType;
        }
        this.brandingService.updateBranding(this.userId, payload).subscribe(branding => {
          this.customPlatformName = branding.platformName || null;
          this.customLogoSrc = branding.logoData || null;
          this.cdr.detectChanges();
        });
      }
    });
  }

  signOut() {
    this.router.navigate(['/']);
  }
}
