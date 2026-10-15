import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportsOverview } from '@adyen/adyen-platform-experience-web';
import '@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css';
import { MaterialModule } from '../material.module';
import { SessionService } from '../services';
import { PlatformExperienceCore, PlatformExperiencePage } from './platform-experience';

@Component({
  selector: 'app-report',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: './platform-page.html',
  styleUrl: './platform-page.css'
})
export class ReportComponent extends PlatformExperiencePage {
  private sessionService = inject(SessionService);

  readonly pageTitle = 'Reports';
  readonly pageDescription = 'Download and review your financial reports.';
  readonly itemLabel = 'reports';
  readonly containerId = 'report-overview-container';
  protected readonly errorFallback = 'We could not open a reporting session with Adyen. Please try again.';

  protected requestSession(userId: string) {
    return this.sessionService.getReportInformation(userId);
  }

  protected createComponent(core: PlatformExperienceCore) {
    return new ReportsOverview({ core });
  }
}
