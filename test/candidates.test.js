import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { QUERIES } from '../lib/series.js';
import {
  CANDIDATES,
  UNCONFIRMED_DATASETS,
  VALIDATION_OF_EXISTING,
  enabledCandidateIds,
  groupCandidateRows,
  refreshQueryIds,
} from '../lib/query-manifest.js';
import { NEW_CHAIN_SLUGS, UNCONFIRMED_DATASET_SLUGS } from '../lib/token-catalog.js';

const registry = JSON.parse(readFileSync('registry/verified-additions.json', 'utf8'));
const workflow = readFileSync('.github/workflows/refresh-data.yml', 'utf8');
const fetchSource = readFileSync('fetch-dune-data.js', 'utf8');

function code(sql) {
  return sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
}

function read(path) {
  return readFileSync(path, 'utf8');
}

const registryByChain = new Map();
for (const entry of registry.entries) {
  if (!registryByChain.has(entry.chain_slug)) registryByChain.set(entry.chain_slug, []);
  registryByChain.get(entry.chain_slug).push(entry);
}

describe('candidate queries stay out of the refresh', () => {
  it('keeps every candidate disabled and off the eight live query ids', () => {
    assert.deepEqual(refreshQueryIds(), Object.values(QUERIES).flat());
    assert.deepEqual(enabledCandidateIds(), []);
    for (const candidate of CANDIDATES) {
      assert.equal(candidate.enabled, false);
      assert.deepEqual(candidate.queryIds, []);
      assert.equal(candidate.attachToRefresh, false);
    }
    assert.equal(fetchSource.includes('query-manifest'), false);
    assert.equal(fetchSource.includes('tokens_evm'), false);
    assert.equal(workflow.includes("cron: '0 0 */2 * *'"), true);
    assert.equal(workflow.includes('tokens_evm'), false);
    assert.equal(workflow.includes('sql/candidates'), false);
  });

  it('does not put Plasma contracts on the new EVM candidate', () => {
    const evm = code(read('sql/candidates/evm_tokens_transfers_365.sql'));
    assert.equal(/plasma/i.test(evm), false);
    assert.equal(evm.includes('0x3ee196e78d4d4248b849b8e1c7f44c5457fafd2c'), false);
    assert.equal(enabledCandidateIds().length, 0);
  });
});

