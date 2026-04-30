import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';
import { AccountService } from '../services';
import { User } from '../models';

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
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private cdr = inject(ChangeDetectorRef);

  get capitalEnabled(): boolean { return !!this.user?.capital; }
  get bankEnabled(): boolean { return !!this.user?.bank; }
  get issuingEnabled(): boolean { return !!this.user?.issuing; }
  get isEmbeddedPayment(): boolean { return this.user?.activityReason === 'embeddedPayment'; }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.accountService.getUserById(Number(this.userId)).subscribe({
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
      }
    });
  }

  signOut() {
    this.router.navigate(['/']);
  }
}
