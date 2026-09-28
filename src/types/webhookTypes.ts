export interface WebhookPayload {
  id: string;
  event: string;
  data: any;
}

export interface WebhookSignature {
  signature: string;
}
