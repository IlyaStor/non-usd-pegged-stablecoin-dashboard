import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  A7A5_SYMBOL,
  a7a5VolumeShare,
  dropA7A5Items,
  parseTrackedRows,
  searchWithWithoutParam,
  withoutA7A5Requested,
} from '../lib/a7a5-toggle.js';
import { ETHEREUM_BASE_QUERY_ID } from '../lib/ethereum-base-query.js';
import { FX_FALLBACK } from '../lib/series.js';

const index = readFileSync('index.html', 'utf8');
const methodology = readFileSync('methodology.html', 'utf8');
const work = readFileSync('work.html', 'utf8');
const workflow = readFileSync('.github/workflows/refresh-data.yml', 'utf8');
const published = JSON.parse(readFileSync('data.json', 'utf8'));
const querySwitch = readFileSync('lib/ethereum-base-query.js', 'utf8');
const deprecatedMint = 'idrxTdNftk6tYedPv2M7tCFHBVCpk5rkiNRd8yUArhr';
const idrxEvm = '0x649a2DA7B28E0D54c13D5eFf95d3A660652742cC';
const idrxBase = '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22';
const idrxSolana = 'idrxZcP8xiKkYk6XGD4uz1dxEYCWSgKDHqgjsBbwDur';

function code(text) {
  return text.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
}

describe('without A7A5', () => {
  const rows = [
    { d: '2026-11-01', items: [{ t: 'A7A5', tx: 2, v: 70 }, { t: 'EURC', tx: 1, v: 30 }] },
    { d: '2026-11-02', items: [{ t: 'A7A5', tx: 1, v: 10 }] },
    { d: '2026-11-03', items: [{ t: 'A7A5x', tx: 1, v: 5 }] },
  ];

  it('keeps A7A5 unless the URL asks for without=A7A5', () => {
    assert.equal(withoutA7A5Requested(''), false);
    assert.equal(withoutA7A5Requested('?network=tron'), false);
    assert.equal(withoutA7A5Requested('?without=a7a5'), false);
    assert.equal(withoutA7A5Requested('?without=A7A5'), true);
    assert.equal(searchWithWithoutParam('?network=tron', false), '?network=tron');
    assert.equal(searchWithWithoutParam('?network=tron', true), '?network=tron&without=A7A5');
    assert.equal(dropA7A5Items(rows, false), rows);
  });

  it('drops only the exact label from totals, rankings, and a day that becomes empty', () => {
    const filtered = dropA7A5Items(rows, true);
    const symbols = filtered.flatMap(row => row.items.map(item => item.t));
    assert.deepEqual(symbols, ['EURC', 'A7A5x']);
    const before = a7a5VolumeShare(rows.map(row => ({ ...row, network: 'tron' })));
    const after = a7a5VolumeShare(filtered.map(row => ({ ...row, network: 'tron' })));
    assert.equal(before.volume, 80);
    assert.equal(after.volume, 0);
    assert.equal(after.total, 35);
    assert.equal(index.includes("i.t!=='A7A5'"), true);
    assert.equal(index.includes("get('without')==='A7A5'"), true);
    assert.equal(index.includes('aria-pressed="false"'), true);
    assert.equal(index.includes('id="a7a5Toggle"'), true);
  });

  it('reads the current share from data.json instead of a fixed percent', () => {
    const share = a7a5VolumeShare(parseTrackedRows(published.data, published.executions));
    assert.equal(share.symbol, A7A5_SYMBOL);
    assert.deepEqual(share.chains, ['tron']);
    assert.equal(share.share > 0.5 && share.share < 0.9, true);
    assert.equal(methodology.includes('70%'), false);
    assert.equal(methodology.includes('a7a5VolumeShare'), true);
    assert.equal(methodology.includes('0x751f6515e355dc49474a8565a1234bf3424b9fe4'), true);
    assert.equal(methodology.includes('6695880'), true);
  });
});

