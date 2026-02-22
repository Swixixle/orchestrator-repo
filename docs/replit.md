# Replit deployment

This repository can run as a single URL app (UI + API) using the console server.

## Required Replit Secrets

- `ANTHROPIC_API_KEY`
- `RECEIPT_SIGNING_KEY`
- `RECEIPT_VERIFY_KEY`

## Optional Replit Secrets

- `DATABASE_URL` (if omitted, DB checks are skipped and the app still starts)
- `OPENAI_API_KEY` (only needed when using `provider=openai`)

## Local Replit run command

The included `.replit` uses:

```sh
npm run replit:start
```

## Deployment command (Reserved VM)

Use:

```sh
npm run console:prod
```

## Notes

- The server binds to `0.0.0.0`.
- The server respects `PORT` (falls back to `CONSOLE_PORT`, then `8080`).
- Master Console UI: `/`
- Evidence Inspector UI: `/inspector`
- Health endpoint: `GET /api/health`.
