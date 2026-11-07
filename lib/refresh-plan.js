/**
 * Pure decisions for a Dune refresh.
 * Status polls are free. POST /execute is not. These helpers keep a retry
 * attached to an execution that is already queued or running.
 */

import { COVERAGE_NOTE, coverageFromNetworks, earliestIso } from './series.js';

export const OPEN_STATES = new Set([
  'QUERY_STATE_PENDING',
  'QUERY_STATE_EXECUTING',
]);

export const TERMINAL_STATES = new Set([
  'QUERY_STATE_COMPLETED',
  'QUERY_STATE_FAILED',
  'QUERY_STATE_CANCELED',
  'QUERY_STATE_CANCELLED',
  'QUERY_STATE_EXPIRED',
  'QUERY_STATE_COMPLETED_PARTIAL',
]);

export function isFresh(iso, now, freshnessMs) {
  const t = Date.parse(iso);
  if (!t || Number.isNaN(t)) return false;
  return now - t < freshnessMs;
}

/**
 * Prefer an execution we already paid for over a new POST.
 * Latest results can still describe the previous completed run while a newer
 * execution is queued, so an open id in the local ledger wins.
 */
export function decideQueryAction({ saved, latest, now, freshnessMs }) {
  if (saved?.execution_id && OPEN_STATES.has(saved.state)) {
    return { action: 'resume', executionId: saved.execution_id, reason: 'saved-open' };
  }
  if (latest?.execution_id && OPEN_STATES.has(latest.state)) {
    return { action: 'resume', executionId: latest.execution_id, reason: 'latest-open' };
  }
  if (
    saved?.execution_id
    && saved.state === 'QUERY_STATE_COMPLETED'
    && isFresh(saved.execution_ended_at, now, freshnessMs)
  ) {
    return { action: 'reuse', executionId: saved.execution_id, reason: 'saved-fresh' };
  }
  if (
    latest?.execution_id
    && latest.state === 'QUERY_STATE_COMPLETED'
    && isFresh(latest.execution_ended_at, now, freshnessMs)
  ) {
    return { action: 'reuse', executionId: latest.execution_id, reason: 'latest-fresh' };
  }
  return { action: 'execute', executionId: null, reason: 'stale-or-missing' };
}

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/** 429/503 are read pressure, not a finished or failed execution. */
export function rateLimitDelayMs(error, attempt) {
  if (error?.status !== 429 && error?.status !== 503) return null;
  const header = Number(error.retryAfterMs);
  if (Number.isFinite(header) && header > 0) return Math.min(header, 60_000);
  return Math.min(60_000, 5_000 * 2 ** Math.min(attempt, 4));
}

/**
 * Poll until the execution finishes or the deadline passes.
 * `now` and `sleep` are injectable so tests do not wait on a real clock.
 * HTTP 429/503 keeps the same execution id and waits inside the deadline.
 * Other status errors stop after three in a row and do not start a replacement.
 */
export async function pollUntil({ getStatus, sleep, now, deadlineMs, intervalMs, onRetry }) {
  let last = null;
  let failures = 0;
  let limited = 0;
  for (;;) {
    try {
      last = await getStatus();
      failures = 0;
      limited = 0;
      if (last && (last.is_execution_finished || isTerminalState(last.state))) {
        return { done: true, status: last };
      }
    } catch (error) {
      const delay = rateLimitDelayMs(error, limited);
      if (delay != null) {
        limited += 1;
        last = {
          ...(last || {}),
          state: last?.state || 'QUERY_STATE_EXECUTING',
          error: error.message,
          status: error.status,
        };
        if (onRetry) onRetry(error, delay);
        const remaining = deadlineMs - now();
        if (remaining <= 0) return { done: false, status: last, error: error.message };
        await sleep(Math.min(delay, remaining));
        continue;
      }
      failures += 1;
      last = {
        ...(last || {}),
        state: last?.state || 'QUERY_STATE_EXECUTING',
        error: error.message,
      };
      if (failures >= 3) return { done: false, status: last, error: error.message };
    }
    const remaining = deadlineMs - now();
    if (remaining <= 0) return { done: false, status: last };
    await sleep(Math.min(intervalMs, remaining));
  }
}

/** Publish a network only when every one of its queries finished with rows. */
export function networkUpdate(network, queryIds, results, rowsToPipe) {
  const parts = queryIds.map(id => results.get(String(id)));
  if (parts.some(part => !part || part.inProgress || part.deferred || part.failed || !part.rows)) {
    return null;
  }
  const rows = parts.flatMap(part => part.keptRows);
  const pipe = rowsToPipe(rows, network);
  if (!pipe.trim()) return null;
  return {
    pipe,
    execution: {
      execution_ended_at: earliestIso(parts.map(part => part.execution_ended_at)),
      queries: parts.map(part => ({
        id: part.id,
        execution_id: part.execution_id,
        execution_ended_at: part.execution_ended_at,
        reused: part.reused,
        row_count: part.row_count,
      })),
    },
  };
}

/**
 * Keep series for networks that did not finish. Totals stay labeled as tracked
 * coverage, which is not exhaustive.
 */
export function mergeRefresh(previous, updates) {
  const data = { ...(previous?.data || {}) };
  const executions = { ...(previous?.executions || {}) };
  for (const [network, update] of Object.entries(updates)) {
    if (!update?.pipe) continue;
    data[network] = update.pipe;
    executions[network] = update.execution;
  }
  const coverage = coverageFromNetworks(data);
  return {
    success: true,
    timestamp: earliestIso(Object.values(executions).map(item => item?.execution_ended_at)),
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

export function mergeState(previous, patches) {
  const queries = { ...(previous?.queries || {}) };
  for (const patch of patches) {
    if (!patch?.id) continue;
    const key = String(patch.id);
    queries[key] = {
      ...(queries[key] || {}),
      network: patch.network || queries[key]?.network || null,
      execution_id: patch.execution_id ?? queries[key]?.execution_id ?? null,
      state: patch.state || queries[key]?.state || null,
      execution_ended_at: patch.execution_ended_at ?? queries[key]?.execution_ended_at ?? null,
    };
  }
  return { queries };
}
