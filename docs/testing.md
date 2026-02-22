# Deterministic E2E Provider Toggle

## E2E_PROVIDER_TESTS Environment Variable

- Set `E2E_PROVIDER_TESTS=true` to enable provider E2E tests in CI.
- Default: `false` (E2E tests are skipped unless manually opted in).
- Add to your CI config:

```
# Enable E2E provider tests
E2E_PROVIDER_TESTS=true
```

---

## Manual Opt-In

- To run E2E provider tests locally:

```
E2E_PROVIDER_TESTS=true npm run test:e2e
```

---

**Note:** E2E tests require valid API keys and may incur provider charges.
