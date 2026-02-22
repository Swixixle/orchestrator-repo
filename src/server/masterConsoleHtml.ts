export function renderMasterConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HALO Console</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background: #0b1220; color: #e5e7eb; }
    .app { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    .nav { border-right: 1px solid #1f2937; padding: 16px; background: #0f172a; }
    .nav h1 { font-size: 16px; margin: 0 0 16px; }
    .nav button, .nav a { width: 100%; margin: 6px 0; padding: 10px; border: 1px solid #334155; border-radius: 8px; background: #111827; color: #e5e7eb; text-align: left; cursor: pointer; text-decoration: none; display: block; box-sizing: border-box; }
    .main { padding: 18px; }
    .panel { display: none; max-width: 980px; }
    .panel.active { display: block; }
    .card { background: #111827; border: 1px solid #334155; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    label { display: block; margin: 8px 0 6px; font-size: 13px; color: #cbd5e1; }
    input, select, textarea, button { font: inherit; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #374151; border-radius: 8px; background: #0b1220; color: #e5e7eb; padding: 10px; }
    textarea { min-height: 140px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .btn { border: 1px solid #475569; border-radius: 8px; background: #1d4ed8; color: #fff; padding: 9px 12px; cursor: pointer; }
    .btn.secondary { background: #111827; }
    pre { background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #1f2937; padding: 8px; text-align: left; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
    .status.ok { background: #064e3b; color: #6ee7b7; }
    .status.bad { background: #7f1d1d; color: #fecaca; }
    .muted { color: #94a3b8; font-size: 12px; }
  </style>
</head>
<body>
  <div class="app">
    <aside class="nav">
      <h1>HALO Console</h1>
      <button data-panel="run">Run Pipeline</button>
      <button data-panel="verify">Verify Artifact</button>
      <button data-panel="leak">Leak Scan</button>
      <button data-panel="history">Run History</button>
      <a href="/inspector" target="_blank" rel="noreferrer">Inspector</a>
    </aside>
    <main class="main">
      <section id="panel-run" class="panel active">
        <div class="card">
          <h2>Run Pipeline</h2>
          <div class="row">
            <div>
              <label>Provider</label>
              <select id="run-provider">
                <option value="anthropic">anthropic</option>
                <option value="openai">openai</option>
                <option value="gemini">gemini</option>
              </select>
            </div>
            <div>
              <label>Model</label>
              <input id="run-model" value="claude-3-5-sonnet-20241022" />
            </div>
          </div>
          <label>Prompt</label>
          <textarea id="run-prompt" placeholder="Ask a question..."></textarea>
          <div class="actions">
            <button class="btn" id="run-submit">Run</button>
            <a class="btn secondary" href="/inspector" target="_blank" rel="noreferrer">Open Inspector</a>
          </div>
          <pre id="run-output"></pre>
        </div>
      </section>

      <section id="panel-verify" class="panel">
        <div class="card">
          <h2>Verify Artifact</h2>
          <label>Artifact path</label>
          <input id="verify-path" placeholder="out/console/<run>.console_artifact.json" />
          <div class="actions">
            <button class="btn" id="verify-submit">Verify</button>
          </div>
          <pre id="verify-output"></pre>
        </div>
      </section>

      <section id="panel-leak" class="panel">
        <div class="card">
          <h2>Leak Scan</h2>
          <label>Payload JSON</label>
          <textarea id="leak-input">{"sample":"text"}</textarea>
          <div class="actions">
            <button class="btn" id="leak-submit">Scan</button>
          </div>
          <pre id="leak-output"></pre>
        </div>
      </section>

      <section id="panel-history" class="panel">
        <div class="card">
          <h2>Run History</h2>
          <div class="actions"><button class="btn" id="history-refresh">Refresh</button></div>
          <table>
            <thead><tr><th>Timestamp</th><th>Provider</th><th>Model</th><th>Status</th><th>Prompt hash</th><th>Actions</th></tr></thead>
            <tbody id="history-body"></tbody>
          </table>
          <p class="muted">Status + prompt hash only (no full prompt in table).</p>
        </div>
        <div class="card">
          <h3>Run Detail</h3>
          <pre id="history-detail"></pre>
        </div>
      </section>
    </main>
  </div>

  <script>
    const panels = document.querySelectorAll('.panel');
    document.querySelectorAll('[data-panel]').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = button.getAttribute('data-panel');
        panels.forEach((el) => el.classList.remove('active'));
        document.getElementById('panel-' + panel)?.classList.add('active');
      });
    });

    function pretty(value) {
      return JSON.stringify(value, null, 2);
    }

    async function call(path, options = {}) {
      const response = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const body = await response.json().catch(() => ({ ok: false, error: 'invalid json response' }));
      if (!response.ok) throw new Error(body.error || 'request failed');
      return body;
    }

    const runOutput = document.getElementById('run-output');
    const runProvider = document.getElementById('run-provider');
    const runModel = document.getElementById('run-model');

    runProvider.addEventListener('change', () => {
      if (runProvider.value === 'anthropic') runModel.value = 'claude-3-5-sonnet-20241022';
      else if (runProvider.value === 'gemini') runModel.value = 'gemini-1.5-flash';
      else runModel.value = 'gpt-4.1-mini';
    });

    document.getElementById('run-submit').addEventListener('click', async () => {
      runOutput.textContent = 'Running...';
      try {
        const payload = {
          provider: runProvider.value,
          model: runModel.value,
          prompt: document.getElementById('run-prompt').value,
        };
        const result = await call('/api/run', { method: 'POST', body: JSON.stringify(payload) });
        runOutput.textContent = pretty(result);
        document.getElementById('verify-path').value = result.artifactPath || '';
        await loadHistory();
      } catch (error) {
        runOutput.textContent = String(error);
      }
    });

    const verifyOutput = document.getElementById('verify-output');
    document.getElementById('verify-submit').addEventListener('click', async () => {
      verifyOutput.textContent = 'Verifying...';
      try {
        const artifactPath = document.getElementById('verify-path').value;
        const result = await call('/api/verify', { method: 'POST', body: JSON.stringify({ artifactPath }) });
        verifyOutput.textContent = pretty(result);
      } catch (error) {
        verifyOutput.textContent = String(error);
      }
    });

    const leakOutput = document.getElementById('leak-output');
    document.getElementById('leak-submit').addEventListener('click', async () => {
      leakOutput.textContent = 'Scanning...';
      try {
        const payload = JSON.parse(document.getElementById('leak-input').value || '{}');
        const result = await call('/api/leak-scan', { method: 'POST', body: JSON.stringify(payload) });
        leakOutput.textContent = pretty(result);
      } catch (error) {
        leakOutput.textContent = String(error);
      }
    });

    const historyBody = document.getElementById('history-body');
    const historyDetail = document.getElementById('history-detail');

    async function reverify(run) {
      const result = await call('/api/verify', { method: 'POST', body: JSON.stringify({ artifactPath: run.artifactPath }) });
      historyDetail.textContent = pretty(result);
      await loadHistory();
    }

    async function tamper(run) {
      const result = await call('/api/runs/' + encodeURIComponent(run.runId) + '/tamper', { method: 'POST', body: JSON.stringify({}) });
      historyDetail.textContent = pretty(result);
      await loadHistory();
    }

    async function viewRun(run) {
      const detail = await call('/api/runs/' + encodeURIComponent(run.runId));
      historyDetail.textContent = pretty(detail);
    }

    async function loadHistory() {
      historyBody.innerHTML = '';
      try {
        const result = await call('/api/runs');
        for (const run of result.runs || []) {
          const tr = document.createElement('tr');
          const statusClass = run.status === 'tampered' ? 'bad' : 'ok';
          tr.innerHTML = '<td>' + (run.createdAt || '') + '</td>' +
            '<td>' + run.provider + '</td>' +
            '<td>' + run.model + '</td>' +
            '<td><span class="status ' + statusClass + '">' + run.status + '</span></td>' +
            '<td>' + (run.promptHash || '').slice(0, 16) + '…</td>' +
            '<td></td>';

          const actions = tr.lastChild;
          const viewBtn = document.createElement('button');
          viewBtn.className = 'btn secondary';
          viewBtn.textContent = 'View';
          viewBtn.onclick = () => viewRun(run);

          const verifyBtn = document.createElement('button');
          verifyBtn.className = 'btn secondary';
          verifyBtn.textContent = 'Re-Verify';
          verifyBtn.onclick = () => reverify(run);

          const tamperBtn = document.createElement('button');
          tamperBtn.className = 'btn secondary';
          tamperBtn.textContent = 'Simulate Tamper';
          tamperBtn.onclick = () => tamper(run);

          const dl = document.createElement('a');
          dl.className = 'btn secondary';
          dl.textContent = 'Download';
          dl.href = '/api/runs/' + encodeURIComponent(run.runId) + '/artifact';

          actions.append(viewBtn, verifyBtn, tamperBtn, dl);
          historyBody.appendChild(tr);
        }
      } catch (error) {
        historyDetail.textContent = String(error);
      }
    }

    document.getElementById('history-refresh').addEventListener('click', loadHistory);
    loadHistory();
  </script>
</body>
</html>`;
}
