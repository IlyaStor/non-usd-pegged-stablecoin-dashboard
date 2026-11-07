import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COVERAGE_NOTE } from '../lib/series.js';
import {
  decideQueryAction,
  mergeRefresh,
  mergeState,
  networkUpdate,
  pollUntil,
} from '../lib/refresh-plan.js';
import { runRefresh } from '../fetch-dune-data.js';

const FRESHNESS_MS = 20 * 60 * 60 * 1000;
const SOLANA_EXECUTION = '01M6TC8RB4WQP0E4Z4TT1DPB4F';
const TRON_EXECUTION = '01M6TCKPD1RM96AK5PM47RF1XD';

function clock(start = Date.parse('2026-11-07T06:42:22Z')) {
  let t = start;
  return {
    now: () => t,
    sleep: async ms => { t += ms; },
  };
}

function dayRows() {
  return {
    rows: [
      { date: '2026-11-07', token: 'AUD', daily_transactions: '9', transfer_volume_usd: '99' },
      { date: '2026-11-06', token: 'AUD', daily_transactions: '2', transfer_volume_usd: '10' },
    ],
  };
}

describe('decideQueryAction', () => {
  it('resumes a saved open execution even when latest results are an older completed run', () => {
    const decision = decideQueryAction({
      saved: { execution_id: SOLANA_EXECUTION, state: 'QUERY_STATE_EXECUTING' },
      latest: {
        execution_id: 'previous-solana',
        state: 'QUERY_STATE_COMPLETED',
        execution_ended_at: '2026-11-02T13:39:01Z',
      },
      now: Date.parse('2026-11-07T07:30:00Z'),
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(decision.action, 'resume');
    assert.equal(decision.executionId, SOLANA_EXECUTION);
    assert.equal(decision.reason, 'saved-open');
  });

  it('resumes a saved pending execution instead of posting another', () => {
    const decision = decideQueryAction({
      saved: { execution_id: TRON_EXECUTION, state: 'QUERY_STATE_PENDING' },
      latest: {
        execution_id: 'previous-tron',
        state: 'QUERY_STATE_COMPLETED',
        execution_ended_at: '2026-11-02T13:27:15Z',
      },
      now: Date.parse('2026-11-07T07:30:00Z'),
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(decision.action, 'resume');
    assert.equal(decision.executionId, TRON_EXECUTION);
  });

  it('reuses a fresh completed result and does not ask for a new execution', () => {
    const decision = decideQueryAction({
      saved: null,
      latest: {
        execution_id: '01M6TBWX60W298W3XBBXNWYHPB',
        state: 'QUERY_STATE_COMPLETED',
        execution_ended_at: '2026-11-07T06:47:07Z',
      },
      now: Date.parse('2026-11-07T08:00:00Z'),
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(decision.action, 'reuse');
    assert.equal(decision.reason, 'latest-fresh');
  });

  it('executes when the only completed result is older than the freshness window', () => {
    const decision = decideQueryAction({
      saved: null,
      latest: {
        execution_id: 'old',
        state: 'QUERY_STATE_COMPLETED',
        execution_ended_at: '2026-11-02T13:39:01Z',
      },
      now: Date.parse('2026-11-07T06:42:22Z'),
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(decision.action, 'execute');
  });

  it('resumes an execution the results endpoint says is still running', () => {
    const decision = decideQueryAction({
      saved: null,
      latest: { execution_id: 'live', state: 'QUERY_STATE_PENDING' },
      now: Date.parse('2026-11-07T07:00:00Z'),
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(decision.action, 'resume');
    assert.equal(decision.executionId, 'live');
  });
});

describe('pollUntil', () => {
  it('stops at the deadline while the execution is still running', async () => {
    const time = clock(0);
    let calls = 0;
    const result = await pollUntil({
      getStatus: async () => {
        calls += 1;
        return { state: 'QUERY_STATE_EXECUTING', is_execution_finished: false };
      },
      sleep: time.sleep,
      now: time.now,
      deadlineMs: 10_000,
      intervalMs: 4_000,
    });
    assert.equal(result.done, false);
    assert.equal(result.status.state, 'QUERY_STATE_EXECUTING');
    assert.ok(calls >= 2 && calls <= 4);
  });

  it('returns as soon as the execution completes', async () => {
    let calls = 0;
    const result = await pollUntil({
      getStatus: async () => {
        calls += 1;
        return { state: 'QUERY_STATE_COMPLETED', is_execution_finished: true };
      },
      sleep: async () => { throw new Error('should not wait'); },
      now: () => 0,
      deadlineMs: 36 * 60 * 1000,
      intervalMs: 4_000,
    });
    assert.equal(result.done, true);
    assert.equal(calls, 1);
  });

  it('gives up after repeated status errors without treating that as a new execution', async () => {
    let calls = 0;
    const result = await pollUntil({
      getStatus: async () => {
        calls += 1;
        throw new Error('temporary');
      },
      sleep: async () => {},
      now: () => 0,
      deadlineMs: 36 * 60 * 1000,
      intervalMs: 4_000,
    });
    assert.equal(result.done, false);
    assert.equal(calls, 3);
    assert.match(result.error, /temporary/);
  });

  it('keeps polling the same execution through HTTP 429 instead of stopping after three errors', async () => {
    // Run 42350611583 aborted Plasma and BSC after about 45s while the 36 minute
    // budget remained. Status errors were not printed. Three 429s must not do that.
    let calls = 0;
    const time = clock(0);
    const result = await pollUntil({
      getStatus: async () => {
        calls += 1;
        if (calls <= 2) return { state: 'QUERY_STATE_EXECUTING', is_execution_finished: false, execution_id: '01M6TDWCFK4SQE352XNE6VBXVS' };
        if (calls <= 5) {
          const error = new Error('Too many requests. Please upgrade your plan');
          error.status = 429;
          throw error;
        }
        return {
          state: 'QUERY_STATE_COMPLETED',
          is_execution_finished: true,
          execution_id: '01M6TDWCFK4SQE352XNE6VBXVS',
          execution_ended_at: '2026-11-07T07:20:00Z',
        };
      },
      sleep: time.sleep,
      now: time.now,
      deadlineMs: 36 * 60 * 1000,
      intervalMs: 4_000,
    });
    assert.equal(result.done, true);
    assert.equal(result.status.state, 'QUERY_STATE_COMPLETED');
    assert.equal(result.status.execution_id, '01M6TDWCFK4SQE352XNE6VBXVS');
    assert.ok(calls >= 6);
    assert.ok(time.now() < 36 * 60 * 1000);
  });
});

describe('partial publish', () => {
  it('keeps the previous series for an unfinished network and the tracked-only coverage note', () => {
    const merged = mergeRefresh(
      {
        data: { solana: '2026-11-02|EURC|1|5.00', tron: '2026-11-02|A7A5|1|5.00' },
        executions: { tron: { execution_ended_at: '2026-11-02T00:00:00Z', queries: [] } },
      },
      {
        polygon: {
          pipe: '2026-11-06|AUD|2|10.00',
          execution: { execution_ended_at: '2026-11-07T06:47:07Z', queries: [] },
        },
      },
    );
    assert.equal(merged.data.solana, '2026-11-02|EURC|1|5.00');
    assert.equal(merged.data.polygon, '2026-11-06|AUD|2|10.00');
    assert.equal(merged.coverage.exhaustive, false);
    assert.equal(merged.coverage.note, COVERAGE_NOTE);
    assert.equal(merged.executions.tron.execution_ended_at, '2026-11-02T00:00:00Z');
  });

  it('does not publish a network when one of its queries is still open', () => {
    const results = new Map([
      ['6614895', { id: 6614895, rows: [{}], keptRows: [{}], execution_id: 'a', execution_ended_at: '2026-11-07T06:47:07Z', reused: false, row_count: 1 }],
      ['6621899', { id: 6621899, inProgress: true, execution_id: 'b', state: 'QUERY_STATE_EXECUTING' }],
    ]);
    const update = networkUpdate('polygon', [6614895, 6621899], results, () => {
      throw new Error('should not format a partial network');
    });
    assert.equal(update, null);
  });

  it('keeps an execution id when a later patch has no new id', () => {
    const state = mergeState(
      { queries: { '6689171': { execution_id: SOLANA_EXECUTION, state: 'QUERY_STATE_EXECUTING', network: 'solana' } } },
      [{ id: 6689171, state: 'QUERY_STATE_EXECUTING' }],
    );
    assert.equal(state.queries['6689171'].execution_id, SOLANA_EXECUTION);
  });
});

describe('runRefresh', () => {
  it('does not start a second execution for a query that is still running, and still saves finished networks', async () => {
    const posts = [];
    const latestCalls = [];
    const executions = new Map();
    let seq = 0;
    const dune = {
      async latest(id) {
        latestCalls.push(id);
        return {
          execution_id: `old-${id}`,
          state: 'QUERY_STATE_COMPLETED',
          execution_ended_at: '2026-11-02T00:00:00Z',
        };
      },
      async execute(id) {
        posts.push(id);
        const execution_id = `new-${++seq}`;
        executions.set(execution_id, id);
        return execution_id;
      },
      async status(executionId) {
        const queryId = executions.get(executionId);
        if (queryId === 6689171) {
          return { execution_id: executionId, state: 'QUERY_STATE_EXECUTING', is_execution_finished: false };
        }
        return {
          execution_id: executionId,
          state: 'QUERY_STATE_COMPLETED',
          is_execution_finished: true,
          execution_ended_at: '2026-11-07T06:50:00Z',
          execution_cost_credits: 1,
        };
      },
      async rows() {
        return dayRows();
      },
    };
    const time = clock();
    const previous = {
      success: true,
      data: {
        polygon: 'old-polygon',
        stellar: 'old-stellar',
        solana: '2026-11-02|EURC|1|5.00',
        tron: 'old-tron',
        plasma: 'old-plasma',
        bsc: 'old-bsc',
        arc: 'old-arc',
      },
      executions: {},
    };
    const first = await runRefresh({
      dune,
      now: time.now,
      sleep: time.sleep,
      previous,
      state: { queries: {} },
      jobWaitMs: 12_000,
      pollMs: 4_000,
      minStartMs: 1_000,
      concurrency: 1,
      freshnessMs: FRESHNESS_MS,
    });

    assert.deepEqual(posts, [6614895, 6621899, 6712377, 6689171]);
    assert.equal(first.incomplete, true);
    assert.equal(first.payload.data.polygon.includes('2026-11-06|AUD|'), true);
    assert.equal(first.payload.data.polygon.includes('2026-11-07'), false);
    assert.equal(first.payload.data.solana, '2026-11-02|EURC|1|5.00');
    assert.equal(first.payload.data.tron, 'old-tron');
    assert.equal(first.payload.coverage.exhaustive, false);
    assert.match(first.payload.coverage.note, /not exhaustive/);
    assert.equal(first.state.queries['6689171'].execution_id, 'new-4');
    assert.equal(first.state.queries['6689171'].state, 'QUERY_STATE_EXECUTING');

    const postsBeforeRetry = posts.length;
    const latestForSolana = () => latestCalls.filter(id => id === 6689171).length;
    const latestBeforeRetry = latestForSolana();
    const second = await runRefresh({
      dune,
      now: time.now,
      sleep: time.sleep,
      previous: first.payload,
      state: first.state,
      jobWaitMs: 8_000,
      pollMs: 4_000,
      minStartMs: 1_000,
      concurrency: 1,
      freshnessMs: FRESHNESS_MS,
    });

    assert.equal(posts.length, postsBeforeRetry, 'retry must not POST /execute for the open Solana execution or for fresh completed queries');
    assert.equal(latestForSolana(), latestBeforeRetry, 'an open saved execution is resumed without reading latest results');
    assert.equal(second.state.queries['6689171'].execution_id, 'new-4');
    assert.equal(second.payload.data.solana, '2026-11-02|EURC|1|5.00');
    assert.equal(second.payload.coverage.note, COVERAGE_NOTE);
  });

  it('replaces an open execution id Dune no longer has, and only once', async () => {
    const posts = [];
    const time = clock();
    const missing = new Error('gone');
    missing.status = 404;
    const result = await runRefresh({
      dune: {
        async latest() {
          return {
            execution_id: 'fresh',
            state: 'QUERY_STATE_COMPLETED',
            execution_ended_at: '2026-11-07T06:50:00Z',
          };
        },
        async execute(id) {
          posts.push(id);
          return 'replacement';
        },
        async status(executionId) {
          if (executionId === SOLANA_EXECUTION) throw missing;
          return {
            execution_id: executionId,
            state: 'QUERY_STATE_COMPLETED',
            is_execution_finished: true,
            execution_ended_at: '2026-11-07T06:50:00Z',
          };
        },
        async rows() {
          return dayRows();
        },
      },
      now: time.now,
      sleep: time.sleep,
      previous: { data: { solana: 'old-solana' } },
      state: {
        queries: {
          '6689171': {
            network: 'solana',
            execution_id: SOLANA_EXECUTION,
            state: 'QUERY_STATE_EXECUTING',
            execution_ended_at: null,
          },
        },
      },
      jobWaitMs: 10 * 60 * 1000,
      pollMs: 4_000,
      minStartMs: 1_000,
      concurrency: 1,
      freshnessMs: FRESHNESS_MS,
    });
    assert.deepEqual(posts, [6689171]);
    assert.equal(result.state.queries['6689171'].execution_id, 'replacement');
    assert.equal(result.payload.data.solana.includes('2026-11-06|AUD|'), true);
    assert.equal(result.payload.coverage.exhaustive, false);
  });

  it('does not call execute when the job budget cannot watch a new query', async () => {
    let executes = 0;
    const time = clock();
    const result = await runRefresh({
      dune: {
        async latest() {
          return { state: 'QUERY_STATE_COMPLETED', execution_ended_at: '2026-11-01T00:00:00Z', execution_id: 'old' };
        },
        async execute() {
          executes += 1;
          return 'should-not-run';
        },
        async status() {
          throw new Error('no execution');
        },
        async rows() {
          return { rows: [] };
        },
      },
      now: time.now,
      sleep: time.sleep,
      previous: { data: { solana: 'keep-me' } },
      state: { queries: {} },
      jobWaitMs: 0,
      minStartMs: 1_000,
      concurrency: 2,
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(executes, 0);
    assert.equal(result.incomplete, true);
    assert.equal(result.payload.data.solana, 'keep-me');
    assert.equal(result.payload.coverage.exhaustive, false);
  });

  it('does not start a second Plasma execution when status returns 429 and later completes', async () => {
    const posts = [];
    const time = clock(Date.parse('2026-11-07T07:17:00Z'));
    let polls = 0;
    const result = await runRefresh({
      dune: {
        async latest() {
          return {
            execution_id: 'fresh',
            state: 'QUERY_STATE_COMPLETED',
            execution_ended_at: '2026-11-07T07:01:47Z',
          };
        },
        async execute(id) {
          posts.push(id);
          throw new Error(`execute ${id} must not be called`);
        },
        async status(executionId) {
          if (executionId !== '01M6TDWCFK4SQE352XNE6VBXVS') {
            return {
              execution_id: executionId,
              state: 'QUERY_STATE_COMPLETED',
              is_execution_finished: true,
              execution_ended_at: '2026-11-07T07:01:47Z',
            };
          }
          polls += 1;
          if (polls <= 2) {
            return { execution_id: executionId, state: 'QUERY_STATE_EXECUTING', is_execution_finished: false };
          }
          if (polls <= 5) {
            const error = new Error('Too many requests');
            error.status = 429;
            throw error;
          }
          return {
            execution_id: executionId,
            state: 'QUERY_STATE_COMPLETED',
            is_execution_finished: true,
            execution_ended_at: '2026-11-07T07:20:00Z',
            execution_cost_credits: 12,
          };
        },
        async rows() {
          return {
            rows: [
              { date: '2026-11-07', token: 'TRYB', daily_transactions: '1', transfer_volume_usd: '9' },
              { date: '2026-11-06', token: 'TRYB', daily_transactions: '4', transfer_volume_usd: '40' },
            ],
          };
        },
      },
      now: time.now,
      sleep: time.sleep,
      previous: { data: { plasma: '2026-10-30|TRYB|1|1925.02' } },
      state: {
        queries: {
          '6663259': {
            network: 'plasma',
            execution_id: '01M6TDWCFK4SQE352XNE6VBXVS',
            state: 'QUERY_STATE_EXECUTING',
            execution_ended_at: null,
          },
        },
      },
      jobWaitMs: 36 * 60 * 1000,
      pollMs: 4_000,
      minStartMs: 1_000,
      concurrency: 1,
      freshnessMs: FRESHNESS_MS,
    });
    assert.deepEqual(posts, []);
    assert.equal(result.incomplete, false);
    assert.equal(result.state.queries['6663259'].execution_id, '01M6TDWCFK4SQE352XNE6VBXVS');
    assert.equal(result.state.queries['6663259'].state, 'QUERY_STATE_COMPLETED');
    assert.equal(result.payload.data.plasma.includes('2026-11-06|TRYB|'), true);
    assert.equal(result.payload.data.plasma.includes('2026-11-07'), false);
    assert.equal(result.payload.coverage.exhaustive, false);
    assert.match(result.payload.coverage.note, /not exhaustive/);
  });

  it('retries a 429 on latest results and executes Arc only after the read succeeds', async () => {
    const posts = [];
    let latestCalls = 0;
    const time = clock(Date.parse('2026-11-07T07:17:40Z'));
    const result = await runRefresh({
      dune: {
        async latest(id) {
          if (id !== 8924650) {
            return {
              execution_id: `fresh-${id}`,
              state: 'QUERY_STATE_COMPLETED',
              execution_ended_at: '2026-11-07T07:01:47Z',
            };
          }
          latestCalls += 1;
          if (latestCalls <= 2) {
            const error = new Error('Too many requests. Please upgrade your plan https://dune.com/pricing');
            error.status = 429;
            throw error;
          }
          return {
            execution_id: 'old-arc',
            state: 'QUERY_STATE_COMPLETED',
            execution_ended_at: '2026-11-01T00:00:00Z',
          };
        },
        async execute(id) {
          posts.push(id);
          return 'arc-new';
        },
        async status(executionId) {
          return {
            execution_id: executionId,
            state: 'QUERY_STATE_COMPLETED',
            is_execution_finished: true,
            execution_ended_at: '2026-11-07T07:25:00Z',
          };
        },
        async rows() {
          return dayRows();
        },
      },
      now: time.now,
      sleep: time.sleep,
      previous: { data: { arc: '2026-11-01|GBPA|6|50.59' } },
      state: { queries: {} },
      jobWaitMs: 36 * 60 * 1000,
      pollMs: 4_000,
      minStartMs: 1_000,
      concurrency: 1,
      freshnessMs: FRESHNESS_MS,
    });
    assert.equal(latestCalls, 3);
    assert.deepEqual(posts, [8924650]);
    assert.equal(result.state.queries['8924650'].execution_id, 'arc-new');
    assert.equal(result.incomplete, false);
  });
});
