import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ACTIVATION_FACTS, MANUAL_QUERY_EDITS } from '../lib/activation-steps.js';
import { pendingSqlFiles } from '../lib/pending-sql.js';
import { FX_FALLBACK, QUERIES, coverageFromNetworks } from '../lib/series.js';
import {
  DASHBOARD_NETWORK_BY_SLUG,
  STATUS,
  analyticsSymbol,
  arcContractsFromSql,
  buildCatalogReport,
  sqlTokenRows,
  symbolsInPipe,
} from '../lib/token-catalog.js';
import { renderRegistryHtml } from '../lib/registry-view.js';

const registry = JSON.parse(readFileSync('registry/verified-additions.json', 'utf8'));
const published = JSON.parse(readFileSync('data.json', 'utf8'));
const arcSql = readFileSync('sql/arc_nonusd_transfers.sql', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const index = readFileSync('index.html', 'utf8');
const report = buildCatalogReport({
  registry,
  data: published.data,
  executions: published.executions,
  arcSql,
});

const KNOWN_QUERY_IDS = new Set([...Object.values(QUERIES).flat(), 9117254]);

function rows(status) {
  return report.rows.filter(row => row.status === status);
}

describe('verified registry', () => {
  it('keeps 41 entries and 11 tokens, with no invariant failures', () => {
    assert.equal(registry.entries.length, 41);
    assert.equal(new Set(registry.entries.map(entry => entry.token)).size, 11);
    assert.deepEqual(report.issues, []);
    assert.deepEqual(report.summary, {
      entries: 41,
      tokens: 11,
      live: 13,
      listedInRepoSql: 3,
      pendingDune: 14,
      candidateNotSaved: 0,
      blockedNoFx: 1,
      newChainPending: 7,
      datasetUnconfirmed: 3,
      unsupported: 0,
      notInPublishedSeries: 28,
      sentence: '41 verified token-network entries (11 tokens): 13 already in the published series, 3 listed in the saved Arc query but absent from that series, 14 in replacement SQL that is not yet the published series, 0 in candidate diffs that are not saved on Dune, 1 blocked with no sourced USD rate, 7 on chains with candidate SQL but no query id, 3 on chains whose Dune dataset is unconfirmed.',
    });
    assert.equal(readme.includes(report.summary.sentence), true);
  });

  it('does not include the excluded deployments', () => {
    const present = registry.entries.map(entry => `${entry.token}|${entry.chain_slug}`);
    for (const banned of ['SEKAU|solana', 'SIDR|ethereum', 'BRMB|ethereum', 'EURITE|polygon']) {
      assert.equal(present.includes(banned), false, banned);
    }
    assert.equal(registry.exclusions.length, 12);
    assert.equal(registry.entries.some(entry => entry.token === 'IDRX' && entry.chain_slug === 'ethereum'), false);
    assert.equal(registry.entries.some(entry => String(entry.address).includes('idrxTdNftk6tYedPv2M7tCFHBVCpk5rkiNRd8yUArhr')), false);
    assert.equal(present.includes('EURR|plasma'), false);
    assert.equal(present.includes('EURC|plasma'), true);
  });

  it('keeps issued-currency decimals as n/a and EURITE as EURI', () => {
    const issued = registry.entries.filter(entry => entry.chain_slug === 'xrpl' || entry.chain_slug === 'xahau');
    assert.equal(issued.length, 3);
    for (const entry of issued) {
      assert.equal(entry.decimals, 'n/a');
      assert.equal(typeof entry.decimals, 'string');
    }
    for (const entry of registry.entries.filter(entry => entry.token === 'EURITE')) {
      assert.equal(analyticsSymbol(entry), 'EURI');
      assert.equal(entry.onchain_symbol, 'EURI');
    }
  });

  it('keeps Stellar classic, SAC, and SEP-41 identities apart', () => {
    const stellar = Object.fromEntries(report.rows.filter(row => row.chainSlug === 'stellar').map(row => [row.token, row]));
    assert.equal(stellar.EURQ.standard, 'Stellar classic asset');
    assert.equal(stellar.EURQ.stellar.issuer, stellar.EURQ.address);
    assert.ok(stellar.EURQ.stellar.sac_contract);
    assert.equal(stellar.EURQ.stellar.sac_contract === stellar.EURQ.address, false);
    assert.equal(stellar.EURCV.standard, 'Stellar classic asset + SAC');
    assert.equal(stellar.EURCV.stellar.sac_contract, stellar.EURCV.address);
    assert.notEqual(stellar.EURCV.stellar.issuer, stellar.EURCV.address);
    assert.equal(stellar.EURAU.standard, 'SEP-41');
    assert.equal(stellar.EURAU.stellar.contract, stellar.EURAU.address);
    assert.equal(stellar.EURAU.stellar.issuer, null);
    assert.equal(stellar.EURAU.decimals, 6);
    assert.equal(stellar.BRMB.decimals, 7);
  });
});

describe('published series stay separate from the catalog', () => {
  it('marks a registry row live only when its symbol is in that network pipe', () => {
    assert.deepEqual(
      rows(STATUS.LIVE).map(row => `${row.analyticsSymbol}|${row.dashboardNetwork}`).sort(),
      [
        'CHFAU|polygon',
        'CHFAU|solana',
        'EURAU|bsc',
        'EURAU|solana',
        'EURAU|stellar',
        'EURC|plasma',
        'EURCV|solana',
        'EURCV|stellar',
        'EURI|bsc',
        'EURQ|polygon',
        'EURQ|stellar',
        'SEKAU|polygon',
        'ZARsc|solana',
      ].sort(),
    );
    assert.equal(rows(STATUS.LIVE).some(row => row.token === 'IDRX'), false);
    for (const pipe of Object.values(published.data)) {
      const symbols = symbolsInPipe(pipe);
      for (const symbol of ['IDRX', 'BRMB', 'DDSC']) assert.equal(symbols.has(symbol), false, symbol);
    }
    assert.equal(symbolsInPipe(published.data.polygon).has('EURQ'), true);
    assert.equal(symbolsInPipe(published.data.polygon).has('EURAU'), false);
    assert.equal(symbolsInPipe(published.data.solana).has('EURCV'), true);
    assert.equal(symbolsInPipe(published.data.stellar).has('EURQ'), true);
  });

  it('does not add networks or query ids', () => {
    assert.deepEqual(QUERIES, {
      polygon: [6614895, 6621899],
      stellar: [6712377],
      solana: [6689171],
      tron: [6695880],
      plasma: [6663259],
      bsc: [8748306],
      arc: [8924650],
    });
    const chainNets = JSON.parse(index.match(/const CHAIN_NETS = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
    assert.deepEqual(chainNets, Object.keys(QUERIES));
    assert.equal(index.includes('data-net="registry"'), true);
    assert.equal(chainNets.includes('registry'), false);
    assert.equal(DASHBOARD_NETWORK_BY_SLUG.ethereum, 'ethereum');
    assert.equal(Object.prototype.hasOwnProperty.call(QUERIES, 'ethereum'), false);
    const coverage = coverageFromNetworks(published.data);
    assert.equal(published.coverage.tokens, coverage.tokens);
    assert.equal(published.coverage.chains, coverage.chains);
    assert.equal(published.coverage.exhaustive, false);
  });

  it('shares the existing EUR fallback and does not invent CNY or AED rates', () => {
    assert.equal(FX_FALLBACK.EURQ, FX_FALLBACK.EURC);
    assert.equal(FX_FALLBACK.EURI, FX_FALLBACK.EURC);
    assert.equal(Object.prototype.hasOwnProperty.call(FX_FALLBACK, 'BRMB'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(FX_FALLBACK, 'DDSC'), false);
  });
});

describe('Dune SQL preparation', () => {
  it('finds each Arc registry contract once, with decimals 6, and does not treat comments as rows', () => {
    const wanted = registry.entries
      .filter(entry => entry.chain_slug === 'arc')
      .map(entry => entry.address.toLowerCase());
    assert.deepEqual(wanted.sort(), [
      '0x4933a85b5b5466fbaf179f72d3de273c287ec2c2',
      '0xc6df1b92a6ae61a27059c41e541a91ce8dcb1605',
      '0xf8524b5ab17d5eca2f78abe8377ceffd323b1dc1',
    ].sort());
    for (const file of [
      'sql/arc_nonusd_transfers.sql',
      'sql/arc_nonusd_transfers_clean.sql',
      'sql/arc_flow_classification.sql',
    ]) {
      const tokenRows = sqlTokenRows(readFileSync(file, 'utf8'));
      for (const address of wanted) {
        const hits = tokenRows.filter(row => row.address.toLowerCase() === address);
        assert.equal(hits.length, 1, `${file} ${address}`);
        assert.equal(hits[0].decimals, 6);
      }
    }
    assert.equal(arcContractsFromSql(arcSql).has('0x4933a85b5b5466fbaf179f72d3de273c287ec2c2'), true);
    assert.deepEqual(
      rows(STATUS.LISTED_IN_REPO_SQL).map(row => row.analyticsSymbol).sort(),
      ['CHFAU', 'EURAU', 'SEKAU'],
    );
  });

  it('points the old pending notes at the full replacement files', () => {
    const files = pendingSqlFiles();
    for (const [path, text] of Object.entries(files)) {
      assert.equal(readFileSync(path, 'utf8'), text, path);
      assert.equal(text.startsWith('-- SUPERSEDED — NOT EXECUTABLE.'), true);
      assert.equal(/\bFROM\b/.test(text), false, path);
      assert.equal(text.includes('Do not create a new Dune query id.'), true);
      assert.equal(text.includes('Do not insert zero-volume history.'), true);
      assert.equal(text.includes('sql/replacements/'), true);
    }
  });

  it('points manual edits only at query ids the refresh already runs', () => {
    for (const step of MANUAL_QUERY_EDITS) {
      assert.deepEqual(step.ids, QUERIES[step.network]);
      for (const id of step.ids) assert.equal(KNOWN_QUERY_IDS.has(id), true);
      assert.equal(readme.includes(String(step.ids[0])), true);
    }
    for (const fact of ACTIVATION_FACTS) {
      assert.equal(readme.includes(fact), true, fact);
    }
    assert.equal(rows(STATUS.PENDING_DUNE).length, 14);
    assert.equal(rows(STATUS.PENDING_DUNE).some(row => row.analyticsSymbol === 'EURAU' && row.dashboardNetwork === 'polygon'), true);
    assert.equal(rows(STATUS.PENDING_DUNE).some(row => row.analyticsSymbol === 'IDRX' && row.dashboardNetwork === 'polygon'), true);
    assert.equal(rows(STATUS.LIVE).some(row => row.analyticsSymbol === 'EURC' && row.dashboardNetwork === 'plasma'), true);
    assert.equal(rows(STATUS.BLOCKED_NO_FX).length, 1);
    assert.equal(rows(STATUS.BLOCKED_NO_FX)[0].analyticsSymbol, 'BRMB');
    assert.equal(rows(STATUS.NEW_CHAIN_PENDING).length, 7);
    assert.equal(rows(STATUS.CANDIDATE_NOT_SAVED).length, 0);
    assert.equal(rows(STATUS.DATASET_UNCONFIRMED).length, 3);
    assert.equal(rows(STATUS.UNSUPPORTED_CHAIN).length, 0);
    for (const row of rows(STATUS.NEW_CHAIN_PENDING)) assert.deepEqual(row.queryIds, []);
    for (const row of rows(STATUS.DATASET_UNCONFIRMED)) assert.deepEqual(row.queryIds, []);
    for (const row of rows(STATUS.PENDING_DUNE)) {
      assert.ok(row.queryIds.length > 0);
      for (const id of row.queryIds) assert.equal(KNOWN_QUERY_IDS.has(id), true);
    }
  });
});

describe('registry tab copy', () => {
  it('describes the catalog as separate from tracked volume and links only known query ids', () => {
    const html = renderRegistryHtml(report);
    assert.equal(html.includes('Verified catalog, not tracked volume.'), true);
    assert.equal(html.includes(report.summary.sentence), true);
    assert.equal(html.includes('>n/a<'), true);
    assert.equal(html.includes('SEP-41'), true);
    assert.equal(html.includes('product EURITE'), true);
    assert.equal(html.includes('program, not a mint'), true);
    assert.equal(html.includes('Celo'), true);
    assert.equal(html.includes('queries/9117254'), true);
    const linked = [...html.matchAll(/queries\/(\d+)/g)].map(match => Number(match[1]));
    assert.ok(linked.length > 0);
    for (const id of linked) assert.equal(KNOWN_QUERY_IDS.has(id), true, String(id));
    assert.equal(html.includes('data.json'), true);
  });
});
