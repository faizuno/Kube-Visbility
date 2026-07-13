import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges, signal } from '@angular/core';

import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

/**
 * Reusable ECharts wrapper component
 * Provides a simple interface to display ECharts visualizations
 */
@Component({
  selector: 'app-echarts-wrapper',
  standalone: true,
  imports: [],
  template: `
    <div class="echarts-container" [style.height]="height">
      @if (loading()) {
        <div class="loading-overlay">
          <div class="spinner"></div>
          <span>Loading chart...</span>
        </div>
      }
      <div #chartElement class="chart-element" [style.height]="height"></div>
    </div>
  `,
  styles: [`
    .echarts-container {
      position: relative;
      width: 100%;
    }

    .chart-element {
      width: 100%;
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.9);
      z-index: 10;
      gap: 0.5rem;
    }

    .spinner {
      width: 2rem;
      height: 2rem;
      border: 3px solid var(--theme-border-gray);
      border-top-color: var(--theme-button-primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .loading-overlay span {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
    }
  `]
})
export class EchartsWrapperComponent implements AfterViewInit, OnChanges {
  @ViewChild('chartElement', { static: false }) chartElement!: ElementRef;

  @Input() chartOption: EChartsOption | null = null;
  @Input() height: string = '300px';
  @Input() set loadingState(value: boolean) {
    this.loading.set(value);
  }

  @Output() chartClick = new EventEmitter<any>();

  loading = signal(false);

  private chart: ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.initChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chartOption'] && !changes['chartOption'].firstChange) {
      this.updateChart();
    }
  }

  private initChart(): void {
    if (!this.chartElement) {
      return;
    }

    try {
      // Initialize the chart
      this.chart = echarts.init(this.chartElement.nativeElement);

      // Set initial option if available
      if (this.chartOption) {
        this.chart.setOption(this.chartOption);
      }

      // Setup click event listener
      this.chart.on('click', (params: any) => {
        this.chartClick.emit(params);
      });

      // Setup resize observer for responsiveness
      this.setupResizeObserver();
    } catch (error) {
      console.error('Error initializing ECharts:', error);
    }
  }

  private updateChart(): void {
    if (!this.chart || !this.chartOption) {
      return;
    }

    try {
      this.chart.setOption(this.chartOption, true);
    } catch (error) {
      console.error('Error updating ECharts:', error);
    }
  }

  private setupResizeObserver(): void {
    if (!this.chartElement) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.resize();
      }
    });

    this.resizeObserver.observe(this.chartElement.nativeElement);
  }

  ngOnDestroy(): void {
    // Cleanup
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.chart) {
      this.chart.dispose();
    }
  }
}

