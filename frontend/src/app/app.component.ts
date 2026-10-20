import {Component} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatIconModule } from '@angular/material/icon';

// Default change detection on purpose: with an OnPush root, state set in HTTP callbacks of the
// (Default) pages below was only rendered after the next click or poll.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CdkScrollable,
    MatIconModule
  ],
  template: `
    <div class="demo-banner" role="note">
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
      background: #fff8e1;
      color: #8a4b00;
      border-bottom: 1px solid #f0c050;
      font-size: 13px;
      line-height: 1.4;
      text-align: center;
    }
    .demo-banner mat-icon {
      flex: none;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .app-page {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
    }

    @media (max-width: 599.98px) {
      .demo-banner {
        font-size: 12px;
      }
    }
  `],
  host: {
    class: 'app-root'
  }
})
export class AppComponent {
  title = 'welcome';
}
