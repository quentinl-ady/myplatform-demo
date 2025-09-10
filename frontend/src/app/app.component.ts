import {ChangeDetectionStrategy, Component} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoginComponent} from "./login/login.component";
import {MainComponent} from "./main/main.component";
import {SignupComponent} from "./signup/signup.component";
import { HttpClientModule } from '@angular/common/http';
import {DashboardComponent} from "./dashboard/dashboard.component";
import {MaterialModule} from "./material.module";

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    HttpClientModule,
    MainComponent,
    DashboardComponent,
    LoginComponent,
    SignupComponent,
    MaterialModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
