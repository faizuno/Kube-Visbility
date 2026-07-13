import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class RefreshPreferencesService {
  private static readonly STORAGE_KEY_ENABLED = 'kube-visibility.autoRefresh.enabled';
  private static readonly STORAGE_KEY_INTERVAL = 'kube-visibility.autoRefresh.interval';
  private static readonly DEFAULT_ENABLED = true;
  private static readonly DEFAULT_INTERVAL_SECONDS = 60;
  private static readonly MIN_INTERVAL_SECONDS = 10;
  private static readonly MAX_INTERVAL_SECONDS = 3600;

  private readonly _autoRefreshEnabled = signal(true);
  private readonly _autoRefreshInterval = signal(60);

  readonly autoRefreshEnabled = this._autoRefreshEnabled.asReadonly();
  readonly autoRefreshInterval = this._autoRefreshInterval.asReadonly();

  constructor() {
    const enabled = this.readStoredEnabled();
    const interval = this.readStoredInterval();
    this._autoRefreshEnabled.set(enabled);
    this._autoRefreshInterval.set(interval);
  }

  setAutoRefreshEnabled(enabled: boolean): void {
    this._autoRefreshEnabled.set(enabled);
    this.writeStorage(RefreshPreferencesService.STORAGE_KEY_ENABLED, String(enabled));
  }

  setAutoRefreshInterval(intervalSeconds: number): void {
    const safeInterval = this.normalizeInterval(intervalSeconds);
    this._autoRefreshInterval.set(safeInterval);
    this.writeStorage(RefreshPreferencesService.STORAGE_KEY_INTERVAL, String(safeInterval));
  }

  private normalizeInterval(intervalSeconds: number): number {
    const parsed = Number(intervalSeconds);
    if (!Number.isFinite(parsed)) {
      return RefreshPreferencesService.DEFAULT_INTERVAL_SECONDS;
    }
    return Math.max(
      RefreshPreferencesService.MIN_INTERVAL_SECONDS,
      Math.min(RefreshPreferencesService.MAX_INTERVAL_SECONDS, parsed)
    );
  }

  private readStoredEnabled(): boolean {
    const stored = this.readStorage(RefreshPreferencesService.STORAGE_KEY_ENABLED);
    if (stored === null) {
      return RefreshPreferencesService.DEFAULT_ENABLED;
    }
    return stored.toLowerCase() === 'true';
  }

  private readStoredInterval(): number {
    const stored = this.readStorage(RefreshPreferencesService.STORAGE_KEY_INTERVAL);
    if (stored === null) {
      return RefreshPreferencesService.DEFAULT_INTERVAL_SECONDS;
    }
    return this.normalizeInterval(Number(stored));
  }

  private readStorage(key: string): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures (private mode / quota / policy)
    }
  }
}
