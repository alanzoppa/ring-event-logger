import { RingApi, PushNotificationAction, Camera, Location, RingDevice } from 'ring-client-api';
import { v4 as uuidv4 } from 'uuid';
import type { RingEvent, RegisteredDevice, WebhookConfig } from './types';
import type { Logger } from './logger';
import type { EventLogger } from './event-logger';
import type { TokenManager } from './token-manager';

/**
 * Wraps ring-client-api and routes all events to the logger and webhooks.
 */
export class RingClient {
  private api: RingApi | null = null;
  private locations: Location[] = [];
  private cameras: Camera[] = [];
  private devices: Map<string, RingDevice> = new Map();

  constructor(
    private config: {
      refreshToken: string;
      pollIntervalSeconds: number;
      webhooks?: WebhookConfig[];
    },
    private logger: Logger,
    private eventLogger: EventLogger,
    private tokenManager: TokenManager
  ) {}

  /**
   * Connect to Ring API and subscribe to all events
   */
  async connect(): Promise<void> {
    this.logger.info('Connecting to Ring API...');

    this.api = new RingApi({
      refreshToken: this.config.refreshToken,
      cameraStatusPollingSeconds: this.config.pollIntervalSeconds,
      debug: this.logger.level === 'debug',
    });

    // CRITICAL: Handle token updates
    this.api.onRefreshTokenUpdated.subscribe(async ({ newRefreshToken }) => {
      await this.tokenManager.save(newRefreshToken);
    });

    // Get locations and cameras
    this.locations = await this.api.getLocations();
    this.cameras = await this.api.getCameras();

    this.logger.info(`Found ${this.locations.length} location(s) with ${this.cameras.length} camera(s)`);

    // Log location connection status
    for (const location of this.locations) {
      location.onConnected.subscribe((connected) => {
        this.logger.info(`${connected ? 'Connected to' : 'Disconnected from'} location ${location.name}`, {
          locationId: location.id,
        });
      });
    }

    // Subscribe to camera events
    await this.subscribeToCameraEvents();

    // Subscribe to alarm device events
    await this.subscribeToAlarmEvents();

    this.logger.info('Event subscriptions ready');
  }

  /**
   * Subscribe to all camera/doorbell events
   */
  private async subscribeToCameraEvents(): Promise<void> {
    for (const camera of this.cameras) {
      // Register device
      this.registerDevice(camera);

      // All push notifications (motion, ding, etc.)
      camera.onNewNotification.subscribe((notification) => {
        this.handleCameraNotification(camera, notification);
      });

      // Doorbell press specifically
      camera.onDoorbellPressed.subscribe((ding) => {
        this.handleDoorbellPress(camera, ding);
      });

      // Motion state changes
      camera.onMotionDetected.subscribe((motion) => {
        this.handleMotionDetected(camera, motion);
      });

      // Camera data updates (battery, settings, etc.)
      camera.onData.subscribe((data) => {
        this.handleCameraDataUpdate(camera, data);
      });

      this.logger.debug(`Subscribed to events for ${camera.name}`, {
        cameraId: camera.id,
        deviceType: camera.deviceType,
      });
    }
  }

  /**
   * Subscribe to alarm device events
   */
  private async subscribeToAlarmEvents(): Promise<void> {
    for (const location of this.locations) {
      const devices = await location.getDevices();

      for (const device of devices) {
        this.devices.set(device.zid, device);

        // Device state changes
        device.onData.subscribe((data) => {
          this.handleDeviceUpdate(location, device, data);
        });
      }

      this.logger.debug(`Found ${devices.length} alarm devices at ${location.name}`);
    }
  }

