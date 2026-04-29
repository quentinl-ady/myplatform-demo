import {Component} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MaterialModule} from '../material.module';
import {CommonModule} from "@angular/common";
import {
    AdyenPlatformExperience,
    DisputesOverview
} from '@adyen/adyen-platform-experience-web';
import "@adyen/adyen-platform-experience-web/adyen-platform-experience-web.css";
import {SessionService} from "../services";

@Component({
    selector: 'app-dispute',
    standalone: true,
    template: `
    <div id="adyen-component" class="main-container">
      <div id="disputes-overview-container"></div>
    </div>
  `,
    imports: [CommonModule, MaterialModule]
})
export class DisputeComponent {

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
                const sessionToken = await this.sessionService.getDisputeInformation(this.userId).toPromise();
                if (!sessionToken) {
                    throw new Error('Impossible to get dispute information');
                }
                return {
                    token: sessionToken.token,
                    id: sessionToken.id
                };
            }
        });
        const disputesOverview = new DisputesOverview({core});
        disputesOverview.mount('#disputes-overview-container');
    }


}
