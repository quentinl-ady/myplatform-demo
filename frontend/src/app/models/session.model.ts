export interface SessionToken {
  id: string;
  token: string;
}

export interface BusinessLine {
  id: string;
  industryCode: string;
  salesChannels: string[];
}
