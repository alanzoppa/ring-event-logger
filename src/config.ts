import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import type { Config, WebhookConfig } from './types';

export function loadConfig(): Config {
  const refreshToken = process.env.RING_REFRESH_TOKEN;

  if (!refreshToken || refreshToken === 'your-refresh-token-here') {
    throw new Error(
      'RING_REFRESH_TOKEN not set. Run `npm run auth` to get a token, then add it to .env'
    );
  }

  // Load webhooks from JSON config file (in project root)
  let webhooks: WebhookConfig[] = [];
  const webhooksPath = path.resolve(process.cwd(), 'webhooks.json');
  
  try {
    if (fs.existsSync(webhooksPath)) {
      const webhooksContent = fs.readFileSync(webhooksPath, 'utf-8');
      webhooks = JSON.parse(webhooksContent);
    }
  } catch (e) {
    console.warn(`Failed to load webhooks from ${webhooksPath}:`, e);
  }

  return {
    refreshToken,
    dataDir: process.env.DATA_DIR || './data',
    pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL || '20', 10),
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
    webhooks,
  };
}
