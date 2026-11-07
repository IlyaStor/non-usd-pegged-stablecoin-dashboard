#!/usr/bin/env node

/**
 * Refresh data.json from Dune.
 *
 * POST /query/{id}/execute is skipped when a completed result is younger than
 * DUNE_FRESHNESS_HOURS (default 20) or when refresh-state.json already has an
 * execution that is still queued or running. Status polls use
 * GET /execution/{id}/status, which Dune does not bill.
 *
 * Every execution we have already submitted is polled until it finishes or the
 * job budget ends (default 36 minutes). The budget is the only wait cap: a
 * shorter per-query cap previously abandoned Solana while it was still
 * executing and while the Actions job had time left. At the budget, open
 * executions stay running on Dune, finished networks are written, and the
 * process exits non-zero. A later run resumes the saved ids and does not POST
 * /execute for them again.
 *
 * Performance tier defaults to medium. Secret: DUNE_API_KEY. The value is never printed.
 *
 *   DUNE_API_KEY=... node fetch-dune-data.js
 *   node fetch-dune-data.js --self-test
 */

import { readFileSync, renameSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import {
  QUERIES,
  dropPartialDays,
  normalizeIso,
  rowsToPipe,
  utcDay,
} from './lib/series.js';
import {
  OPEN_STATES,
  decideQueryAction,
  mergeRefresh,
  mergeState,
  networkUpdate,
  pollUntil,
} from './lib/refresh-plan.js';

const DUNE_BASE = 'https://api.dune.com/api/v1';
const STATE_PATH = 'refresh-state.json';
const DATA_PATH = 'data.json';
const PERFORMANCE = ['small', 'medium', 'large'].includes(process.env.DUNE_PERFORMANCE)
  ? process.env.DUNE_PERFORMANCE
  : 'medium';
const FRESHNESS_HOURS = Number(process.env.DUNE_FRESHNESS_HOURS) > 0
  ? Number(process.env.DUNE_FRESHNESS_HOURS)
  : 20;
const FRESHNESS_MS = FRESHNESS_HOURS * 60 * 60 * 1000;
const CONCURRENCY = 2;
const POLL_MS = 4000;

function minutes(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const JOB_WAIT_MS = minutes('DUNE_JOB_WAIT_MINUTES', 36) * 60 * 1000;
const MIN_START_MS = 3 * 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
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

const liveDune = {
  latest(queryId) {
    return dune(`/query/${queryId}/results?limit=1&offset=0`);
  },
  async execute(queryId) {
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
  },
  status(executionId) {
    return dune(`/execution/${executionId}/status`);
  },
  rows(executionId) {
    return fetchAllRows(`/execution/${executionId}/results`);
  },
};

function remember(bundle, patch) {
  bundle.state = mergeState(bundle.state, [patch]);
  if (bundle.persist) bundle.persist(bundle.state);
  return bundle.state;
}

async function followExecution(queryId, executionId, deps, { reused, allowReplacement }) {
  const started = deps.now();
  const polled = await pollUntil({
    getStatus: async () => {
      try {
        return await deps.dune.status(executionId);
      } catch (error) {
        if (error.status === 404) {
          return {
            state: 'QUERY_STATE_EXPIRED',
            is_execution_finished: true,
            execution_id: executionId,
            error: error.message,
          };
        }
        throw error;
      }
    },
    sleep: deps.sleep,
    now: deps.now,
    deadlineMs: deps.jobDeadline,
    intervalMs: deps.pollMs,
  });
  const status = polled.status || {};
  const state = status.state || (polled.done ? null : 'QUERY_STATE_EXECUTING');
  remember(deps.bundle, {
    id: queryId,
    network: deps.network,
    execution_id: status.execution_id || executionId,
    state,
    execution_ended_at: status.execution_ended_at ? normalizeIso(status.execution_ended_at) : null,
  });

  if (!polled.done) {
    const waited = Math.round((deps.now() - started) / 1000);
    console.log(`  Query ${queryId} still ${state} after ${waited}s (execution ${executionId}). Leaving it running; a re-run resumes this id and does not start another.`);
    return {
      id: queryId,
      execution_id: executionId,
      state,
      inProgress: true,
      reused: false,
      rows: null,
    };
  }

  if (state === 'QUERY_STATE_COMPLETED') {
    if (status.execution_cost_credits != null && !reused) {
      console.log(`    Credits reported for ${queryId}: ${status.execution_cost_credits}`);
    }
    const { rows } = await deps.dune.rows(status.execution_id || executionId);
    const ended = status.execution_ended_at ? normalizeIso(status.execution_ended_at) : null;
    const keptRows = dropPartialDays(rows, ended || new Date(deps.now()).toISOString());
    console.log(`  Query ${queryId}: ${rows.length} rows, ${keptRows.length} after dropping ${utcDay(ended) || 'the partial day'}`);
    if (!keptRows.length) {
      return {
        id: queryId,
        execution_id: executionId,
        execution_ended_at: ended,
        state,
        failed: true,
        reused,
        error: 'no rows after dropping the partial day',
        rows: null,
      };
    }
    return {
      id: queryId,
      execution_id: status.execution_id || executionId,
      execution_ended_at: ended,
      state,
      reused,
      row_count: rows.length,
      rows,
      keptRows,
    };
  }

  const detail = status.error?.message || status.error || state || 'unknown state';
  const replaceable = state === 'QUERY_STATE_FAILED'
    || state === 'QUERY_STATE_CANCELED'
    || state === 'QUERY_STATE_CANCELLED'
    || state === 'QUERY_STATE_EXPIRED';
  if (state === 'QUERY_STATE_COMPLETED_PARTIAL') {
    console.log(`  Query ${queryId} result was truncated; keeping the previous series.`);
  } else {
    console.log(`  Query ${queryId} ${state}: ${detail}`);
  }
  if (allowReplacement && replaceable && deps.now() + deps.minStartMs < deps.jobDeadline) {
    console.log(`  Query ${queryId} execution ${executionId} ended ${state}; starting one replacement.`);
    return startExecution(queryId, deps);
  }
  return {
    id: queryId,
    execution_id: executionId,
    state,
    failed: true,
    reused: false,
    error: String(detail),
    rows: null,
  };
}

async function startExecution(queryId, deps) {
  if (deps.now() + deps.minStartMs >= deps.jobDeadline) {
    console.log(`  Query ${queryId} deferred; under 3 minutes of job budget left. Not executing.`);
    return { id: queryId, deferred: true, state: 'NOT_STARTED', execution_id: null, rows: null };
  }
  console.log(`  Query ${queryId} executing on the ${PERFORMANCE} tier`);
  const executionId = await deps.dune.execute(queryId);
  console.log(`    Execution ${executionId}`);
  remember(deps.bundle, {
    id: queryId,
    network: deps.network,
    execution_id: executionId,
    state: 'QUERY_STATE_PENDING',
    execution_ended_at: null,
  });
  return followExecution(queryId, executionId, deps, { reused: false, allowReplacement: false });
}

/**
 * One query. `deps.dune` is injectable. An open saved execution is polled and
 * never replaced with POST /execute.
 */
export async function resolveQuery(queryId, deps) {
  const saved = deps.bundle.state.queries?.[String(queryId)];
  if (saved?.execution_id && OPEN_STATES.has(saved.state)) {
    console.log(`  Query ${queryId} resuming ${saved.state} execution ${saved.execution_id}; not starting another`);
    return followExecution(queryId, saved.execution_id, deps, { reused: false, allowReplacement: true });
  }

  const latest = await deps.dune.latest(queryId);
  if (latest?.execution_ended_at) latest.execution_ended_at = normalizeIso(latest.execution_ended_at);
  const savedForDecision = saved?.execution_ended_at
    ? { ...saved, execution_ended_at: normalizeIso(saved.execution_ended_at) }
    : saved;
  const decision = decideQueryAction({
    saved: savedForDecision,
    latest,
    now: deps.now(),
    freshnessMs: deps.freshnessMs,
  });
  console.log(`  Query ${queryId} ${decision.reason}${decision.executionId ? ` (${decision.executionId})` : ''}`);

  if (decision.action === 'resume' || decision.action === 'reuse') {
    return followExecution(queryId, decision.executionId, deps, {
      reused: decision.action === 'reuse',
      allowReplacement: decision.action === 'resume',
    });
  }
  return startExecution(queryId, deps);
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

export async function runRefresh(options = {}) {
  const duneClient = options.dune || liveDune;
  const now = options.now || Date.now;
  const jobWaitMs = options.jobWaitMs ?? JOB_WAIT_MS;
  const startedAt = now();
  const bundle = {
    state: options.state || { queries: {} },
    persist: options.persist || null,
  };
  const jobs = [];
  for (const [network, ids] of Object.entries(QUERIES)) {
    for (const id of ids) jobs.push({ network, id });
  }

  console.log(`Fetching ${jobs.length} Dune queries, ${options.concurrency || CONCURRENCY} at a time, tier=${PERFORMANCE}, reuse<${FRESHNESS_HOURS}h, job wait ${Math.round(jobWaitMs / 60000)}m`);

  const fetched = await mapPool(jobs, options.concurrency || CONCURRENCY, async job => {
    console.log(`\n${job.network} query ${job.id}`);
    const deps = {
      dune: duneClient,
      bundle,
      network: job.network,
      now,
      sleep: options.sleep || sleep,
      pollMs: options.pollMs ?? POLL_MS,
      minStartMs: options.minStartMs ?? MIN_START_MS,
      jobDeadline: startedAt + jobWaitMs,
      freshnessMs: options.freshnessMs ?? FRESHNESS_MS,
    };
    try {
      const result = await resolveQuery(job.id, deps);
      return { network: job.network, ...result };
    } catch (error) {
      console.log(`  Query ${job.id} failed before it could be published: ${error.message}`);
      const saved = bundle.state.queries?.[String(job.id)];
      return {
        network: job.network,
        id: job.id,
        execution_id: saved?.execution_id || null,
        state: saved?.state || 'ERROR',
        failed: true,
        error: error.message,
        rows: null,
      };
    }
  });

  const byId = new Map(fetched.map(item => [String(item.id), item]));
  const updates = {};
  let incomplete = false;
  for (const [network, ids] of Object.entries(QUERIES)) {
    const update = networkUpdate(network, ids, byId, (rows, name) => rowsToPipe(rows, name, message => console.warn(message)));
    if (!update) {
      incomplete = true;
      console.log(`Keeping the previous ${network} series; not every query finished.`);
      continue;
    }
    updates[network] = update;
  }

  const payload = mergeRefresh(options.previous || null, updates);
  return { payload, state: bundle.state, incomplete, results: fetched };
}

async function main() {
  if (!process.env.DUNE_API_KEY) {
    console.error('ERROR: DUNE_API_KEY environment variable is not set');
    process.exit(1);
  }
  console.log('DUNE_API_KEY is set');

  const previous = readJson(DATA_PATH);
  const state = readJson(STATE_PATH) || { queries: {} };
  const { payload, state: nextState, incomplete } = await runRefresh({
    previous,
    state,
    persist: next => writeJsonAtomic(STATE_PATH, next),
  });

  writeJsonAtomic(DATA_PATH, payload);
  writeJsonAtomic(STATE_PATH, nextState);
  console.log(`\nWrote data.json (${JSON.stringify(payload).length} bytes), oldest published execution ${payload.timestamp}`);
  console.log(`Coverage: ${payload.coverage.tokens} tracked tokens on ${payload.coverage.chains} chains. ${payload.coverage.note}`);

  try {
    const { generateOg } = await import('./generate-og.js');
    await generateOg(DATA_PATH, 'og.png');
    console.log('Wrote og.png');
  } catch (error) {
    console.log(`og.png was not regenerated: ${error.message}`);
  }

  if (incomplete) {
    console.error('Refresh incomplete. Finished networks were saved. Re-run to resume open executions without paying for them again.');
    process.exit(2);
  }
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

  const workflow = readFileSync('.github/workflows/refresh-data.yml', 'utf8');
  assert(workflow.includes('secrets.DUNE_API_KEY'), 'workflow must keep the DUNE_API_KEY secret name');
  assert(!workflow.includes('secrets.REDIS_URL'), 'workflow must not read the REDIS_URL secret');
  assert(workflow.includes('fetch-dune-data.js'), 'workflow must run the fetch script');
  assert(workflow.includes('refresh-state.json'), 'workflow must commit the execution ledger');
  assert(workflow.includes('continue-on-error: true'), 'a partial refresh must still be able to commit');
  assert(!workflow.includes('/api/crons'), 'workflow must not call the removed cron route');

  const index = readFileSync('index.html', 'utf8');
  assert(index.includes('not exhaustive'), 'coverage caveat missing');
  assert(index.includes('Tracked volume'), 'tracked-volume wording missing');

  const source = readFileSync('fetch-dune-data.js', 'utf8');
  assert(source.includes('/execute'), 'fetch script must be able to trigger execution');
  assert(source.includes('decideQueryAction'), 'fetch script must consult the resume plan');
  assert(!/DUNE_API_KEY\.substring/.test(source), 'do not log any part of the API key');
  assert(source.includes('Leaving it running'), 'a budget stop must keep the Dune execution instead of aborting it');

  const ledger = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  assert(ledger.queries && typeof ledger.queries === 'object', 'refresh ledger must list queries');
  for (const saved of Object.values(ledger.queries)) {
    if (OPEN_STATES.has(saved.state)) {
      assert(saved.execution_id, 'an open query needs an execution id so a retry does not pay again');
    }
  }

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
