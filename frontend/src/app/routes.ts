import { Routes } from '@angular/router';
import {LoginComponent} from "./login/login.component";
import {MainComponent} from "./main/main.component";
import {DashboardComponent} from "./dashboard/dashboard.component";
import {LayoutComponent} from "./layout/layout.component";
import {PaymentComponent} from "./payment/payment.component";
import {ReportComponent} from "./report/report.component";
import {PayoutComponent} from "./payout/payout.component";
import {DisputeComponent} from "./dispute/dispute.component";
import {BusinessLoansComponent} from "./business-loans/business-loans.component";

const routeConfig: Routes = [
  {
    path: '',
    component: MainComponent,
    title: 'Homepage'
  },
  {
    path: 'login',
    component: LoginComponent,
    title: 'Login'
  },
  {
    path: ':id',
    component: LayoutComponent,
    children: [
      {
        path: 'dashboard',
        component: DashboardComponent,
        title: 'Dashboard'
      },
      {
        path: 'payment',
        component: PaymentComponent,
        title: 'Payment'
      },
      {
        path: 'report',
        component: ReportComponent,
        title: 'Report'
      },
      {
        path: 'payout',
        component: PayoutComponent,
        title: 'Payout'
      },
      {
        path: 'dispute',
        component: DisputeComponent,
        title: 'Dispute'
      },
      {
        path: 'businessloans',
        component: BusinessLoansComponent,
        title: 'BusinessLoans'
      }
    ]
  }

];

export default routeConfig;
