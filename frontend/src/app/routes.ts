import { Routes } from '@angular/router';
import {LayoutComponent} from "./layout/layout.component";

const routeConfig: Routes = [
  {
    path: '',
    loadComponent: () => import('./main/main.component').then(m => m.MainComponent),
    title: 'Homepage'
  },
  {
    path: 'result/:status',
    loadComponent: () => import('./result/paymentresult.component').then(m => m.PaymentResultComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    title: 'Login'
  },
  {
    path: ':id',
    component: LayoutComponent,
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
        title: 'Dashboard'
      },
      {
        path: 'transactions',
        loadComponent: () => import('./payment/payment.component').then(m => m.PaymentComponent),
        title: 'Transactions'
      },
      {
        path: 'report',
        loadComponent: () => import('./report/report.component').then(m => m.ReportComponent),
        title: 'Report'
      },
      {
        path: 'payout',
        loadComponent: () => import('./payout/payout.component').then(m => m.PayoutComponent),
        title: 'Payout'
      },
      {
        path: 'dispute',
        loadComponent: () => import('./dispute/dispute.component').then(m => m.DisputeComponent),
        title: 'Dispute'
      },
      {
        path: 'businessloans',
        loadComponent: () => import('./business-loans/business-loans.component').then(m => m.BusinessLoansComponent),
        title: 'Loans'
      },
      {
        path: 'store',
        loadComponent: () => import('./store/store.component').then(m => m.StoreComponent),
        title: 'Store'
      },
      {
        path: 'checkout',
        loadComponent: () => import('./checkout/checkout.component').then(m => m.CheckoutComponent),
        title: 'Checkout'
      },
      {
         path: 'paybylink',
         loadComponent: () => import('./paybylink/paybylink.component').then(m => m.PayByLinkComponent),
         title: 'Pay-by-Link'
      },
      {
        path: 'business-account-device',
        loadComponent: () => import('./device/device.component').then(m => m.DeviceComponent),
        title: 'Trusted Devices'
      },
      {
        path: 'business-account',
        loadComponent: () => import('./transfer/transfer.component').then(m => m.TransferComponent),
        title: 'Business Account'
      },
      {
        path: 'standing-orders',
        loadComponent: () => import('./standing-orders/standing-orders.component').then(m => m.StandingOrdersComponent),
        title: 'Standing Orders'
      },
      {
        path: 'pos',
        loadComponent: () => import('./pos/pos.component').then(m => m.PosComponent),
        title: 'Point of Sale'
      },
      {
        path: 'cards',
        loadComponent: () => import('./card-list/card-list.component').then(m => m.CardListComponent),
        title: 'My Cards'
      },
      {
        path: 'card-create',
        loadComponent: () => import('./card-create/card-create.component').then(m => m.CardCreateComponent),
        title: 'Create Card'
      },
      {
        path: 'card-transactions',
        loadComponent: () => import('./card-transactions/card-transactions.component').then(m => m.CardTransactionsComponent),
        title: 'Card Transactions'
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/'
  }

];

export default routeConfig;
