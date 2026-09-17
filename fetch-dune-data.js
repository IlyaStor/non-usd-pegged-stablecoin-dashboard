#!/usr/bin/env node

/**
 * Fetch dashboard data from Dune Analytics API and store in Redis.
 * Usage: DUNE_API_KEY="..." REDIS_URL="redis://..." node fetch-dune-data.js
 * Designed for GitHub Actions scheduled runs.
 *
 * NOTE: this script reads the LAST execution result of each Dune query.
 * It does NOT execute queries — that is done manually by the maintainer
 * on Dune (see: https://dune.com/queries/<id> → Run).
 */

import { createClient } from 'redis';

const DUNE_API_KEY = process.env.DUNE_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const DUNE_BASE = 'https://api.dune.com/api/v1';

// Debug: Check if API key is present
if (!DUNE_API_KEY) {
  console.error('❌ ERROR: DUNE_API_KEY environment variable is not set');
  process.exit(1);
}
console.log(`✓ DUNE_API_KEY present (${DUNE_API_KEY.substring(0, 10)}...)`);
if (!REDIS_URL) {
  console.error('❌ ERROR: REDIS_URL environment variable is not set');
  process.exit(1);
}
console.log('✓ REDIS_URL present');

const QUERIES = {
  polygon: [6614895, 6621899],  // Part 1 (CAD/AUD/EUR/TRY/ZAR/NGN) + Part 2 (BRL/COP/JPY/SGD/IDR/PHP)
  stellar: [6712377],
  solana:  [6689171],
  tron:    [6695880],
  plasma:  [6663259],            // Plasma volume query; 6665855 (count) is redundant — daily_transactions = transfer_count
};

// Fallback FX rates used ONLY when the Dune query did not return transfer_volume_usd
// (e.g. someone edits the SQL and forgets to keep the column). Safety net, not primary path.
const FX_FALLBACK = {
  // Solana
  EURC: 1.14, EUROe: 1.14, VEUR: 1.14, EURCV: 1.14,
  VCHF: 1.10, BRZ: 0.18, GYEN: 0.0066,
  // Tron
  A7A5: 0.011, PHT: 0.017,
  // Plasma
  EUROP: 1.14, TRYB: 0.029,
};

/**
 * Fetch results for a single Dune query. Polls if still executing.
 */
