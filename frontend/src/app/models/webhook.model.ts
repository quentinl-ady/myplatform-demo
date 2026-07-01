export interface WebhookEvent {
  id: number;
  eventType: string;
  webhookType: string;
  rawJson: string;
  resourceId: string;
  title: string;
  description: string;
  userId: string;
  acknowledged: boolean;
  receivedAt: string;
  source: string;
}

export interface WebhookUnreadCount {
  unreadCount: number;
}

export interface WebhookNotificationSummary {
  unreadCount: number;
  recentEvents: WebhookEvent[];
}
