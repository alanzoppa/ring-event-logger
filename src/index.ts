import 'dotenv/config';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { TokenManager } from './token-manager';
import { EventLogger } from './event-logger';
import { RingClient } from './ring-client';

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info('Ring Event Logger starting...');
  
  if (config.webhooks && config.webhooks.length > 0) {
    logger.info(`Configured ${config.webhooks.length} webhook(s)`);
  }

  // Initialize components
  const tokenManager = new TokenManager(config.dataDir, logger);
  const eventLogger = new EventLogger(config.dataDir, logger);

  // Check for stored token first
  const storedToken = await tokenManager.load();
  if (storedToken && storedToken !== config.refreshToken) {
    logger.info('Using stored refresh token');
    config.refreshToken = storedToken;
  }

  // Connect to Ring
  const ringClient = new RingClient(
    {
      refreshToken: config.refreshToken,
      pollIntervalSeconds: config.pollIntervalSeconds,
      webhooks: config.webhooks,
    },
    logger,
    eventLogger,
    tokenManager
  );

  try {
    await ringClient.connect();
  } catch (error) {
    logger.error('Failed to connect to Ring', { error });
    process.exit(1);
  }

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    eventLogger.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Log stats periodically
  setInterval(() => {
    const counts = eventLogger.getEventCountsByType(1);
    if (Object.keys(counts).length > 0) {
      logger.info('Event stats (last 24h)', counts);
    }
  }, 60 * 60 * 1000); // Every hour

  logger.info('Ring Event Logger running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
