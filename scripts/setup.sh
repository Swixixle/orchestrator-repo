#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

HALO_RECEIPTS_PIN="github:Swixixle/HALO-RECEIPTS#f58fcace72640689ecc5d0110feafbb08a3424d9"

log() {
  printf '\n[setup] %s\n' "$1"
}

fail() {
  printf '\n[setup] ERROR: %s\n' "$1" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

npm_script_exists() {
  node -e 'const fs=require("fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1);' "$1"
}

require_prereqs() {
  log "Checking prerequisites"

  have_cmd node || fail "node is required"
  have_cmd npm || fail "npm is required"
  have_cmd git || fail "git is required"

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$node_major" -lt 22 ]]; then
    fail "Node.js >= 22 is required (detected: $(node -v))"
  fi

  log "Detected node $(node -v), npm $(npm -v), git $(git --version | awk '{print $3}')"
}

install_orchestrator_deps() {
  log "Installing orchestrator dependencies"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
}

install_halo_receipts() {
  log "Installing pinned halo-receipts dependency: ${HALO_RECEIPTS_PIN}"
  npm install --no-save "$HALO_RECEIPTS_PIN"

  if [[ ! -d node_modules/halo-receipts ]]; then
    fail "halo-receipts was not found in node_modules after install"
  fi
}

build_halo_receipts() {
  log "Building halo-receipts package entrypoint"

  pushd node_modules/halo-receipts >/dev/null
  npm install

  if [[ ! -x node_modules/.bin/tsx ]]; then
    fail "tsx binary missing inside halo-receipts"
  fi

  node_modules/.bin/tsx -e "
    import { build } from 'esbuild';
    await build({
      entryPoints: ['index.ts'],
      platform: 'node',
      bundle: true,
      format: 'esm',
      outfile: 'dist/index.js',
      external: ['crypto']
    });
  "

  popd >/dev/null
}

build_orchestrator() {
  log "Building orchestrator"
  if npm_script_exists build; then
    npm run build
  else
    log "No npm build script found; skipping orchestrator build"
  fi
}

run_smoke_checks() {
  log "Running deterministic unit tests"
  npm test

  if npm_script_exists ui:smoke; then
    log "Running UI smoke test"
    npm run ui:smoke
  else
    log "ui:smoke script not found; skipping"
  fi

  log "Running offline artifact verification smoke"
  npm run verify -- --artifact samples/evidence-inspector/artifact.valid.json
}

print_summary() {
  log "SUCCESS"
  cat <<'EOF'

Setup completed successfully.

Next commands:
  - Live demo (requires OPENAI_API_KEY):
      OPENAI_API_KEY=sk-... npm run demo -- --prompt "Explain what causes ocean tides."

  - Valet bridge ingest:
      VALET_RECEIPT_HMAC_KEY=... RECEIPT_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" npm run ingest-valet -- dist/<slug>/

  - Evidence Inspector production serve:
      npm run ui:prod

Artifact output locations:
  - Demo outputs: out/
  - Valet checkpoint outputs: dist/<slug>/halo_checkpoint/

EOF

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    log "OPENAI_API_KEY is not set. Offline setup is complete; export the key only when running live demo/E2E."
  fi
}

main() {
  require_prereqs
  install_orchestrator_deps
  install_halo_receipts
  build_halo_receipts
  build_orchestrator
  run_smoke_checks
  print_summary
}

main "$@"
