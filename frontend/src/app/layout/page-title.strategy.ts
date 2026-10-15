import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const DEFAULT_PLATFORM_NAME = 'My Platform';

/**
 * Builds document titles as "<Page> · <platform name>". The platform name
 * follows the account's custom branding while an account layout is shown.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private pageTitle: string | undefined;
  private platformName = DEFAULT_PLATFORM_NAME;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.pageTitle = this.buildTitle(snapshot);
    this.apply();
  }

  setPlatformName(name: string | null | undefined): void {
    this.platformName = name?.trim() || DEFAULT_PLATFORM_NAME;
    this.apply();
  }

  /** Overrides the page part of the title until the next navigation. */
  setPageTitle(page: string | undefined): void {
    this.pageTitle = page;
    this.apply();
  }

  private apply(): void {
    this.title.setTitle(this.pageTitle ? `${this.pageTitle} · ${this.platformName}` : this.platformName);
  }
}
