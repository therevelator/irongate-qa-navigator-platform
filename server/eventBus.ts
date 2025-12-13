import { EventEmitter } from 'events';

export type JobNotificationPayload = {
  source: 'pipeline' | 'metrics' | 'analytics';
  frequency: '5-min' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'startup';
  message: string;
  updatedMetrics?: string[];
  timestamp: string;
};

export const jobEvents = new EventEmitter();

export type JobEventName = 'job-notification';

export function emitJobNotification(payload: JobNotificationPayload) {
  jobEvents.emit('job-notification', payload);
}
