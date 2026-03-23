// Core types for Ring Event Logger

import { Camera, Location, RingDevice, RingApi, PushNotificationAction } from 'ring-client-api'

// ==============
// Webhook Configuration
// ==============

export interface WebhookConfig {
  name?: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  
  /** Event types to trigger on (e.g., ['person', 'doorbell_pressed']) */
  eventTypes?: string[];
  
  /** Camera IDs to trigger on (if omitted, all cameras) */
  cameraIds?: string[];
  
  /** Output format */
  format?: 'openclaw' | 'discord' | 'custom';
  
  /** Custom payload builder */
  payloadTemplate?: (event: RingEvent, camera: Camera | undefined) => any;
}

// ==============
// Event Schema
// ==============

export interface RingEvent {
  id: string           // UUID
  timestamp: string   // ISO 8601 - when event occurred
  receivedAt: string  // When we received it
  
  // Source identification
  sourceType: 'camera' | 'doorbell' | 'alarm_device' | 'location' | 'system'
  sourceId: string     // Device ID or location ID
  sourceName: string   // Human-readable name
  deviceType?: string  // e.g., 'doorbell_v4', 'floodlight_cam'
  locationId: string
  locationName: string
  
  // Event details
  eventType: string     // 'motion', 'ding', 'doorbell_press', etc.
  subtype?: string     // Additional categorization
  
  // Payload
  data: Record<string, any>  // Full event payload
  
  // Media (optional)
  snapshotUrl?: string
  recordingUrl?: string
  dingId?: string
}

// ==============
// Device Registry
// ==============

export interface RegisteredDevice {
  id: string
  name: string
  deviceType: string
  locationId: string
  locationName: string
  hasLight: boolean
  hasSiren: boolean
  isDoorbot: boolean
  batteryLevel?: number
  firmwareVersion?: string
  lastSeen: string
}

// ==============
// Configuration
// ==============

export interface Config {
  refreshToken: string
  dataDir: string
  pollIntervalSeconds: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  webhooks?: WebhookConfig[]
}