  /**
   * Handle camera push notification
   */
  private handleCameraNotification(camera: Camera, notification: any): void {
    const action = notification.android_config?.category;
    const eventType = this.mapActionToEventType(action);
    const ding = notification.data?.event?.ding;
    const eventData = notification.data || {};

    // Check for person detection in the event data
    const personDetected = this.checkPersonDetection(eventData);

    const event: RingEvent = {
      id: uuidv4(),
      timestamp: notification.data?.event?.created_at || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      sourceType: camera.isDoorbot ? 'doorbell' : 'camera',
      sourceId: camera.id.toString(),
      sourceName: camera.name,
      deviceType: camera.deviceType,
      locationId: camera.location.id,
      locationName: camera.location.name,
      eventType: personDetected ? 'person' : eventType,
      subtype: personDetected ? eventType : undefined,
      data: eventData,
      dingId: ding?.id?.toString(),
    };

    this.eventLogger.log(event);
    this.logger.info(`${event.eventType} on ${camera.name}`, { dingId: event.dingId });

    // Trigger webhooks
    this.triggerWebhooks(event, camera);
  }

  /**
   * Check if a person was detected in the event
   */
  private checkPersonDetection(eventData: any): boolean {
    // Ring includes person detection in various places depending on camera model
    if (eventData.ding?.kind === 'motion' && eventData.ding?.motion?.motion_type === 'person') {
      return true;
    }
    if (eventData.event?.ding?.kind === 'motion' && eventData.event?.ding?.motion?.motion_type === 'person') {
      return true;
    }
    if (eventData.kind === 'motion_person') {
      return true;
    }
    if (eventData.alert_type === 'person' || eventData.alert?.type === 'person') {
      return true;
    }
    return false;
  }

  /**
   * Handle doorbell press
   */
  private handleDoorbellPress(camera: Camera, ding: any): void {
    const event: RingEvent = {
      id: uuidv4(),
      timestamp: ding.created_at || new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      sourceType: 'doorbell',
      sourceId: camera.id.toString(),
      sourceName: camera.name,
      deviceType: camera.deviceType,
      locationId: camera.location.id,
      locationName: camera.location.name,
      eventType: 'doorbell_pressed',
      data: ding,
      dingId: ding.id?.toString(),
    };

    this.eventLogger.log(event);
    this.logger.info(`Doorbell pressed: ${camera.name}`);

    // Trigger webhooks
    this.triggerWebhooks(event, camera);
  }

  /**
   * Handle motion detected
   */
  private handleMotionDetected(camera: Camera, motion: boolean): void {
    // Only log when motion starts, not when it ends
    if (!motion) return;

    const event: RingEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      sourceType: camera.isDoorbot ? 'doorbell' : 'camera',
      sourceId: camera.id.toString(),
      sourceName: camera.name,
      deviceType: camera.deviceType,
      locationId: camera.location.id,
      locationName: camera.location.name,
      eventType: 'motion',
      data: { state: motion },
    };

