import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CapitalOverview } from '@adyen/adyen-platform-experience-web';
import '@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css';
import { MaterialModule } from '../material.module';
import { SessionService } from '../services';
import { MountableComponent, PlatformExperienceCore, PlatformExperiencePage } from '../report/platform-experience';

@Component({
  selector: 'app-business-loans',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: '../report/platform-page.html',
  styleUrl: '../report/platform-page.css'
})
export class BusinessLoansComponent extends PlatformExperiencePage {
  private sessionService = inject(SessionService);

  readonly pageTitle = 'Loans';
  readonly pageDescription = 'See your business financing offers and follow your active loans.';
  readonly itemLabel = 'loans';
  readonly containerId = 'capital-overview-container';
  protected readonly errorFallback = 'We could not open a loans session with Adyen. Please try again.';

  protected requestSession(userId: string) {
    return this.sessionService.getBusinessLoans(userId);
  }

  protected createComponent(core: PlatformExperienceCore): MountableComponent {
    return new CapitalOverview({ core }) as unknown as MountableComponent;
  }
}
