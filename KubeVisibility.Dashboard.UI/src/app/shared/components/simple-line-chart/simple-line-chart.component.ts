import { Component, Input, computed, signal } from '@angular/core';


export interface ChartData {
  labels: string[];
  values: number[];
  color?: string;
}

/**
 * Simple SVG-based line chart component
 * Following Open/Closed Principle - can be extended for different chart types
 */
@Component({
  selector: 'app-simple-line-chart',
  standalone: true,
  imports: [],
  template: `
    <div class="chart-container">
      @if (chartData(); as data) {
        @if (data.values.length > 0) {
          <div class="chart-header">
            <span class="chart-title">{{ title() }}</span>
            @if (showStats()) {
              <span class="chart-stats">
                Min: {{ formatValue(minValue()) }} | Max: {{ formatValue(maxValue()) }} | 
                Avg: {{ formatValue(avgValue()) }}
              </span>
            }
          </div>
          <svg 
            [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
            preserveAspectRatio="none"
            class="chart-svg"
          >
            <!-- Grid lines -->
            @for (line of gridLines(); track $index) {
              <line 
                [attr.x1]="0" 
                [attr.y1]="line" 
                [attr.x2]="width()" 
                [attr.y2]="line"
                class="grid-line"
              />
            }
            
            <!-- Line path -->
            <path 
              [attr.d]="linePath()" 
              [attr.stroke]="chartData()!.color || 'var(--theme-button-primary)'"
              class="chart-line"
            />
            
            <!-- Points -->
            @for (point of points(); track $index) {
              <circle 
                [attr.cx]="point.x" 
                [attr.cy]="point.y" 
                [attr.r]="3"
                [attr.fill]="chartData()!.color || 'var(--theme-button-primary)'"
                class="chart-point"
              />
            }
          </svg>
          <div class="chart-footer">
            <span class="label-start">{{ firstLabel() }}</span>
            <span class="label-end">{{ lastLabel() }}</span>
          </div>
        } @else {
          <div class="no-data">No data available</div>
        }
      }
    </div>
  `,
  styles: [`
    .chart-container {
      width: 100%;
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray);
      border-radius: 8px;
      padding: 1rem;
    }

    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .chart-title {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      font-size: var(--theme-font-body);
    }

    .chart-stats {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }

    .chart-svg {
      width: 100%;
      height: 150px;
      overflow: visible;
    }

    .grid-line {
      stroke: var(--theme-border-gray);
      stroke-width: 1;
    }

    .chart-line {
      fill: none;
      stroke-width: 2;
    }

    .chart-point {
      cursor: pointer;
      transition: r 0.2s;
    }

    .chart-point:hover {
      r: 5;
    }

    .chart-footer {
      display: flex;
      justify-content: space-between;
      margin-top: 0.5rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }

    .no-data {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
    }
  `]
})
export class SimpleLineChartComponent {
  @Input() set data(value: ChartData | null) {
    this.chartData.set(value);
  }
  
  @Input() set chartTitle(value: string) {
    this.title.set(value);
  }

  @Input() set displayStats(value: boolean) {
    this.showStats.set(value);
  }

  chartData = signal<ChartData | null>(null);
  title = signal<string>('');
  showStats = signal<boolean>(true);
  width = signal<number>(500);
  height = signal<number>(150);
  padding = signal<number>(10);

  // Computed values
  minValue = computed(() => {
    const data = this.chartData();
    return data && data.values.length > 0 ? Math.min(...data.values) : 0;
  });

  maxValue = computed(() => {
    const data = this.chartData();
    return data && data.values.length > 0 ? Math.max(...data.values) : 0;
  });

  avgValue = computed(() => {
    const data = this.chartData();
    if (!data || data.values.length === 0) return 0;
    return data.values.reduce((sum, v) => sum + v, 0) / data.values.length;
  });

  firstLabel = computed(() => {
    const data = this.chartData();
    return data && data.labels.length > 0 ? data.labels[0] : '';
  });

  lastLabel = computed(() => {
    const data = this.chartData();
    return data && data.labels.length > 0 ? data.labels[data.labels.length - 1] : '';
  });

  // Chart calculations
  points = computed(() => {
    const data = this.chartData();
    if (!data || data.values.length === 0) return [];

    const w = this.width() - this.padding() * 2;
    const h = this.height() - this.padding() * 2;
    const min = this.minValue();
    const max = this.maxValue();
    const range = max - min || 1;

    return data.values.map((value, index) => {
      const x = this.padding() + (index / (data.values.length - 1 || 1)) * w;
      const y = this.height() - this.padding() - ((value - min) / range) * h;
      return { x, y };
    });
  });

  linePath = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return '';
    
    return pts.reduce((path, point, index) => {
      return path + (index === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`);
    }, '');
  });

  gridLines = computed(() => {
    const h = this.height();
    return [
      h * 0.25,
      h * 0.5,
      h * 0.75
    ];
  });

  formatValue(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(2) + 'K';
    }
    return value.toFixed(2);
  }
}

