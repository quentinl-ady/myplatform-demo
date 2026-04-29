import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material.module';
import { AccountService } from '../services';

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
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private cdr = inject(ChangeDetectorRef);

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.accountService.getUserById(Number(this.userId)).subscribe({
          next: (user) => {
            this.userEmail = user.email;
            this.cdr.detectChanges();
          },
          error: () => {
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
