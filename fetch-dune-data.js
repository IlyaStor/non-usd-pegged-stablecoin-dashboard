#!/usr/bin/env node

/**
 * Refresh data.json from Dune.
 *
 * Each query is executed (POST /query/{id}/execute) unless a completed result
 * is already younger than DUNE_FRESHNESS_HOURS (default 20). The site schedule
 * is every 2 days, so a normal run still executes. A same-day retry reuses the
 * result instead of spending another execution.
 *
 * Status polls use GET /execution/{id}/status, which Dune does not bill.
 * Performance tier defaults to medium (override with DUNE_PERFORMANCE=small|medium|large).
 * Large is avoided because it burns more credits.
 *
 * Secret: DUNE_API_KEY (GitHub Actions). The value is never printed.
 *
 *   DUNE_API_KEY=... node fetch-dune-data.js
 *   node fetch-dune-data.js --self-test
 */

import { readFileSync, renameSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import {
  COVERAGE_NOTE,
  QUERIES,
  coverageFromNetworks,
  dropPartialDays,
  earliestIso,
  normalizeIso,
  rowsToPipe,
  utcDay,
} from './lib/series.js';

const DUNE_BASE = 'https://api.dune.com/api/v1';
const PERFORMANCE = ['small', 'medium', 'large'].includes(process.env.DUNE_PERFORMANCE)
  ? process.env.DUNE_PERFORMANCE
  : 'medium';
const FRESHNESS_HOURS = Number(process.env.DUNE_FRESHNESS_HOURS) > 0
  ? Number(process.env.DUNE_FRESHNESS_HOURS)
  : 20;
const CONCURRENCY = 2;
const POLL_MS = 4000;
const MAX_WAIT_MS = 12 * 60 * 1000;

const TERMINAL = new Set([
  'QUERY_STATE_COMPLETED',
  'QUERY_STATE_FAILED',
  'QUERY_STATE_CANCELED',
  'QUERY_STATE_CANCELLED',
  'QUERY_STATE_EXPIRED',
  'QUERY_STATE_COMPLETED_PARTIAL',
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isFresh(iso) {
  const t = Date.parse(normalizeIso(iso));
  if (!t || Number.isNaN(t)) return false;
  return Date.now() - t < FRESHNESS_HOURS * 3600 * 1000;
}

async function dune(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${DUNE_BASE}${path}`, {
    method,
    headers: {
      'X-Dune-API-Key': process.env.DUNE_API_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const message = typeof json.error === 'string'
      ? json.error
      : (json.error?.message || text.slice(0, 300) || res.statusText);
    const err = new Error(`Dune ${method} ${path} -> ${res.status} ${message}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function fetchAllRows(resultsPath) {
  const rows = [];
  let offset = 0;
  let envelope = null;
  for (let page = 0; page < 40; page++) {
    const data = await dune(`${resultsPath}?limit=1000&offset=${offset}`);
    envelope = data;
    const batch = data.result?.rows || [];
    rows.push(...batch);
    const next = data.next_offset;
    if (next == null || next === offset || batch.length === 0) break;
    offset = next;
  }
  return { rows, envelope };
}

async function executeQuery(queryId) {
  let attempt = 0;
  while (true) {
    try {
      const started = await dune(`/query/${queryId}/execute`, {
        method: 'POST',
        body: { performance: PERFORMANCE },
      });
      if (!started.execution_id) {
        throw new Error(`Query ${queryId} did not return an execution_id`);
      }
      return started.execution_id;
    } catch (err) {
      attempt += 1;
      const retryable = err.status === 429 || /inflight|queue|concurrent|rate|too many/i.test(err.message);
      if (!retryable || attempt > 5) throw err;
      console.log(`  Query ${queryId} is waiting for an execution slot (${attempt}/5)`);
      await sleep(15000);
    }
  }
}

async function pollExecution(executionId, queryId) {
  const started = Date.now();
  let lastLog = 0;
  while (Date.now() - started < MAX_WAIT_MS) {
    const status = await dune(`/execution/${executionId}/status`);
    const state = status.state;
    if (status.is_execution_finished || TERMINAL.has(state)) return status;
    if (Date.now() - lastLog > 30000) {
      const waited = Math.round((Date.now() - started) / 1000);
      console.log(`    Query ${queryId} ${state || 'running'} (${waited}s)`);
      lastLog = Date.now();
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Query ${queryId} timed out after 12 minutes (execution ${executionId})`);
}

function assertCompleted(status, queryId) {
  if (status.state === 'QUERY_STATE_COMPLETED') return;
  if (status.state === 'QUERY_STATE_COMPLETED_PARTIAL') {
    throw new Error(`Query ${queryId} result was truncated; refusing to publish a partial set`);
  }
  const detail = status.error?.message || status.error || status.state || 'unknown state';
  throw new Error(`Query ${queryId} ${status.state || 'did not complete'}: ${detail}`);
}

/**
 * Return rows plus the Dune execution that produced them.
 * Reuses a completed execution inside the freshness window.
 */
export async function fetchQuery(queryId) {
  const latest = await dune(`/query/${queryId}/results?limit=1&offset=0`);
  const latestState = latest.state;
  const latestEnded = latest.execution_ended_at || null;

  if ((latestState === 'QUERY_STATE_PENDING' || latestState === 'QUERY_STATE_EXECUTING') && latest.execution_id) {
    console.log(`  Query ${queryId} is already running (${latest.execution_id}); waiting, not starting another`);
    const status = await pollExecution(latest.execution_id, queryId);
    assertCompleted(status, queryId);
    const { rows } = await fetchAllRows(`/execution/${status.execution_id}/results`);
    return metaFrom(queryId, status, rows, false);
  }

  if (latestState === 'QUERY_STATE_COMPLETED' && isFresh(latestEnded)) {
    console.log(`  Query ${queryId} reusing execution from ${latestEnded} (under ${FRESHNESS_HOURS}h)`);
    const { rows, envelope } = await fetchAllRows(`/query/${queryId}/results`);
    return metaFrom(queryId, envelope || latest, rows, true);
  }

  console.log(`  Query ${queryId} executing on the ${PERFORMANCE} tier (latest was ${latestEnded || latestState || 'missing'})`);
  const executionId = await executeQuery(queryId);
  console.log(`    Execution ${executionId}`);
  const status = await pollExecution(executionId, queryId);
  assertCompleted(status, queryId);
  if (status.execution_cost_credits != null) {
    console.log(`    Credits reported for ${queryId}: ${status.execution_cost_credits}`);
  }
  const { rows } = await fetchAllRows(`/execution/${executionId}/results`);
  return metaFrom(queryId, status, rows, false);
}

function metaFrom(queryId, status, rows, reused) {
  return {
    id: queryId,
    execution_id: status.execution_id || null,
    execution_ended_at: status.execution_ended_at || null,
    state: status.state || null,
    reused,
    row_count: rows.length,
    rows,
  };
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function buildPayload(fetchOne = fetchQuery) {
  const jobs = [];
  for (const [network, ids] of Object.entries(QUERIES)) {
    for (const id of ids) jobs.push({ network, id });
  }

  console.log(`Fetching ${jobs.length} Dune queries, ${CONCURRENCY} at a time, tier=${PERFORMANCE}, reuse<${FRESHNESS_HOURS}h`);
  const fetched = await mapPool(jobs, CONCURRENCY, async job => {
    console.log(`\n${job.network} query ${job.id}`);
    const result = await fetchOne(job.id);
    return { ...job, ...result };
  });

  const data = {};
  const executions = {};

  for (const network of Object.keys(QUERIES)) {
    const parts = fetched.filter(item => item.network === network);
    let rows = [];
    for (const part of parts) {
      const ended = part.execution_ended_at || new Date().toISOString();
      const kept = dropPartialDays(part.rows, ended);
      const cut = utcDay(ended);
      console.log(`  ${network}/${part.id}: ${part.rows.length} rows, ${kept.length} after dropping ${cut || 'no cutoff'} and later`);
      if (!kept.length) {
        throw new Error(`Query ${part.id} (${network}) had no rows after dropping the partial day`);
      }
      rows = rows.concat(kept);
    }
    const pipe = rowsToPipe(rows, network, message => console.warn(message));
    if (!pipe.trim()) throw new Error(`${network} produced an empty series`);
    data[network] = pipe;
    const executionEndedAt = earliestIso(parts.map(part => part.execution_ended_at));
    executions[network] = {
      execution_ended_at: executionEndedAt,
      queries: parts.map(part => ({
        id: part.id,
        execution_id: part.execution_id,
        execution_ended_at: part.execution_ended_at,
        reused: part.reused,
        row_count: part.row_count,
      })),
    };
  }

  const coverage = coverageFromNetworks(data);
  const timestamp = earliestIso(Object.values(executions).map(item => item.execution_ended_at));
  return {
    success: true,
    timestamp,
    coverage: {
      exhaustive: false,
      note: COVERAGE_NOTE,
      tokens: coverage.tokens,
      chains: coverage.chains,
    },
    executions,
    data,
  };
}

async function main() {
  if (!process.env.DUNE_API_KEY) {
    console.error('ERROR: DUNE_API_KEY environment variable is not set');
    process.exit(1);
  }
  console.log('DUNE_API_KEY is set');

  const payload = await buildPayload();
  const json = JSON.stringify(payload);
  writeFileSync('data.json.tmp', json);
  renameSync('data.json.tmp', 'data.json');
  console.log(`\nWrote data.json (${json.length} bytes), oldest execution ${payload.timestamp}`);

  const { generateOg } = await import('./generate-og.js');
  await generateOg('data.json', 'og.png');
  console.log('Wrote og.png');
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function selfTest() {
  const rows = [
    { date: '2026-11-05 00:00:00.000 UTC', token: 'Euro - EURC', daily_transactions: '10', transfer_volume_usd: '100' },
    { date: '2026-11-04', token: 'EURC', daily_transactions: '3', transfer_volume_usd: '50' },
    { date: '2026-11-04', token: 'EURC', daily_transactions: '2', transfer_volume_usd: '25' },
    { date: '2026-11-03', token: 'Brazilian rial - BRLA', daily_transactions: '1', transfer_volume: '10' },
  ];
  const kept = dropPartialDays(rows, '2026-11-05T00:05:00.123456789Z');
  assert(kept.length === 3, 'partial execution day must be removed');
  assert(kept.every(row => !String(row.date).startsWith('2026-11-05')), 'Nov 5 rows must be gone');

  const pipe = rowsToPipe(kept, 'solana', () => {});
  assert(pipe.startsWith('2026-11-04|EURC|5|75.00'), `unexpected pipe head: ${pipe}`);
  assert(pipe.includes('BRLA|1|2.00'), 'FX fallback should price BRLA');
  assert(!pipe.includes('2026-11-05'), 'pipe must not contain the partial day');

  const oldest = earliestIso([
    '2026-11-05T02:00:00.000000000Z',
    '2026-11-04T23:00:00.000000000Z',
  ]);
  assert(utcDay(oldest) === '2026-11-04', 'network timestamp is the older execution');
  assert(!Number.isNaN(Date.parse(normalizeIso(oldest))), 'nanosecond timestamps must parse');

  const workflow = readFileSync('.github/workflows/refresh-data.yml', 'utf8');
  assert(workflow.includes('secrets.DUNE_API_KEY'), 'workflow must keep the DUNE_API_KEY secret name');
  assert(!workflow.includes('secrets.REDIS_URL'), 'workflow must not read the REDIS_URL secret');
  assert(workflow.includes('fetch-dune-data.js'), 'workflow must run the fetch script');
  assert(!workflow.includes('/api/crons'), 'workflow must not call the removed cron route');

  const index = readFileSync('index.html', 'utf8');
  assert(index.includes('twitter:card') && index.includes('summary_large_image'), 'twitter card missing');
  assert(index.includes('og:image'), 'og:image missing');
  assert(index.includes('defer'), 'CDN script should be deferred');
  assert(index.includes('https://x.com/scipiosiberian'), 'X profile link missing');
  assert(index.includes('Download PNG') && index.includes('Download CSV'), 'chart downloads missing');
  assert(index.includes('not exhaustive'), 'coverage caveat missing');
  assert(index.includes('Tracked volume'), 'tracked-volume wording missing');
  assert(!index.includes('/api/dashboard-data'), 'index must not call the removed API');

  const source = readFileSync('fetch-dune-data.js', 'utf8');
  assert(source.includes('/execute'), 'fetch script must trigger execution');
  assert(!/DUNE_API_KEY\.substring/.test(source), 'do not log any part of the API key');

  console.log('self-test ok');
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  if (process.argv.includes('--self-test')) {
    try {
      selfTest();
    } catch (error) {
      console.error('SELF-TEST FAILED:', error.message);
      process.exit(1);
    }
  } else {
    main().catch(error => {
      console.error('ERROR:', error.message);
      process.exit(1);
    });
  }
}
