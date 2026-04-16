/**
 * Event Bus - Central pub/sub for agent communication
 *
 * Provides event-driven communication between agents with:
 * - Subscription management
 * - Event buffering for slow consumers
 * - One-time subscriptions (waitFor)
 * - At-least-once delivery semantics
 */

import { EventEmitter } from 'events';
import { EventType, WorkflowEvent } from './EventTypes.js';

interface Subscription {
  id: string;
  eventType: EventType;
  handler: (event: WorkflowEvent) => void | Promise<void>;
  once: boolean;
}

interface BufferedEvent {
  event: WorkflowEvent;
  receivedAt: number;
}

export class EventBus extends EventEmitter {
  private subscriptions: Map<string, Subscription> = new Map();
  private subscriptionCounter = 0;
  private eventBuffer: Map<EventType, BufferedEvent[]> = new Map();
  private readonly MAX_BUFFER_SIZE = 100;
  private readonly BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    // Increase max listeners to avoid warnings with many subscriptions
    this.setMaxListeners(100);
  }

  /**
   * Publish an event to all matching subscribers
   */
  async publish(event: WorkflowEvent): Promise<void> {
    // Clean up expired buffered events
    this.cleanupBuffer();

    // Emit to all matching subscriptions
    const matching = this.getSubscriptionsForEventType(event.type);

    const promises = matching.map(async (sub) => {
      if (sub.once) {
        this.subscriptions.delete(sub.id);
      }

      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`[EventBus] Handler error for ${event.type}:`, error);
        this.emit('error', error, event);
      }
    });

    await Promise.allSettled(promises);

    // Buffer event for slow consumers
    this.bufferEvent(event);

    // Also emit the event type as a string for EventEmitter compatibility
    this.emit(event.type, event);
  }

  /**
   * Subscribe to an event type
   */
  subscribe(
    eventType: EventType,
    handler: (event: WorkflowEvent) => void | Promise<void>
  ): Subscription {
    const id = `sub_${++this.subscriptionCounter}`;
    const sub: Subscription = { id, eventType, handler, once: false };
    this.subscriptions.set(id, sub);
    return sub;
  }

  /**
   * Subscribe to an event type for one time only
   */
  subscribeOnce(
    eventType: EventType,
    handler: (event: WorkflowEvent) => void | Promise<void>
  ): Subscription {
    const id = `sub_${++this.subscriptionCounter}`;
    const sub: Subscription = { id, eventType, handler, once: true };
    this.subscriptions.set(id, sub);
    return sub;
  }

  /**
   * Unsubscribe from an event
   */
  unsubscribe(subscription: Subscription): void {
    this.subscriptions.delete(subscription.id);
  }

  /**
   * Unsubscribe by ID
   */
  unsubscribeById(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * Wait for a specific event with optional timeout
   */
  waitFor(eventType: EventType, timeoutMs?: number): Promise<WorkflowEvent> {
    return new Promise((resolve, reject) => {
      // Check if event already exists in buffer
      const buffered = this.getBufferedEvents(eventType);
      if (buffered.length > 0) {
        resolve(buffered[buffered.length - 1]);
        return;
      }

      const sub = this.subscribeOnce(eventType, (event) => {
        resolve(event);
      });

      if (timeoutMs !== undefined) {
        const timeoutId = setTimeout(() => {
          this.subscriptions.delete(sub.id);
          reject(new Error(`Timeout waiting for ${eventType} after ${timeoutMs}ms`));
        }, timeoutMs);

        // Clear timeout if we do receive the event
        this.subscribeOnce(eventType, () => {
          clearTimeout(timeoutId);
        });
      }
    });
  }

  /**
   * Wait for any of the given event types
   */
  waitForAny(
    eventTypes: EventType[],
    timeoutMs?: number
  ): Promise<WorkflowEvent> {
    return new Promise((resolve, reject) => {
      const subscriptions: Subscription[] = [];

      const cleanup = () => {
        subscriptions.forEach((sub) => this.subscriptions.delete(sub.id));
      };

      const handler = (event: WorkflowEvent) => {
        cleanup();
        resolve(event);
      };

      eventTypes.forEach((type) => {
        const sub = this.subscribeOnce(type, handler);
        subscriptions.push(sub);
      });

      if (timeoutMs !== undefined) {
        setTimeout(() => {
          cleanup();
          reject(new Error(`Timeout waiting for any of ${eventTypes.join(', ')} after ${timeoutMs}ms`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Wait for all given events (AND semantics)
   */
  waitForAll(
    eventTypes: EventType[],
    timeoutMs?: number
  ): Promise<WorkflowEvent[]> {
    return new Promise((resolve, reject) => {
      const results: WorkflowEvent[] = [];
      const pending = new Set(eventTypes);
      const subscriptions: Subscription[] = [];

      const cleanup = () => {
        subscriptions.forEach((sub) => this.subscriptions.delete(sub.id));
      };

      eventTypes.forEach((type) => {
        const sub = this.subscribeOnce(type, (event) => {
          results.push(event);
          pending.delete(type);
          if (pending.size === 0) {
            cleanup();
            resolve(results);
          }
        });
        subscriptions.push(sub);
      });

      if (timeoutMs !== undefined) {
        setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `Timeout waiting for all of ${eventTypes.join(', ')} after ${timeoutMs}ms. ` +
              `Still waiting for: ${Array.from(pending).join(', ')}`
            )
          );
        }, timeoutMs);
      }
    });
  }

  /**
   * Get all current subscriptions
   */
  getSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Get subscriptions for a specific event type
   */
  getSubscriptionsForType(eventType: EventType): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.eventType === eventType
    );
  }

  /**
   * Get subscriber count for an event type
   */
  getSubscriberCount(eventType: EventType): number {
    return this.getSubscriptionsForType(eventType).length;
  }

  /**
   * Get buffered events for an event type
   */
  getBufferedEvents(eventType: EventType): WorkflowEvent[] {
    const buffered = this.eventBuffer.get(eventType);
    if (!buffered) return [];

    const now = Date.now();
    return buffered
      .filter((b) => now - b.receivedAt < this.BUFFER_TTL_MS)
      .map((b) => b.event);
  }

  /**
   * Get all buffered event types
   */
  getBufferedEventTypes(): EventType[] {
    return Array.from(this.eventBuffer.keys()).filter(
      (type) => this.getBufferedEvents(type).length > 0
    );
  }

  /**
   * Clear all subscriptions
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
  }

  /**
   * Clear all buffered events
   */
  clearBuffer(): void {
    this.eventBuffer.clear();
  }

  /**
   * Get bus statistics
   */
  getStats(): {
    totalSubscriptions: number;
    subscriptionsByType: Record<string, number>;
    bufferedEventTypes: number;
    totalBufferedEvents: number;
  } {
    const subsByType: Record<string, number> = {};
    let totalBuffered = 0;

    this.subscriptions.forEach((sub) => {
      subsByType[sub.eventType] = (subsByType[sub.eventType] || 0) + 1;
    });

    this.eventBuffer.forEach((buffered) => {
      totalBuffered += buffered.length;
    });

    return {
      totalSubscriptions: this.subscriptions.size,
      subscriptionsByType: subsByType,
      bufferedEventTypes: this.eventBuffer.size,
      totalBufferedEvents: totalBuffered,
    };
  }

  // Private helpers

  private getSubscriptionsForEventType(eventType: EventType): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.eventType === eventType
    );
  }

  private bufferEvent(event: WorkflowEvent): void {
    const buffer = this.eventBuffer.get(event.type) || [];
    buffer.push({ event, receivedAt: Date.now() });

    // Trim buffer if too large
    while (buffer.length > this.MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    this.eventBuffer.set(event.type, buffer);
  }

  private cleanupBuffer(): void {
    const now = Date.now();
    this.eventBuffer.forEach((buffer, type) => {
      const filtered = buffer.filter((b) => now - b.receivedAt < this.BUFFER_TTL_MS);
      if (filtered.length === 0) {
        this.eventBuffer.delete(type);
      } else {
        this.eventBuffer.set(type, filtered);
      }
    });
  }
}

// ============================================================
// Singleton instance for global event bus
// ============================================================

let globalEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.clearSubscriptions();
    globalEventBus.clearBuffer();
  }
  globalEventBus = new EventBus();
}