    this.eventLogger.log(event);
    this.logger.debug(`Motion detected: ${camera.name}`);
  }

  /**
   * Handle camera data updates (battery, settings, etc.)
   */
  private handleCameraDataUpdate(camera: Camera, data: any): void {
    // Update device registry with latest info
    this.registerDevice(camera);

    // Log significant state changes
    if (data.battery_life !== undefined && data.battery_life !== camera.data?.battery_life) {
      this.logger.debug(`Battery update: ${camera.name}`, { battery: data.battery_life });
    }
  }

  /**
   * Handle alarm device updates
   */
  private handleDeviceUpdate(location: Location, device: RingDevice, data: any): void {
    // Check for faulted state (door/window opened, motion, etc.)
    if (data.faulted !== undefined) {
      const eventType = data.faulted ? 'sensor_triggered' : 'sensor_cleared';

      const event: RingEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        sourceType: 'alarm_device',
        sourceId: device.zid,
        sourceName: device.name,
        deviceType: device.deviceType,
        locationId: location.id,
        locationName: location.name,
        eventType,
        data: { faulted: data.faulted, ...data },
      };

      this.eventLogger.log(event);
      this.logger.info(`${eventType}: ${device.name} (${device.deviceType})`);

      // Trigger webhooks for sensor events
      if (data.faulted) {
        this.triggerWebhooks(event);
      }
    }
  }

  /**
   * Trigger configured webhooks for an event
   */
  private async triggerWebhooks(event: RingEvent, camera?: Camera): Promise<void> {
    const webhooks = this.config.webhooks || [];

    for (const webhook of webhooks) {
      // Check if this event type should trigger this webhook
      if (webhook.eventTypes && !webhook.eventTypes.includes(event.eventType)) {
        continue;
      }

      // Check camera filter
      if (webhook.cameraIds && camera && !webhook.cameraIds.includes(camera.id.toString())) {
        continue;
      }

      try {
        const payload = this.buildWebhookPayload(event, camera, webhook);

        this.logger.debug(`Triggering webhook: ${webhook.name || webhook.url}`);

        const response = await fetch(webhook.url, {
          method: webhook.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(webhook.headers || {}),
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          this.logger.warn(`Webhook failed: ${webhook.name || webhook.url}`, {
            status: response.status,
          });
        }
      } catch (error) {
        this.logger.error(`Webhook error: ${webhook.name || webhook.url}`, { error });
      }
    }
  }

  /**
   * Build webhook payload based on format
   */
  private buildWebhookPayload(event: RingEvent, camera: Camera | undefined, webhook: WebhookConfig): any {
    // Custom payload template
    if (webhook.payloadTemplate) {
      return webhook.payloadTemplate(event, camera);
    }

    // OpenClaw/agent invocation format
    if (webhook.format === 'openclaw') {
      return {
        event: event.eventType,
        source: event.sourceName,
        location: event.locationName,
        timestamp: event.timestamp,
        dingId: event.dingId,
        prompt: this.buildAgentPrompt(event, camera),
      };
    }

    // Discord webhook format
    if (webhook.format === 'discord') {
      return {
        content: `🔔 **${event.eventType}** detected on **${event.sourceName}**`,
        embeds: [{
          title: event.eventType.replace('_', ' ').toUpperCase(),
          fields: [
            { name: 'Camera', value: event.sourceName, inline: true },
            { name: 'Location', value: event.locationName, inline: true },
            { name: 'Time', value: new Date(event.timestamp).toLocaleString(), inline: false },
          ],
          timestamp: event.timestamp,
        }],
      };
    }

    // Default: full event payload
    return event;
  }

  /**
   * Build a prompt for agent invocation
   */
  private buildAgentPrompt(event: RingEvent, camera: Camera | undefined): string {
    const time = new Date(event.timestamp).toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (event.eventType === 'person') {
      return `Person detected on ${event.sourceName} camera at ${time}. Location: ${event.locationName}. Ding ID: ${event.dingId || 'N/A'}`;
    }

    if (event.eventType === 'doorbell_pressed') {
      return `Doorbell pressed at ${event.sourceName} at ${time}. Location: ${event.locationName}.`;
    }

    if (event.eventType === 'motion') {
      return `Motion detected on ${event.sourceName} camera at ${time}. Location: ${event.locationName}.`;
    }

    return `Event "${event.eventType}" on ${event.sourceName} at ${time}.`;
  }

  /**
   * Map push notification action to event type
   */
  private mapActionToEventType(action: string | undefined): string {
    if (!action) return 'unknown';

    switch (action) {
      case PushNotificationAction.Motion:
        return 'motion';
      case PushNotificationAction.Ding:
        return 'ding';
      case PushNotificationAction.OnDemand:
        return 'on_demand';
      default:
        return action.toLowerCase();
    }
  }

  /**
   * Register device in the database
   */
  private registerDevice(camera: Camera): void {
    const device: RegisteredDevice = {
      id: camera.id.toString(),
      name: camera.name,
      deviceType: camera.deviceType,
      locationId: camera.location.id,
      locationName: camera.location.name,
      hasLight: camera.hasLight,
      hasSiren: camera.hasSiren,
      isDoorbot: camera.isDoorbot,
      batteryLevel: camera.data?.battery_life,
      lastSeen: new Date().toISOString(),
    };

    this.eventLogger.upsertDevice(device);
  }

  /**
   * Get all registered cameras
   */
  getCameras(): Camera[] {
    return this.cameras;
  }

  /**
   * Get all locations
   */
  getLocations(): Location[] {
    return this.locations;
  }
}
