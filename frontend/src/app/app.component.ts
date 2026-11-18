import {Component, inject} from '@angular/core';
import { NgIf } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatIconModule } from '@angular/material/icon';
import { filter, map } from 'rxjs';

/** The page of the payment terminals fills their small screen, like an app. */
function isTerminalPage(url: string): boolean {
  return /^\/terminal(?:[/?#]|$)/.test(url);
}

// Default change detection on purpose: with an OnPush root, state set in HTTP callbacks of the
// (Default) pages below was only rendered after the next click or poll.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NgIf,
    RouterOutlet,
    CdkScrollable,
    MatIconModule
  ],
  template: `
    <div class="demo-banner" role="note" *ngIf="showBanner()">
      <mat-icon aria-hidden="true">science</mat-icon>
      <span><strong>Demo environment:</strong> test data only, no real money. For information purposes only.</span>
    </div>
    <div class="app-page" cdkScrollable>
      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`
    /* The pages scroll under the banner, so it stays on screen: they fill .app-page with height or min-height: 100%. */
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      height: 100dvh;
    }

    .demo-banner {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 16px;
      background: var(--fintech-warning-bg);
      color: var(--fintech-text);
      border-bottom: 1px solid var(--fintech-warning-border);
      font-size: 0.8125rem;
      line-height: 1.4;
      text-align: center;
    }
    .demo-banner mat-icon {
      flex: none;
      font-size: 1.125rem;
      width: 1.125rem;
      height: 1.125rem;
      color: var(--fintech-warning);
    }

    .app-page {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
    }

    @media (max-width: 599.98px) {
      .demo-banner {
        font-size: 0.75rem;
      }
    }
  `],
  host: {
    class: 'app-root'
  }
})
export class AppComponent {
  title = 'welcome';

  // Until the first navigation ends, the address tells which page opens.
  readonly showBanner = toSignal(
    inject(Router).events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => !isTerminalPage(event.urlAfterRedirects))
    ),
    { initialValue: typeof window === 'undefined' || !isTerminalPage(window.location.pathname) }
  );
}
