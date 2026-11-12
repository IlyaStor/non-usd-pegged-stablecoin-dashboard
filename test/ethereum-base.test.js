import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { QUERIES, FX_FALLBACK } from '../lib/series.js';
import { ETHEREUM_BASE_REFRESH, ethereumBaseJob, rowsForChain } from '../lib/ethereum-base-query.js';
import { networkUpdate } from '../lib/refresh-plan.js';
import { rowsToPipe } from '../lib/series.js';

const registry = JSON.parse(readFileSync('registry/verified-additions.json', 'utf8'));
const sql = readFileSync('sql/candidates/ethereum_base_tokens_transfers_365.sql', 'utf8');
const fetchSource = readFileSync('fetch-dune-data.js', 'utf8');
const workflow = readFileSync('.github/workflows/refresh-data.yml', 'utf8');

function code(text) {
  return text.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
}

describe('ethereum and base create target', () => {
  it('lists only the verified ethereum and base contracts, including symbols absent on Nov 6', () => {
    const body = code(sql);
    const rows = [...body.matchAll(/\('([a-z]+)',\s*(0x[0-9a-fA-F]{40}),\s*'([^']+)',\s*(\d+),\s*([0-9.]+)\)/g)]
      .map(match => ({
        chain: match[1],
        address: match[2].toLowerCase(),
        label: match[3],
        decimals: Number(match[4]),
        fx: Number(match[5]),
      }));
    const expected = registry.entries
      .filter(entry => entry.chain_slug === 'ethereum' || entry.chain_slug === 'base')
      .map(entry => ({
        chain: entry.chain_slug,
        address: entry.address.toLowerCase(),
        decimals: entry.decimals,
        symbol: entry.onchain_symbol || entry.token,
      }));
    assert.equal(expected.length, 10);
    assert.equal(rows.length, 10);
    assert.equal(rows.some(row => row.chain === 'ethereum' && row.label.endsWith('IDRX')), false);
    for (const entry of expected) {
      const hit = rows.find(row => row.chain === entry.chain && row.address === entry.address);
      assert.ok(hit, `${entry.chain} ${entry.symbol}`);
      assert.equal(hit.decimals, entry.decimals);
      assert.equal(hit.label.endsWith(entry.symbol), true);
      const fallback = FX_FALLBACK[entry.symbol];
      assert.equal(hit.fx, fallback);
    }
    assert.equal(rows.some(row => row.chain === 'ethereum' && row.label.endsWith('SEKAU')), true);
    assert.equal(rows.some(row => row.chain === 'base' && row.label.endsWith('CHFAU')), true);
    assert.equal(rows.some(row => row.chain === 'arbitrum' || row.chain === 'optimism'), false);
    assert.equal(body.includes("tr.blockchain IN ('ethereum', 'base')"), true);
    assert.equal(body.includes('SUM(tr.amount) AS transfer_volume'), true);
    assert.equal(body.includes('transfer_volume_usd'), true);
    assert.equal(body.includes("'fx_fallback'"), true);
    assert.equal(body.includes("'tokens_evm.amount_usd'"), true);
    assert.equal(/INSERT\s+INTO/i.test(body), false);
    assert.equal(body.includes('0 AS transfer_volume'), false);
  });

  it('fetches query 9117254 once and does not add a second schedule', () => {
    assert.equal(ETHEREUM_BASE_REFRESH.enabled, true);
    assert.equal(ETHEREUM_BASE_REFRESH.queryId, 9117254);
    assert.equal(ethereumBaseJob().id, 9117254);
    assert.deepEqual(ethereumBaseJob().splitChains, ['ethereum', 'base']);
    assert.equal(ethereumBaseJob({ enabled: true, queryId: null, chains: ['ethereum', 'base'] }), null);
    assert.deepEqual(
      ethereumBaseJob({ enabled: true, queryId: 123, chains: ['ethereum', 'base'] }).splitChains,
      ['ethereum', 'base'],
    );
    assert.deepEqual(QUERIES, {
      polygon: [6614895, 6621899],
      stellar: [6712377],
      solana: [6689171],
      tron: [6695880],
      plasma: [6663259],
      bsc: [8748306],
      arc: [8924650],
    });
    assert.equal(fetchSource.includes('ethereumBaseJob()'), true);
    assert.equal(workflow.includes('push:'), false);
    assert.equal(workflow.includes('ethereum_base'), false);
  });

  it('splits one result into two series and drops a chain with no rows', () => {
    const rows = [
      { blockchain: 'ethereum', date: '2026-11-06', token: 'Euro - EURQ', daily_transactions: 20, transfer_volume_usd: 100 },
      { blockchain: 'base', date: '2026-11-06', token: 'Euro - EURAU', daily_transactions: 3, transfer_volume_usd: 15 },
    ];
    assert.equal(rowsForChain(rows, 'ethereum').length, 1);
    assert.equal(rowsForChain(rows, 'arbitrum').length, 0);
    const kept = rowsForChain(rows, 'base');
    const update = networkUpdate(
      'base',
      [123],
      new Map([['123', { id: 123, rows: kept, keptRows: kept, execution_ended_at: '2026-11-07T00:00:00Z' }]]),
      rowsToPipe,
    );
    assert.equal(update.pipe.includes('EURAU'), true);
    assert.equal(update.pipe.includes('EURQ'), false);
  });
});
