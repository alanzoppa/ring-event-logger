import { promises as fs } from 'fs';
import * as path from 'path';
import type { Logger } from './logger';

/**
 * Manages Ring refresh token persistence.
 * 
 * CRITICAL: The refresh token must be saved each time it's updated,
 * or push notifications will stop working.
 * 
 * @see https://github.com/dgreif/ring/wiki/Refresh-Tokens
 */
export class TokenManager {
  private tokenPath: string;

  constructor(private dataDir: string, private logger: Logger) {
    this.tokenPath = path.join(dataDir, 'refresh-token.txt');
  }

  /**
   * Load the stored refresh token
   */
  async load(): Promise<string | null> {
    try {
      const token = await fs.readFile(this.tokenPath, 'utf-8');
      this.logger.debug('Loaded refresh token from storage');
      return token.trim();
    } catch {
      this.logger.debug('No stored refresh token found');
      return null;
    }
  }

  /**
   * Save the refresh token
   */
  async save(token: string): Promise<void> {
    // Ensure data directory exists
    await fs.mkdir(this.dataDir, { recursive: true });
    
    await fs.writeFile(this.tokenPath, token, 'utf-8');
    this.logger.info('Refresh token updated and saved');
  }
}
