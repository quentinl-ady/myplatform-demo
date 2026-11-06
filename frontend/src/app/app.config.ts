import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, TitleStrategy } from "@angular/router";
import routes from "./routes";
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { PageTitleStrategy } from './layout/page-title.strategy';

/** Reduce Motion: Material dialogs, menus and snack bars appear without zoom or slide. */
const prefersReducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const appConfig: ApplicationConfig = {
    providers: [
        provideHttpClient(),
        provideRouter(routes),
        provideAnimationsAsync(prefersReducedMotion ? 'noop' : 'animations'),
        { provide: TitleStrategy, useExisting: PageTitleStrategy }
    ]
};
