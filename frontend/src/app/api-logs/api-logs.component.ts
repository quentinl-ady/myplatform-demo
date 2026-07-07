import { Component, OnInit, OnDestroy, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../material.module';
import { ApiLogService } from '../services';
import { ApiLog } from '../models';

@Component({
  selector: 'app-api-logs',
  standalone: true,
  imports: [CommonModule, MaterialModule, FormsModule],
  templateUrl: './api-logs.component.html',
  styleUrl: './api-logs.component.css'
})
export class ApiLogsComponent implements OnInit, OnDestroy {

  @Input() userId?: string;
  logs: ApiLog[] = [];
  filteredLogs: ApiLog[] = [];
  loading = signal(false);
  expandedLogId: number | null = null;
  activeTab: 'request' | 'response' = 'request';
  copiedId: string | null = null;
  methodFilter: string = 'ALL';
  domainFilter: string = 'ALL';
  searchQuery: string = '';
  autoRefresh = false;
  private pollInterval?: any;

  constructor(private apiLogService: ApiLogService) {}

  ngOnInit() {
    this.loadLogs();
  }

  ngOnDestroy() {
    this.stopAutoRefresh();
  }

  loadLogs() {
    this.loading.set(true);
    this.apiLogService.getLogs(this.userId).subscribe({
      next: (logs) => {
        this.logs = logs;
        this.applyFilters();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
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

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(l =>
        l.endpoint.toLowerCase().includes(q) ||
        l.apiDomain.toLowerCase().includes(q)
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

  clearLogs() {
    this.apiLogService.clearLogs(this.userId).subscribe({
      next: () => {
        this.logs = [];
        this.filteredLogs = [];
      }
    });
  }

  toggleAutoRefresh() {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.pollInterval = setInterval(() => this.loadLogs(), 5000);
    } else {
      this.stopAutoRefresh();
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

  isImpactful(log: ApiLog): boolean {
    return log.httpMethod === 'POST' || log.httpMethod === 'PATCH';
  }

  getShortEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      return url.pathname;
    } catch {
      return endpoint;
    }
  }

  getHostname(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      return url.hostname;
    } catch {
      return '';
    }
  }

  formatJson(raw: string): string {
    if (!raw) return '';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  getTimeAgo(dateStr: string): string {
    const normalized = dateStr.endsWith('Z') || dateStr.includes('+') || dateStr.includes('-', 10)
      ? dateStr
      : dateStr + 'Z';
    const date = new Date(normalized);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  copyBody(raw: string, id: string) {
    const text = this.formatJson(raw) || raw || '';
    navigator.clipboard.writeText(text).then(() => {
      this.copiedId = id;
      setTimeout(() => { this.copiedId = null; }, 1500);
    });
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
