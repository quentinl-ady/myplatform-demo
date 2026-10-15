import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { ApiLogService } from '../services';
import { ApiLog } from '../models';
import { ConfirmService, httpErrorMessage, parseServerDate } from '../shared';

const LIVE_REFRESH_MS = 5000;

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

@Component({
  selector: 'app-api-logs',
  standalone: true,
  imports: [CommonModule, MaterialModule, FormsModule],
  templateUrl: './api-logs.component.html',
  styleUrl: './api-logs.component.css'
})
export class ApiLogsComponent implements OnInit, OnDestroy {
  private apiLogService = inject(ApiLogService);
  private confirmService = inject(ConfirmService);
  private snackBar = inject(MatSnackBar);

  @Input() userId?: string;
  @Output() closed = new EventEmitter<void>();

  readonly methods = ['POST', 'PATCH', 'GET', 'DELETE'];

  logs: ApiLog[] = [];
  filteredLogs: ApiLog[] = [];
  /** First load only; later refreshes keep the list on screen. */
  loading = signal(false);
  refreshing = signal(false);
  clearing = signal(false);
  loadError = signal<string | null>(null);
  expandedLogId: number | null = null;
  activeTab: 'request' | 'response' = 'request';
  copiedId: string | null = null;
  methodFilter: string = 'ALL';
  domainFilter: string = 'ALL';
  searchQuery: string = '';
  autoRefresh = false;
  private loaded = false;
  private pollInterval?: ReturnType<typeof setInterval>;
  private copiedTimeout?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.loadLogs();
  }

  ngOnDestroy() {
    this.stopAutoRefresh();
    clearTimeout(this.copiedTimeout);
  }

  get hasActiveFilters(): boolean {
    return this.methodFilter !== 'ALL' || this.domainFilter !== 'ALL' || !!this.searchQuery.trim();
  }

  loadLogs() {
    if (this.refreshing() || this.loading()) return;
    (this.loaded ? this.refreshing : this.loading).set(true);
    this.apiLogService.getLogs(this.userId).subscribe({
      next: (logs) => {
        this.logs = logs ?? [];
        this.loaded = true;
        this.loadError.set(null);
        this.applyFilters();
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.refreshing.set(false);
        this.loadError.set(httpErrorMessage(err, 'We couldn\'t load the API calls.'));
        // Live mode would keep hitting a failing endpoint.
        if (this.autoRefresh) {
          this.autoRefresh = false;
          this.stopAutoRefresh();
        }
      }
    });
  }

  applyFilters() {
    let result = this.logs;

    if (this.methodFilter !== 'ALL') {
      result = result.filter(l => l.httpMethod === this.methodFilter);
    }

    if (this.domainFilter !== 'ALL') {
      result = result.filter(l => l.apiDomain === this.domainFilter);
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(l =>
        (l.endpoint || '').toLowerCase().includes(q) ||
        (l.apiDomain || '').toLowerCase().includes(q)
      );
    }

    this.filteredLogs = result;
  }

  setMethodFilter(method: string) {
    this.methodFilter = method;
    this.applyFilters();
  }

  setDomainFilter(domain: string) {
    this.domainFilter = domain;
    this.applyFilters();
  }

  clearFilters() {
    this.methodFilter = 'ALL';
    this.domainFilter = 'ALL';
    this.searchQuery = '';
    this.applyFilters();
  }

  getUniqueDomains(): string[] {
    const domains = new Set(this.logs.map(l => l.apiDomain).filter(d => !!d));
    return Array.from(domains).sort();
  }

  getDomainCount(domain: string): number {
    return this.logs.filter(l => l.apiDomain === domain).length;
  }

  onSearchChange() {
    this.applyFilters();
  }

  toggleExpand(log: ApiLog) {
    if (this.expandedLogId === log.id) {
      this.expandedLogId = null;
    } else {
      this.expandedLogId = log.id;
      this.activeTab = 'request';
    }
  }

  setActiveTab(tab: 'request' | 'response') {
    this.activeTab = tab;
  }

  async clearLogs() {
    const confirmed = await this.confirmService.confirm({
      title: 'Clear API calls?',
      message: 'All recorded API calls for this account are deleted. This can\'t be undone.',
      confirmText: 'Clear calls',
      danger: true
    });
    if (!confirmed) return;
    this.clearing.set(true);
    this.apiLogService.clearLogs(this.userId).subscribe({
      next: () => {
        this.logs = [];
        this.filteredLogs = [];
        this.expandedLogId = null;
        this.clearing.set(false);
      },
      error: (err) => {
        this.clearing.set(false);
        this.snackBar.open(httpErrorMessage(err, 'We couldn\'t clear the API calls. Please try again.'), 'Close', {
          duration: 6000,
          panelClass: 'fintech-snack-error'
        });
      }
    });
  }

  toggleAutoRefresh() {
    this.autoRefresh = !this.autoRefresh;
    this.stopAutoRefresh();
    if (this.autoRefresh) {
      this.loadLogs();
      this.pollInterval = setInterval(() => this.loadLogs(), LIVE_REFRESH_MS);
    }
  }

  private stopAutoRefresh() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  getMethodCount(method: string): number {
    return this.logs.filter(l => l.httpMethod === method).length;
  }

  methodLabel(method: string): string {
    return method === 'DELETE' ? 'DEL' : method;
  }

  isImpactful(log: ApiLog): boolean {
    return log.httpMethod === 'POST' || log.httpMethod === 'PATCH';
  }

  getShortEndpoint(endpoint: string): string {
    if (!endpoint) return '';
    try {
      const url = new URL(endpoint);
      return url.pathname;
    } catch {
      return endpoint;
    }
  }

  formatDuration(ms: number | null | undefined): string {
    if (ms == null || isNaN(ms)) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
  }

  formatJson(raw: string): string {
    if (!raw) return '';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  formatDateTime(dateStr: string): string {
    const date = parseServerDate(dateStr);
    return date ? DATE_TIME_FORMAT.format(date) : '';
  }

  getTimeAgo(dateStr: string): string {
    const date = parseServerDate(dateStr);
    if (!date) return '—';
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs} h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays} d ago`;
    return DATE_FORMAT.format(date);
  }

  copyBody(raw: string, id: string) {
    const text = this.formatJson(raw) || raw || '';
    if (!navigator.clipboard) {
      this.showCopyError();
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        this.copiedId = id;
        clearTimeout(this.copiedTimeout);
        this.copiedTimeout = setTimeout(() => { this.copiedId = null; }, 1500);
      },
      () => this.showCopyError()
    );
  }

  private showCopyError() {
    this.snackBar.open('Couldn\'t copy to the clipboard. Select the text and copy it manually.', 'Close', {
      duration: 5000,
      panelClass: 'fintech-snack-error'
    });
  }

  close() {
    this.closed.emit();
  }

  getDocLink(endpoint: string): string | null {
    const path = this.getShortEndpoint(endpoint).toLowerCase();
    if (path.includes('/legalentities')) return 'https://docs.adyen.com/api-explorer/legalentity/latest/overview';
    if (path.includes('/accountholders')) return 'https://docs.adyen.com/api-explorer/balanceplatform/latest/overview';
    if (path.includes('/balanceaccounts')) return 'https://docs.adyen.com/api-explorer/balanceplatform/latest/overview';
    if (path.includes('/paymentinstruments')) return 'https://docs.adyen.com/api-explorer/balanceplatform/latest/overview';
    if (path.includes('/transactionrules')) return 'https://docs.adyen.com/api-explorer/balanceplatform/latest/overview';
    if (path.includes('/transfers')) return 'https://docs.adyen.com/api-explorer/transfers/latest/overview';
    if (path.includes('/sessions')) return 'https://docs.adyen.com/api-explorer/Checkout/latest/overview';
    if (path.includes('/stores')) return 'https://docs.adyen.com/api-explorer/Management/latest/overview';
    if (path.includes('/businesslines')) return 'https://docs.adyen.com/api-explorer/legalentity/latest/overview';
    if (path.includes('/documents')) return 'https://docs.adyen.com/api-explorer/legalentity/latest/overview';
    if (path.includes('/termsofservice')) return 'https://docs.adyen.com/api-explorer/legalentity/latest/overview';
    if (path.includes('/sweeps')) return 'https://docs.adyen.com/api-explorer/balanceplatform/latest/overview';
    if (path.includes('/terminals')) return 'https://docs.adyen.com/api-explorer/Management/latest/overview';
    if (path.includes('/splitconfigurations')) return 'https://docs.adyen.com/api-explorer/Management/latest/overview';
    if (path.includes('/paymentmethodsettings')) return 'https://docs.adyen.com/api-explorer/Management/latest/overview';
    return null;
  }
}
