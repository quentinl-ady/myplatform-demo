import { Directive, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subscription, firstValueFrom } from 'rxjs';
import { AdyenPlatformExperience } from '@adyen/adyen-platform-experience-web';
import { SessionToken } from '../models';
import { httpErrorMessage } from '../shared';

export type PlatformExperienceCore = Awaited<ReturnType<typeof AdyenPlatformExperience>>;

export interface MountableComponent {
  mount(target: string | HTMLElement): unknown;
  unmount?(): unknown;
}

/**
 * Creates the Adyen Platform Experience core after fetching a first session token, so a
 * failing session endpoint surfaces as a rejected promise the page can display, instead of
 * an unexplained empty component. Later session renewals fetch a fresh token.
 */
export async function createPlatformExperienceCore(requestSession: () => Observable<SessionToken>) {
  let prefetched: SessionToken | null = await firstValueFrom(requestSession());
  if (!prefetched?.token) {
    throw new Error('The session token is missing.');
  }

  return AdyenPlatformExperience({
    onSessionCreate: async () => {
      const session = prefetched ?? await firstValueFrom(requestSession());
      prefetched = null;
      return { id: session.id, token: session.token };
    }
  });
}

/** Loading, error and refresh handling shared by pages that embed one Platform Experience component. */
@Directive()
export abstract class PlatformExperiencePage implements OnInit, OnDestroy {
  abstract readonly pageTitle: string;
  abstract readonly pageDescription: string;
  /** Lowercase plural used in labels, e.g. "reports". */
  abstract readonly itemLabel: string;
  abstract readonly containerId: string;
  protected abstract readonly errorFallback: string;
  protected abstract requestSession(userId: string): Observable<SessionToken>;
  protected abstract createComponent(core: PlatformExperienceCore): MountableComponent;

  private route = inject(ActivatedRoute);

  userId = '';
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private component: MountableComponent | null = null;
  private paramsSub?: Subscription;
  private loadSequence = 0;
  private destroyed = false;

  ngOnInit() {
    this.paramsSub = this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.load();
      }
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.paramsSub?.unsubscribe();
    this.unmount();
  }

  refresh() {
    if (this.loading()) return;
    this.load();
  }

  private async load() {
    const sequence = ++this.loadSequence;
    this.unmount();
    this.loading.set(true);
    this.error.set(null);

    try {
      const core = await createPlatformExperienceCore(() => this.requestSession(this.userId));
      if (this.destroyed || sequence !== this.loadSequence) return;
      this.component = this.createComponent(core);
      this.component.mount(this.containerSelector);
    } catch (err) {
      if (this.destroyed || sequence !== this.loadSequence) return;
      this.unmount();
      this.error.set(httpErrorMessage(err, this.errorFallback));
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  private get containerSelector(): string {
    return '#' + this.containerId;
  }

  private unmount() {
    try {
      this.component?.unmount?.();
    } catch {
      // The component may already be detached when the page is torn down.
    }
    this.component = null;
    const container = document.querySelector(this.containerSelector);
    if (container) container.innerHTML = '';
  }
}
