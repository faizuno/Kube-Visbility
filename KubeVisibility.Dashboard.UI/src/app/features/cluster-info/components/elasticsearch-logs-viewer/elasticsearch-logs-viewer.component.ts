
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { ResourceInfo } from '../../../../core/models/cluster-info.models';
import { GlobalElasticsearchSearchComponent } from '../../../../shared/components/global-elasticsearch-search/global-elasticsearch-search.component';

@Component({
  selector: 'app-elasticsearch-logs-viewer',
  standalone: true,
  imports: [GlobalElasticsearchSearchComponent],
  template: `
    @if (resource) {
      <app-elasticsearch-logs-common
        [title]="'Aggregated Logs - ' + resource.name"
        [fixedServiceName]="resource.name"
        [initialVisible]="true"
        [exportFileNamePrefix]="'aggregated-logs-' + resource.name"
        [contextKey]="contextKey()"
        (closed)="onCommonClosed()"
      />
    }
  `,
})
export class ElasticsearchLogsViewerComponent implements OnChanges {
  @Input() namespace = '';
  @Input() resource: ResourceInfo | null = null;
  @Output() closed = new EventEmitter<void>();

  contextKey = signal('');
  private contextVersion = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['resource'] && this.resource) || (changes['namespace'] && this.resource)) {
      this.contextVersion += 1;
      this.contextKey.set(`${this.namespace}:${this.resource.name}:${this.contextVersion}`);
    }
  }

  onCommonClosed(): void {
    this.closed.emit();
  }
}
