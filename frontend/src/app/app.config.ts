import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {provideRouter} from "@angular/router";
import routes from "./routes";
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

export const appConfig: ApplicationConfig = {
    providers: [
        provideHttpClient(),
        provideRouter(routes), provideAnimationsAsync(), provideAnimationsAsync(), provideAnimationsAsync()
    ]
};
