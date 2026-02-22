# Evidence Inspector Production Deployment

This guide describes production deployment options for the Evidence Inspector UI.

## 1) Build

```sh
npm ci
npm run ui:build
npm run ui:build:server
```

Build outputs:

- Static UI bundle: `ui/dist/`
- Production server entry: `dist/server/uiServer.js`

## 2) Serve locally (production mode)

```sh
npm run ui:serve
```

Defaults:

- Host: `0.0.0.0`
- Port: `8080`
- Base path: `/`

Startup log example:

```text
Evidence Inspector running at http://localhost:8080/
```

One-command production run:

```sh
npm run ui:prod
```

## 3) Serve behind a reverse proxy

If deploying under a subpath (for example `/evidence/`), set base path at build and runtime:

```sh
UI_BASE_PATH=/evidence/ npm run ui:build
npm run ui:build:server
UI_BASE_PATH=/evidence/ UI_PORT=8080 npm run ui:serve
```

### Nginx example

```nginx
server {
  listen 80;
  server_name _;

  location /evidence/assets/ {
    proxy_pass http://127.0.0.1:8080/evidence/assets/;
    proxy_set_header Host $host;
  }

  location /evidence/ {
    proxy_pass http://127.0.0.1:8080/evidence/;
    proxy_set_header Host $host;
  }
}
```

## 4) Static hosting

The deployable static folder is:

- `ui/dist/`

Supported platforms:

- Netlify
- Vercel (static output)
- S3 + CloudFront
- GitHub Pages

### SPA redirect requirements

For static hosts, configure fallback to `index.html` for client-side routes.

- Netlify: add `ui/dist/_redirects` with:
  - Root app: `/* /index.html 200`
  - Subpath app: `/evidence/* /evidence/index.html 200`
- Vercel: configure rewrites in `vercel.json`
- S3/CloudFront: set error document rewrite to `index.html`
- GitHub Pages: use SPA fallback strategy (`404.html` redirect technique)

### Base path reminders

When serving under `/evidence/`, build with:

```sh
UI_BASE_PATH=/evidence/ npm run ui:build
```

This ensures asset URLs are emitted with the same base prefix.

## 5) Operational notes

- The UI reads artifact JSON files client-side in the browser.
- No backend artifact ingestion endpoint is enabled by default.
- Do not embed secrets in Vite env vars (anything prefixed with `VITE_` is bundled client-side).
- Leak scan warnings and export-blocking behavior remain active in production.

## 6) Smoke verification

Run:

```sh
npm run ui:smoke
```

This performs:

1. production build
2. production server startup
3. HTTP checks for `/`, a built asset, and a deep-link SPA route
