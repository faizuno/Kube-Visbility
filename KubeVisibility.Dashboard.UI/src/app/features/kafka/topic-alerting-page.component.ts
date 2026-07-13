import { CommonModule } from '@angular/common';
import { Component, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { HeaderComponent } from '../../layout/header/header.component';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';
import { KafkaStateService } from './services/kafka-state.service';
import { TopicAlertingListPageComponent } from './components/topic-alerting-list-page/topic-alerting-list-page.component';

@Component({
  selector: 'app-topic-alerting-page',
  standalone: true,
  imports: [CommonModule, HeaderComponent, TopicAlertingListPageComponent],
  template: `
    <div class="topic-alerting-page">
      <app-header
        [headerMode]="'standard'"
        [currentView]="'scanning'"
        [customStatsText]="'Topic alerts configuration'"
        [showHealthFilter]="false"
        [showSearch]="false"
        [showStats]="false"
        [showViewToggle]="false"
        [autoRefreshEnabled]="autoRefreshEnabled"
        [autoRefreshInterval]="autoRefreshInterval"
        [externalIsRefreshing]="isRefreshing()"
        (autoRefreshEnabledChange)="onAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onAutoRefreshIntervalChange($event)"
        (refreshClick)="refreshCurrentTab()"
      />

      <div class="alerts-page-content">
        <div class="page-header">
          <div class="header-left">
            <h2>Topic Alerts</h2>
            <p>Manage alert groups and rules for Kafka topic errors.</p>
          </div>
        </div>

        <app-topic-alerting-list-page
          [topics]="availableTopicNames()"
          [initialTab]="currentTab()"
          (tabChange)="onTabChange($event)"
          #topicAlertingList
        />
      </div>
    </div>
  `,
  styles: [
    `
      .topic-alerting-page {
        background: #f5f5f5;
        min-height: 100vh;
        width: 100%;
        padding: 0 1rem;
      }
      .alerts-page-content {
        padding: 1rem 0;
      }
      .page-header {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 1rem;
        margin-bottom: 0.85rem;
      }
      .header-left { display: flex; flex-direction: column; gap: 0.5rem; }
      .page-header h2 {
        margin: 0;
        color: var(--theme-text-dark);
        font-size: var(--theme-font-page-title);
      }
      .page-header p {
        margin: 0.2rem 0 0;
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-body);
      }
    `,
  ],
})
export class TopicAlertingPageComponent implements OnDestroy {
  @ViewChild('topicAlertingList') private topicAlertingList?: TopicAlertingListPageComponent;

  private readonly stateService = inject(KafkaStateService);
  private readonly router = inject(Router);
  private readonly refreshPreferences = inject(RefreshPreferencesService);
  readonly availableTopicNames = computed(() => this.stateService.topics().map((topic) => topic.name));
  readonly isRefreshing = signal(false);
  readonly currentTab = signal<'groups' | 'rules'>('groups');
  autoRefreshEnabled = true;
  autoRefreshInterval = 60;
  private autoRefreshTimer?: number;
  private isAutoRefreshActive = false;
  private routerEventsSubscription?: Subscription;

  constructor() {
    this.currentTab.set(this.resolveTabFromUrl(this.router.url));
    this.routerEventsSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentTab.set(this.resolveTabFromUrl(event.urlAfterRedirects));
      });

    this.autoRefreshEnabled = this.refreshPreferences.autoRefreshEnabled();
    this.autoRefreshInterval = this.refreshPreferences.autoRefreshInterval();
    this.setupAutoRefresh();

    if (this.stateService.topics().length === 0) {
      this.stateService.loadTopics().catch((error) => {
        console.error('Failed to load topics for topic alerting page:', error);
      });
    }
  }

  onTabChange(tab: 'groups' | 'rules'): void {
    this.currentTab.set(tab);
    const nextUrl = tab === 'groups' ? '/messages/alerts/groups' : '/messages/alerts/rules';
    if (this.router.url !== nextUrl) {
      this.router.navigateByUrl(nextUrl);
    }
  }

  private resolveTabFromUrl(url: string): 'groups' | 'rules' {
    return url.includes('/messages/alerts/rules') ? 'rules' : 'groups';
  }

  onAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    this.autoRefreshEnabled = enabled;
    if (enabled) {
      this.setupAutoRefresh();
    } else {
      this.clearAutoRefresh();
    }
  }

  onAutoRefreshIntervalChange(interval: number): void {
    this.refreshPreferences.setAutoRefreshInterval(interval);
    this.autoRefreshInterval = this.refreshPreferences.autoRefreshInterval();
    this.clearAutoRefresh();
    this.setupAutoRefresh();
  }

  refreshCurrentTab(): void {
    if (this.currentTab() === 'rules') {
      this.topicAlertingList?.refreshRulesOnly();
      return;
    }
    this.topicAlertingList?.refreshGroupsOnly();
  }

  private setupAutoRefresh(): void {
    this.clearAutoRefresh();
    if (this.autoRefreshEnabled && this.autoRefreshInterval > 0) {
      this.isAutoRefreshActive = true;
      this.scheduleNextRefresh(this.autoRefreshInterval);
    }
  }

  private scheduleNextRefresh(interval: number): void {
    if (!this.isAutoRefreshActive) {
      return;
    }

    this.autoRefreshTimer = window.setTimeout(() => {
      if (!this.isAutoRefreshActive) {
        return;
      }
      this.refreshCurrentTab();
      if (this.isAutoRefreshActive) {
        this.scheduleNextRefresh(interval);
      }
    }, interval * 1000);
  }

  private clearAutoRefresh(): void {
    this.isAutoRefreshActive = false;
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
  }

  ngOnDestroy(): void {
    this.clearAutoRefresh();
    this.routerEventsSubscription?.unsubscribe();
  }
}
