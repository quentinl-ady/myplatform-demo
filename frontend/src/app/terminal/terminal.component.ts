import { Component, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../environments/environment';
import { TerminalPageBridge, TerminalStore } from './terminal-store';
import { sessionOf } from './terminal-view';

/**
 * The page of the payment terminals, which the terminal app opens with the ID of the terminal:
 * /terminal?terminalId=S1F2-000158213200001. It finds the store of the terminal, then shows the invoices the terminal
 * collects and refunds.
 */
@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [NgIf, RouterOutlet, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.css', './terminal.component.css'],
  providers: [TerminalStore],
})
export class TerminalComponent implements OnInit, OnDestroy {
  readonly store = inject(TerminalStore);
  private readonly route = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);
  private readonly dialog = inject(MatDialog);
  // The app calls it from outside Angular, which wouldn't update the page.
  private readonly bridge: TerminalPageBridge = { back: () => this.zone.run(() => this.back()) };

  ngOnInit(): void {
    this.store.start(sessionOf(this.route.snapshot.queryParamMap, environment.apiBaseUrl));
    window.terminalPage = this.bridge;
  }

  ngOnDestroy(): void {
    if (window.terminalPage === this.bridge) delete window.terminalPage;
  }

  private back(): boolean {
    const dialogs = this.dialog.openDialogs;
    if (dialogs.length) {
      dialogs[dialogs.length - 1].close();
      return true;
    }
    return this.store.backHandler?.() ?? false;
  }
}
