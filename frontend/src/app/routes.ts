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
import {StoreComponent} from "./store/store.component";
import {CheckoutComponent} from "./checkout/checkout.component";
import {PaymentResultComponent} from "./result/paymentresult.component";
import {PayByLinkComponent} from "./paybylink/paybylink.component";
import {DeviceComponent} from "./device/device.component";
import {TransferComponent} from "./transfer/transfer.component"
import {PosComponent} from "./pos/pos.component"

const routeConfig: Routes = [
  {
    path: '',
    component: MainComponent,
    title: 'Homepage'
  },
  {
    path: 'result/:status',
    component: PaymentResultComponent
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
      },
      {
        path: 'store',
        component: StoreComponent,
        title: 'Store'
      },
      {
        path: 'checkout',
        component: CheckoutComponent,
        title: 'Checkout'
      },
      {
         path: 'paybylink',
         component: PayByLinkComponent,
         title: 'Pay-by-Link'
      },
      {
        path: 'device',
        component: DeviceComponent,
        title: 'Device'
      },
      {
        path: 'transfer',
        component: TransferComponent,
        title: 'Transfer'
      },
      {
        path: 'pos',
        component: PosComponent,
        title: 'Transfer'
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/'
  }

];

export default routeConfig;
