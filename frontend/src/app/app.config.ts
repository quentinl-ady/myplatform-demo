import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, TitleStrategy } from "@angular/router";
import routes from "./routes";
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { PageTitleStrategy } from './layout/page-title.strategy';

export const appConfig: ApplicationConfig = {
    providers: [
        provideHttpClient(),
        provideRouter(routes),
        provideAnimationsAsync(),
        { provide: TitleStrategy, useExisting: PageTitleStrategy }
    ]
};
