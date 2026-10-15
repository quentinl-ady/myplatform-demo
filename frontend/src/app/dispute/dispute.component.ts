import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DisputesOverview } from '@adyen/adyen-platform-experience-web';
import '@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css';
import { MaterialModule } from '../material.module';
import { SessionService } from '../services';
import { PlatformExperienceCore, PlatformExperiencePage } from '../report/platform-experience';

@Component({
  selector: 'app-dispute',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: '../report/platform-page.html',
  styleUrl: '../report/platform-page.css'
})
export class DisputeComponent extends PlatformExperiencePage {
  private sessionService = inject(SessionService);

  readonly pageTitle = 'Disputes';
  readonly pageDescription = 'Track chargebacks and respond to disputes.';
  readonly itemLabel = 'disputes';
  readonly containerId = 'disputes-overview-container';
  protected readonly errorFallback = 'We could not open a disputes session with Adyen. Please try again.';

  protected requestSession(userId: string) {
    return this.sessionService.getDisputeInformation(userId);
  }

  protected createComponent(core: PlatformExperienceCore) {
    return new DisputesOverview({ core });
  }
}
