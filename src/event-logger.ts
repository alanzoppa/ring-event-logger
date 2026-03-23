import Database from 'better-sqlite3';
import * as path from 'path';
import type { RingEvent, RegisteredDevice } from './types';
import type { Logger } from './logger';

/**
 * SQLite-based event storage.
 */
export class EventLogger {
  private db: Database.Database;

  constructor(dataDir: string, private logger: Logger) {
    const dbPath = path.join(dataDir, 'events.db');
    this.db = new Database(dbPath);
    this.initSchema();
    this.logger.info(`Event database initialized at ${dbPath}`);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        received_at TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_name TEXT,
        device_type TEXT,
        location_id TEXT,
        location_name TEXT,
        event_type TEXT NOT NULL,
        subtype TEXT,
        data TEXT NOT NULL,
        ding_id TEXT,
        snapshot_url TEXT,
        recording_url TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_source_id ON events(source_id);
      CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_location_id ON events(location_id);
      
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        device_type TEXT,
        location_id TEXT,
        location_name TEXT,
        has_light INTEGER,
        has_siren INTEGER,
        is_doorbot INTEGER,
        battery_level REAL,
        firmware_version TEXT,
        last_seen TEXT
      );
    `);
  }

  /**
   * Log an event to the database
   */
  log(event: RingEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, timestamp, received_at, source_type, source_id, source_name,
        device_type, location_id, location_name, event_type, subtype,
        data, ding_id, snapshot_url, recording_url
      ) VALUES (
        @id, @timestamp, @receivedAt, @sourceType, @sourceId, @sourceName,
        @deviceType, @locationId, @locationName, @eventType, @subtype,
        @data, @dingId, @snapshotUrl, @recordingUrl
      )
    `);

    stmt.run({
      id: event.id,
      timestamp: event.timestamp,
      receivedAt: event.receivedAt,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      sourceName: event.sourceName,
      deviceType: event.deviceType || null,
      locationId: event.locationId,
      locationName: event.locationName,
      eventType: event.eventType,
      subtype: event.subtype || null,
      data: JSON.stringify(event.data),
      dingId: event.dingId || null,
      snapshotUrl: event.snapshotUrl || null,
      recordingUrl: event.recordingUrl || null,
    });

    this.logger.debug('Event logged', {
      eventType: event.eventType,
      sourceName: event.sourceName,
      dingId: event.dingId,
    });
  }

  /**
   * Update or insert device in registry
   */
  upsertDevice(device: RegisteredDevice): void {
    const stmt = this.db.prepare(`
      INSERT INTO devices (
        id, name, device_type, location_id, location_name,
        has_light, has_siren, is_doorbot, battery_level,
        firmware_version, last_seen
      ) VALUES (
        @id, @name, @deviceType, @locationId, @locationName,
        @hasLight, @hasSiren, @isDoorbot, @batteryLevel,
        @firmwareVersion, @lastSeen
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        battery_level = excluded.battery_level,
        last_seen = excluded.last_seen
    `);

    stmt.run({
      id: device.id,
      name: device.name,
      deviceType: device.deviceType,
      locationId: device.locationId,
      locationName: device.locationName,
      hasLight: device.hasLight ? 1 : 0,
      hasSiren: device.hasSiren ? 1 : 0,
      isDoorbot: device.isDoorbot ? 1 : 0,
      batteryLevel: device.batteryLevel ?? null,
      firmwareVersion: device.firmwareVersion ?? null,
      lastSeen: device.lastSeen,
    });
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit = 100): RingEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(limit) as any[];
    return rows.map(this.rowToEvent);
  }

  /**
   * Get events by source
   */
  getEventsBySource(sourceId: string, limit = 100): RingEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE source_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(sourceId, limit) as any[];
    return rows.map(this.rowToEvent);
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: string, limit = 100): RingEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE event_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(eventType, limit) as any[];
    return rows.map(this.rowToEvent);
  }

  /**
   * Get event counts by type for date range
   */
  getEventCountsByType(daysBack = 7): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM events
      WHERE date(timestamp) >= date('now', ?)
      GROUP BY event_type
      ORDER BY count DESC
    `);
    
    const rows = stmt.all(`-${daysBack} days`) as any[];
    return Object.fromEntries(rows.map(r => [r.event_type, r.count]));
  }

  private rowToEvent(row: any): RingEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      receivedAt: row.received_at,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceName: row.source_name,
      deviceType: row.device_type,
      locationId: row.location_id,
      locationName: row.location_name,
      eventType: row.event_type,
      subtype: row.subtype,
      data: JSON.parse(row.data),
      dingId: row.ding_id,
      snapshotUrl: row.snapshot_url,
      recordingUrl: row.recording_url,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
