# Replit deployment

This repository can run as a single URL app (UI + API) using the console server.

## Required Replit Secrets

- `ANTHROPIC_API_KEY`
- `RECEIPT_SIGNING_KEY`
- `RECEIPT_VERIFY_KEY`

## Optional Replit Secrets

- `DATABASE_URL` (if omitted, DB checks are skipped and the app still starts)
- `OPENAI_API_KEY` (only needed when using `provider=openai`)
- `GEMINI_API_KEY` (only needed when using `provider=gemini`)

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

## Quick Gemini smoke run (copy/paste)

After the app starts in Replit, open Shell and run:

```sh
curl -sS -X POST "http://127.0.0.1:${PORT:-8080}/api/run" \
	-H "content-type: application/json" \
	-d '{
		"provider": "gemini",
		"model": "gemini-1.5-flash",
		"prompt": "In 3 bullets, explain what causes ocean tides."
	}'
```
