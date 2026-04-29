import {Component} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import { AdyenPlatformExperience, ReportsOverview } from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";

@Component({
    selector: 'app-report',
    standalone: true,
    template: `
    <div id="adyen-component" class="main-container">
      <div id="report-overview-container"></div>
    </div>
  `,
    imports: [CommonModule, MaterialModule]
})
export class ReportComponent {

    userId = '';

    constructor(private route: ActivatedRoute,
                private sessionService: SessionService,
                private matSnackBar: MatSnackBar) {
    }

    ngOnInit() {
        this.route.parent?.paramMap.subscribe(params => {
            this.userId = params.get('id') || '';
            if (this.userId) {
                this.initAdyenComponents();
            }
        });
    }

    private async initAdyenComponents() {
        const core = await AdyenPlatformExperience({
            onSessionCreate: async () => {
                const sessionToken = await this.sessionService.getReportInformation(this.userId).toPromise();
                if (!sessionToken) {
                    throw new Error('Impossible to get report information');
                }
                return {
                    token: sessionToken.token,
                    id: sessionToken.id
                };
            }
        });
        const reportsOverview = new ReportsOverview({core});
        reportsOverview.mount('#report-overview-container');
    }


}
