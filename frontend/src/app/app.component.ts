import {Component} from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Default change detection on purpose: with an OnPush root, state set in HTTP callbacks of the
// (Default) pages below was only rendered after the next click or poll.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet
  ],
  template: `
    <router-outlet></router-outlet>
  `,
  host: {
    class: 'app-root'
  }
})
export class AppComponent {
  title = 'welcome';
}