describe('IDRX candidates', () => {
  it('mirrors the saved IDRX rows and leaves Polygon part 2 unchanged', () => {
    const part2 = readFileSync('sql/replacements/6621899_polygon.sql', 'utf8');
    assert.equal(part2.toLowerCase().includes(idrxEvm.toLowerCase()), false);
    for (const file of [
      'sql/replacements/6614895_polygon.sql',
      'sql/replacements/8748306_bsc.sql',
      'sql/replacements/6689171_solana.sql',
    ]) {
      assert.equal(code(readFileSync(file, 'utf8')).includes(deprecatedMint), false, file);
    }
    const polygon = readFileSync('sql/candidates/6614895_polygon_idrx.diff', 'utf8');
    const bsc = readFileSync('sql/candidates/8748306_bsc_idrx.diff', 'utf8');
    const solana = readFileSync('sql/candidates/6689171_solana_idrx.diff', 'utf8');
    assert.equal(polygon.includes(idrxEvm), true);
    assert.equal(polygon.includes("'Indonesian Rupiah - IDRX', 0, 0.000061"), true);
    assert.equal(bsc.includes("'IDRX', 0, 0.000061"), true);
    assert.equal(solana.includes(idrxSolana), true);
    const addedSql = solana.split('\n').filter(line => line.startsWith('+') && !line.includes('--')).join('\n');
    assert.equal(addedSql.includes(deprecatedMint), false);
    assert.equal(solana.includes(deprecatedMint), true);
    assert.equal(readFileSync('sql/replacements/6614895_polygon.sql', 'utf8').includes(idrxEvm), true);
    assert.equal(readFileSync('sql/replacements/8748306_bsc.sql', 'utf8').includes("'IDRX', 0, 0.000061"), true);
    assert.equal(readFileSync('sql/replacements/6689171_solana.sql', 'utf8').includes(idrxSolana), true);
    assert.equal(readFileSync('sql/replacements/6689171_solana.sql', 'utf8').includes('5ekaHEqpRUXH4RoZVRMErdJE74bibWAzihMtPcjKyceQ'), true);
    const base = readFileSync('sql/candidates/ethereum_base_tokens_transfers_365.sql', 'utf8');
    assert.equal(base.includes(idrxBase), true);
    assert.equal(base.includes("'Indonesian Rupiah - IDRX', 2, 0.000061"), true);
    assert.equal(base.includes(`('ethereum', ${idrxBase}`), false);
    assert.equal(code(base).includes(deprecatedMint), false);
    assert.equal(FX_FALLBACK.IDRX, 0.000061);
    assert.equal(ETHEREUM_BASE_QUERY_ID, 9117254);
    assert.equal((querySwitch.match(/ETHEREUM_BASE_QUERY_ID = /g) || []).length, 1);
  });
});

describe('pages', () => {
  it('describes the pipeline from the repo and keeps the work packages as placeholders', () => {
    for (const id of ['6614895', '6621899', '6712377', '6689171', '6695880', '6663259', '8748306', '8924650']) {
      assert.equal(methodology.includes(id), true, id);
    }
    assert.equal(methodology.includes('stellar.history_contract_events'), true);
    assert.equal(methodology.includes('Classic Stellar payments'), true);
    assert.equal(methodology.includes('BRMB'), true);
    assert.equal(methodology.includes('0.000061'), true);
    assert.equal(methodology.includes('without=A7A5'), true);
    assert.equal(methodology.includes('ETHEREUM_BASE_QUERY_ID'), true);
    assert.equal(methodology.includes('9117254'), true);
    assert.equal(methodology.includes('about 25 credits'), true);
    assert.equal(methodology.includes(idrxEvm), true);
    assert.equal(methodology.includes('decimals 0'), true);
    assert.equal(methodology.includes('Celo'), true);
    assert.equal(/Rock.?n.?Block/i.test(methodology + work), false);
    assert.equal(work.includes('PLACEHOLDER — Package 1'), true);
    assert.equal(work.includes('PLACEHOLDER — Package 2'), true);
    assert.equal(work.includes('PLACEHOLDER — Package 3'), true);
    assert.equal(work.includes('https://t.me/solosolver'), true);
    assert.equal(work.includes('https://solosolver.xyz'), true);
    assert.equal(/\$\d/.test(work), false);
    assert.equal(/testimonial/i.test(work), false);
    assert.equal(index.includes('href="/methodology.html"'), true);
    assert.equal(index.includes('href="/work.html"'), true);
    assert.equal(workflow.includes("cron: '0 0 */2 * *'"), true);
    assert.equal(workflow.includes('6614895'), false);
  });
});
