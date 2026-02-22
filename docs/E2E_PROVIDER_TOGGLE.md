# E2E Provider Test Toggle

Add the following to your CI environment to enable deterministic E2E provider tests:

E2E_PROVIDER_TESTS=true

By default, this is set to false. Manual opt-in is required for E2E provider tests.

---

**Best Practice:**
- Keep E2E_PROVIDER_TESTS disabled unless actively validating provider integration.
- Enable only for full contract validation or pre-release checks.
