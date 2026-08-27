// Comprobación aislada de Saneamiento 3. NO se ejecuta automáticamente ni forma parte de ningún
// barrido: RITUAL exige autorización expresa de Ibrahin para lanzarla.
// Demuestra que miles de 429 conservan el contrato y generan resúmenes, no una fila por rechazo.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalCwd = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'bamburu-ratelimit-'));

try {
  process.chdir(temp);
  const { initControlDb, controlDb } = await import('../core/control-db.js');
  const { rateLimit, cleanupRateLimitBuckets } = await import('../core/rate-limit.js');
  initControlDb();

  const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'saneamiento-3' });
  let status = 200;
  let retryAfter = null;
  const c = {
    env: { incoming: { socket: { remoteAddress: '198.51.100.8' } } },
    get: () => ({ slug: 'tenant-prueba' }),
    header: (name, value) => { if (name === 'Retry-After') retryAfter = value; },
    req: { path: '/api/prueba', method: 'GET', header: () => 'application/json' },
    json: (_body, code) => { status = code; return code; },
    html: (_body, code) => { status = code; return code; },
  };
  const next = async () => { status = 200; };

  for (let i = 0; i < 5_002; i++) await limiter(c, next);
  await new Promise(resolve => setTimeout(resolve, 300));
  cleanupRateLimitBuckets();

  assert.equal(status, 429);
  assert.ok(Number(retryAfter) > 0);
  assert.equal(controlDb.prepare("SELECT COUNT(*) n FROM security_events WHERE type='ratelimit:saneamiento-3'").get().n, 0);
  const summary = controlDb.prepare("SELECT COUNT(*) rows, SUM(rejected_count) rejected FROM rate_limit_summaries WHERE type='ratelimit:saneamiento-3'").get();
  assert.ok(summary.rows <= 2, `demasiadas filas persistidas: ${summary.rows}`);
  assert.equal(summary.rejected, 5_000);
  console.log('✓ 5.000 respuestas 429 agregadas en un número acotado de resúmenes');
} finally {
  process.chdir(originalCwd);
  rmSync(temp, { recursive: true, force: true });
}
