import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

export const health_checks = pgTable('health_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: varchar('provider', { length: 32 }),
  latency_ms: integer('latency_ms'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
});
