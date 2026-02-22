# Contract Test Workflow

## Required Files
- `.env.contract` (see example)

## Required API Keys
- Provider keys for OpenAI, Anthropic, Gemini

## Expected Costs
- Each contract test may incur minimal API charges (prompt: "Return the word HALO exactly.")

## Rate Limiting
- Providers may enforce rate limits; tests are designed for minimal load but may require retry logic if limits are hit.

---

Run contract tests:

```
npm run contract:test
```

---

**Note:** Ensure `.env.contract` is properly configured before running.