describe('candidate SQL matches the verified registry only', () => {
  it('lists each supplied EVM contract once, with the registry decimals, and does not rescale amount', () => {
    const sql = read('sql/candidates/evm_tokens_transfers_365.sql');
    const body = code(sql);
    const rows = [];
    const re = /\('([a-z]+)',\s*(0x[0-9a-fA-F]{40}),\s*'([^']+)',\s*(\d+),\s*([0-9.]+)\)/g;
    let match;
    while ((match = re.exec(body))) {
      rows.push({
        chain: match[1],
        address: match[2].toLowerCase(),
        decimals: Number(match[4]),
      });
    }
    const expected = ['ethereum', 'base', 'arbitrum', 'optimism'].flatMap(chain => (
      registryByChain.get(chain).map(entry => ({
        chain,
        address: entry.address.toLowerCase(),
        decimals: entry.decimals,
      }))
    ));
    assert.equal(expected.length, 12);
    assert.equal(rows.length, expected.length);
    for (const entry of expected) {
      const hits = rows.filter(row => row.chain === entry.chain && row.address === entry.address);
      assert.equal(hits.length, 1, `${entry.chain} ${entry.address}`);
      assert.equal(hits[0].decimals, entry.decimals);
    }
    assert.equal(body.includes('SUM(tr.amount)'), true);
    assert.equal(/tr\.amount\s*\//.test(body), false);
    assert.equal(body.includes("token_standard = 'erc20'"), true);
    assert.equal(body.includes('block_month'), true);
    const oneDay = read('sql/validation/evm_tokens_transfers_one_day.sql');
    assert.equal(oneDay.includes("DATE '2026-11-06'"), true);
    assert.equal(oneDay.includes("INTERVAL '365' DAY"), false);
    assert.equal(code(oneDay).includes('SUM(tr.amount)'), true);
  });

  it('keeps Tempo to the three registry contracts and one Transfer topic', () => {
    const sql = code(read('sql/candidates/tempo_logs_365.sql'));
    const rows = [...sql.matchAll(/\(\s*(0x[0-9a-fA-F]{40})\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,/g)];
    const listed = rows.map(match => match[1].toLowerCase()).sort();
    const contracts = registryByChain.get('tempo').map(entry => entry.address.toLowerCase()).sort();
    assert.deepEqual(listed, contracts);
    assert.equal(sql.includes('tempo.logs'), true);
    assert.equal(sql.includes('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'), true);
    assert.equal((sql.match(/topic0\s*=/g) || []).length, 1);
    assert.equal(read('sql/validation/tempo_logs_one_day.sql').includes("DATE '2026-11-06'"), true);
  });

  it('filters XRPL by the two registry issuers and does not scale n/a decimals', () => {
    const sql = code(read('sql/candidates/xrpl_transfers_365.sql'));
    assert.equal(sql.includes('xrpl.transfers'), true);
    assert.equal(sql.includes('tokens_xrpl'), false);
    assert.equal(sql.includes('delivered_amount_value'), true);
    assert.equal(sql.includes('POWER(10'), false);
    for (const entry of registryByChain.get('xrpl')) {
      assert.equal(entry.decimals, 'n/a');
      assert.equal(sql.includes(entry.issuer), true);
    }
    assert.equal(sql.includes('rDk1xiArDMjDqnrR2yWypwQAKg4mKnQYvs'), true);
    assert.equal(sql.includes('GBVXEEYTHW4PUHVOOSEUPS4TTKVRU7XDZJIKAIZRG2H2XU7YWDEFKNTP'), false);
    const oneDay = read('sql/validation/xrpl_transfers_one_day.sql');
    assert.equal(oneDay.includes("DATE '2026-11-06'"), true);
    assert.equal(code(oneDay).includes("INTERVAL '365' DAY"), false);
  });

  it('writes no SQL for unconfirmed datasets and keeps their decimals', () => {
    assert.deepEqual(UNCONFIRMED_DATASETS.map(item => item.chain), ['algorand', 'xahau', 'adi']);
    for (const chain of UNCONFIRMED_DATASET_SLUGS) {
      assert.equal(NEW_CHAIN_SLUGS.has(chain), false);
      for (const entry of registryByChain.get(chain)) {
        if (chain === 'xahau' || chain === 'algorand') {
          assert.ok(entry.address);
        }
      }
    }
    const xahau = registryByChain.get('xahau')[0];
    assert.equal(xahau.decimals, 'n/a');
    assert.equal(registryByChain.get('algorand')[0].decimals, 6);
    assert.equal(registryByChain.get('adi')[0].decimals, 6);
  });
});

describe('one-day copies of the four existing replacements', () => {
  it('bounds the scanned timestamp and leaves the 365-day files in place', () => {
    assert.equal(VALIDATION_OF_EXISTING.length, 5);
    const plasma = code(read('sql/replacements/6663259_plasma.sql'));
    assert.equal(plasma.includes('0x3ee196e78d4d4248b849b8e1c7f44c5457fafd2c'), true);
    assert.equal(plasma.includes('0x98658Bd74EF231158Cadc21d8AbA733a4E947e6a'), true);
    assert.equal(plasma.includes('0x90729a45948c3078890Bc80F2a4e7870A2Ea4C5E'), true);
    assert.equal(plasma.includes('0xC60BCA6BD5790611B8A302D4C5DF37D769C81121'), false);
    assert.equal(/CHF/i.test(plasma), false);
    assert.equal(plasma.includes("'EUROP', 6, 1.18"), true);
    assert.equal(plasma.includes("'EURC',  6, 1.18"), true);
    assert.equal(plasma.includes("'TRYB',  6, 0.023"), true);
    assert.equal(plasma.includes('prices.day'), false);
    assert.equal(plasma.includes('COUNT(*)'), true);
    const plasmaDay = code(read('sql/validation/6663259_one_day.sql'));
    assert.equal(plasmaDay.includes("CAST(e.evt_block_time AS DATE) = DATE '2026-11-06'"), true);
    assert.equal(plasmaDay.includes('prices.day'), false);
    for (const item of VALIDATION_OF_EXISTING) {
      const text = code(read(item.file));
      if (item.queryId !== 6663259) {
        assert.equal(text.includes("TIMESTAMP '2026-11-06 00:00:00'"), true, item.file);
        assert.equal(text.includes("TIMESTAMP '2026-11-07 00:00:00'"), true, item.file);
      }
      assert.equal(text.includes("INTERVAL '365' DAY"), false, item.file);
      assert.equal(Object.values(QUERIES).flat().includes(item.queryId), true);
    }
    assert.equal(read('sql/replacements/6614895_polygon.sql').includes("INTERVAL '365' DAY"), true);
    assert.equal(read('sql/validation/6689171_one_day.sql').includes('t.block_time < TIMESTAMP'), true);
    const grouped = groupCandidateRows([
      { blockchain: 'ethereum', token: 'EURQ' },
      { blockchain: 'base', token: 'EURAU' },
      { token: 'EURAU' },
    ]);
    assert.deepEqual([...grouped.keys()], ['ethereum', 'base']);
    assert.equal(grouped.get('ethereum')[0].token, 'EURQ');
  });
});
