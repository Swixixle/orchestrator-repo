# Docker Deployment Guide

## Dockerfile
- Use Node 22-alpine as base
- Install dependencies via pnpm
- Build TypeScript
- Expose port 3000
- CMD: ["node", "dist/server.js"]

## docker-compose.yml
- Services:
  - app
  - postgres (optional)
- Healthcheck for app
- Env injection for secrets
- Volume for postgres data

---

## Steps
1. Build image:
   ```
   docker build -t halo-orchestrator .
   ```
2. Run with Compose:
   ```
   docker-compose up
   ```
3. Access app at http://localhost:3000

---

## Notes
- Ensure .env is present for secrets
- Postgres is optional; remove if not needed
- Healthcheck ensures app readiness
- Use volumes for persistent database storage
