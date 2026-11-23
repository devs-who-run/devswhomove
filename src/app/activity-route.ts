import { Component, computed, effect, input, signal } from '@angular/core';
import { drawRoute, type RouteSegments } from './route-geometry';

/**
 * Draws a route outline as SVG with no map tiles, so no third party learns where anyone moves.
 * Pass `segments` directly (form preview) or an `activityId` to fetch the stored route.
 */
@Component({
  selector: 'app-activity-route',
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 8px;
      background: color-mix(in srgb, currentColor 5%, transparent);
    }
    .route-line {
      fill: none;
      stroke: #e2672f;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .route-start {
      fill: #496b35;
    }
    .route-end {
      fill: #a44938;
    }
  `,
  template: `
    @if (drawing(); as drawing) {
      @if (drawing.paths.length) {
        <svg
          [attr.viewBox]="'0 0 ' + drawing.width + ' ' + drawing.height"
          role="img"
          [attr.aria-label]="label()"
        >
          @for (path of drawing.paths; track $index) {
            <path class="route-line" [attr.d]="path" />
          }
          <circle
            class="route-start"
            [attr.cx]="drawing.start![0]"
            [attr.cy]="drawing.start![1]"
            r="4"
          />
          <circle class="route-end" [attr.cx]="drawing.end![0]" [attr.cy]="drawing.end![1]" r="4" />
        </svg>
      }
    }
  `,
})
export class ActivityRoute {
  readonly activityId = input<string>();
  readonly segments = input<RouteSegments | null>(null);
  readonly label = input('Route outline, with the start and end trimmed for privacy');
  private readonly fetched = signal<{ id: string; segments: RouteSegments } | null>(null);

  readonly drawing = computed(() => {
    const fetched = this.fetched();
    const segments =
      this.segments() ?? (fetched && fetched.id === this.activityId() ? fetched.segments : null);
    return segments ? drawRoute(segments) : null;
  });

  constructor() {
    effect((onCleanup) => {
      const id = this.activityId();
      this.fetched.set(null);
      if (!id || this.segments()) return;
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      fetch(`/api/activities/${encodeURIComponent(id)}/route`, {
        credentials: 'same-origin',
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((result: { segments?: RouteSegments } | null) =>
          this.fetched.set(result?.segments ? { id, segments: result.segments } : null),
        )
        .catch(() => undefined);
    });
  }
}
