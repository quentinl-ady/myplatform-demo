export interface ApiLog {
  id: number;
  userId: string;
  httpMethod: string;
  endpoint: string;
  apiDomain: string;
  requestBody: string;
  responseBody: string;
  statusCode: number;
  durationMs: number;
  error: boolean;
  timestamp: string;
}
