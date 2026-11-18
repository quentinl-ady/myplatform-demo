import { Routes } from '@angular/router';
import { TerminalComponent } from './terminal.component';
import { TerminalInvoiceComponent } from './terminal-invoice.component';
import { TerminalInvoicesComponent } from './terminal-invoices.component';

export const TERMINAL_ROUTES: Routes = [
  {
    path: '',
    component: TerminalComponent,
    children: [
      {
        path: '',
        component: TerminalInvoicesComponent,
        title: 'Invoices',
      },
      {
        path: 'invoices/:invoiceId',
        component: TerminalInvoiceComponent,
        title: 'Invoice',
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
