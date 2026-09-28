import { writeFileSync } from 'fs';
import { WebhookPayload, WebhookSignature } from '../src/types/webhookTypes';

const generateWebhookTypes = () => {
  const types = {
    WebhookPayload,
    WebhookSignature
  };

  writeFileSync('src/types/webhookTypes.ts', `export interface WebhookPayload {\n  id: string;\n  event: string;\n  data: any;\n}\n\nexport interface WebhookSignature {\n  signature: string;\n}\n`);
};

generateWebhookTypes();
