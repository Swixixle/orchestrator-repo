# Vercel Deployment Guide

## Build Command
- pnpm build

## Output Directory
- dist

## Env Var Setup
- Configure secrets in Vercel dashboard

## Runtime Caveats
- Node runtime recommended
- Edge runtime may not support all features

## Example vercel.json
```
{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "framework": null
}
```

## Known Limitations
- Edge runtime: limited API support
- Serverless: cold start latency
