import { Component, Input } from '@angular/core';


@Component({
  selector: 'app-loading-skeleton',
  standalone: true,
  imports: [],
  template: `
    @for (item of skeletonItems; track $index) {
      <div
        class="skeleton"
        [style.width]="width"
        [style.height]="height"
        [style.border-radius]="borderRadius"
        [style.margin-bottom]="$index < skeletonItems.length - 1 ? '0.5rem' : '0'"
      ></div>
    }
  `,
  styles: [
    `
      .skeleton {
        background: linear-gradient(
          90deg,
          var(--theme-skeleton-base) 25%,
          var(--theme-skeleton-highlight) 50%,
          var(--theme-skeleton-base) 75%
        );
        background-size: 200% 100%;
        animation: loading 1.5s infinite;
      }
      @keyframes loading {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
    `,
  ],
})
export class LoadingSkeletonComponent {
  @Input() width: string = '100%';
  @Input() height: string = '20px';
  @Input() borderRadius: string = '4px';
  @Input() count: number = 1;

  get skeletonItems(): number[] {
    return Array(this.count).fill(0);
  }
}

