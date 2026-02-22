# Database Migration Guide

## Setup
- Install dependencies: drizzle-orm, drizzle-kit, pg
- Configure drizzle.config.ts for Postgres

## Schema
- See db/schema.ts for health_checks table:
  - id (uuid)
  - provider (varchar)
  - latency_ms (integer)
  - timestamp (timestamp)

## Migration
- Run migrations:
  ```
  npm run db:migrate
  ```

## Notes
- Postgres must be running (see docker-compose.yml)
- Migrations output to db/migrations
- Use volumes for persistent data