async function fetchQueryResults(queryId) {
  console.log(`  Fetching query ${queryId}...`);

  const res = await fetch(`${DUNE_BASE}/query/${queryId}/results`, {
    headers: { 'X-Dune-Api-Key': DUNE_API_KEY },
  });

  if (!res.ok) {
    throw new Error(`API error for query ${queryId}: ${res.status} ${res.statusText}`);
  }

  let data = await res.json();

  // Poll if query is still executing
  let attempts = 0;
  const maxAttempts = 150; // 5 minutes at 2s intervals
  while (data.state === 'QUERY_STATE_EXECUTING' && attempts < maxAttempts) {
    attempts++;
    if (attempts % 5 === 0) {
      console.log(`    Still executing... (${attempts * 2}s)`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pollRes = await fetch(`${DUNE_BASE}/query/${queryId}/results`, {
      headers: { 'X-Dune-Api-Key': DUNE_API_KEY },
    });
    if (!pollRes.ok) {
      throw new Error(`Poll error for query ${queryId}: ${pollRes.status} ${pollRes.statusText}`);
    }
    data = await pollRes.json();
  }

  if (data.state === 'QUERY_STATE_EXECUTING') {
    throw new Error(`Query ${queryId} timed out after ${maxAttempts * 2}s`);
  }

  if (data.state === 'QUERY_STATE_FAILED') {
    throw new Error(`Query ${queryId} failed: ${data.error || 'unknown error'}`);
  }

  const rows = data.result?.rows || [];
  console.log(`  ✓ Query ${queryId}: ${rows.length} rows`);
  return rows;
}

/**
 * Fetch and combine rows for all query IDs belonging to a network.
 */
async function fetchNetwork(network, queryIds) {
  console.log(`\nProcessing ${network}...`);
  let allRows = [];

  for (const qid of queryIds) {
    const rows = await fetchQueryResults(qid);
    allRows = allRows.concat(rows);
  }

  console.log(`  Total rows for ${network}: ${allRows.length}`);
  return allRows;
}

/**
 * Convert rows to pipe-delimited format, grouped by date, sorted descending.
 * All networks now return transfer_volume_usd from SQL — use it directly.
 * Fallback to native * FX_FALLBACK only if USD column is missing/zero.
 */
function rowsToFormat(rows, network) {
  const byDate = {};

  rows.forEach(row => {
    // Date: trim " 00:00:00.000 UTC" suffix if present
    const dateStr = typeof row.date === 'string' ? row.date.split(' ')[0] : row.date;

    // Token: extract short code from "Brazilian rial - BRLA" format
    const tokenCode = row.token.includes(' - ')
      ? row.token.split(' - ').pop().trim()
      : row.token.trim();

    const txCount = parseInt(row.daily_transactions, 10) || 0;

    // Primary: use SQL-side transfer_volume_usd
    let volumeUsd = parseFloat(row.transfer_volume_usd || 0);

    // Safety fallback: if USD column missing or zero but native volume present
    if (!volumeUsd) {
      const nativeVol = parseFloat(row.transfer_volume || row.transfer_volume_native || 0);
      const fx = FX_FALLBACK[tokenCode];
      if (fx && nativeVol > 0) {
        volumeUsd = nativeVol * fx;
        console.warn(`  ⚠ ${network}/${tokenCode}: USD column empty, using fallback FX=${fx}`);
      }
    }

    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push([tokenCode, txCount, volumeUsd.toFixed(2)]);
  });

  const dates = Object.keys(byDate).sort().reverse();
  return dates
    .map(date => {
      const datePart = [date];
      const tokens = byDate[date];
      tokens.forEach(([code, tx, vol]) => {
        datePart.push(code, tx.toString(), vol);
      });
      return datePart.join('|');
    })
    .join('\n');
}

async function main() {
  const client = createClient({ url: REDIS_URL });

  try {
    console.log('Connecting to Redis...');
    await client.connect();
    console.log('✓ Connected to Redis');

    console.log('\nFetching data from Dune Analytics...');

    // Fetch all networks
    const polygonRows = await fetchNetwork('polygon', QUERIES.polygon);
    const stellarRows = await fetchNetwork('stellar', QUERIES.stellar);
    const solanaRows  = await fetchNetwork('solana',  QUERIES.solana);
    const tronRows    = await fetchNetwork('tron',    QUERIES.tron);
    const plasmaRows  = await fetchNetwork('plasma',  QUERIES.plasma);

    // Format to pipe-delimited
    const polygonData = rowsToFormat(polygonRows, 'polygon');
    const stellarData = rowsToFormat(stellarRows, 'stellar');
    const solanaData  = rowsToFormat(solanaRows,  'solana');
    const tronData    = rowsToFormat(tronRows,    'tron');
    const plasmaData  = rowsToFormat(plasmaRows,  'plasma');

    // Store in Redis with 24h TTL
    console.log('\nSaving to Redis...');

    await client.setEx('dashboard:polygon', 86400, polygonData);
    console.log(`✓ dashboard:polygon (${polygonData.length} chars)`);

    await client.setEx('dashboard:stellar', 86400, stellarData);
    console.log(`✓ dashboard:stellar (${stellarData.length} chars)`);

    await client.setEx('dashboard:solana', 86400, solanaData);
    console.log(`✓ dashboard:solana (${solanaData.length} chars)`);

    await client.setEx('dashboard:tron', 86400, tronData);
    console.log(`✓ dashboard:tron (${tronData.length} chars)`);

    await client.setEx('dashboard:plasma', 86400, plasmaData);
    console.log(`✓ dashboard:plasma (${plasmaData.length} chars)`);

    const timestamp = new Date().toISOString();
    await client.setEx('dashboard:updated', 86400, timestamp);
    console.log(`✓ dashboard:updated (${timestamp})`);

    console.log('\n✅ All data refreshed successfully');

  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  } finally {
    await client.quit();
  }
}

main();
