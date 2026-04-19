#!/usr/bin/env node

/**
 * Fetch dashboard data from Dune Analytics API and store in Redis.
 * Usage: DUNE_API_KEY="..." REDIS_URL="redis://..." node fetch-dune-data.js
 * Designed for GitHub Actions scheduled runs.
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
  polygon: [6621899, 6602635, 6580019],
  stellar: [6712377],
  solana: [6689171],
  tron: [6695880],
};

/**
 * Fetch results for a single Dune query. Polls if still executing.
 */
async function fetchQueryResults(queryId) {
  console.log(`  Fetching query ${queryId}...`);

  const res = await fetch(`${DUNE_BASE}/query/${queryId}/results`, {
    headers: { Authorization: `Bearer ${DUNE_API_KEY}` },
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
      headers: { Authorization: `Bearer ${DUNE_API_KEY}` },
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
 * Matches the format used by load-cache.js and the dashboard.
 */
function rowsToFormat(rows, network) {
  const byDate = {};

  rows.forEach(row => {
    const dateStr = typeof row.date === 'string' ? row.date.split(' ')[0] : row.date;
    const tokenCode = row.token.includes(' - ')
      ? row.token.split(' - ').pop()
      : row.token;

    const txCount = parseInt(row.daily_transactions, 10);
    let volumeUsd;

    if (network === 'solana') {
      volumeUsd = parseFloat(row.transfer_volume || 0);
    } else if (network === 'stellar') {
      volumeUsd = parseFloat(row.transfer_volume_usd || 0);
    } else if (network === 'polygon') {
      volumeUsd = parseFloat(row.transfer_volume_usd || 0);
    } else if (network === 'tron') {
      volumeUsd = parseFloat(row.transfer_volume_usd || row.transfer_volume || 0);
    } else {
      volumeUsd = parseFloat(row.transfer_volume_usd || row.transfer_volume || 0);
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
  if (!DUNE_API_KEY) {
    console.error('ERROR: DUNE_API_KEY env var not set');
    process.exit(1);
  }

  if (!REDIS_URL) {
    console.error('ERROR: REDIS_URL env var not set');
    process.exit(1);
  }

  const client = createClient({ url: REDIS_URL });

  try {
    console.log('Connecting to Redis...');
    await client.connect();
    console.log('✓ Connected to Redis');

    console.log('\nFetching data from Dune Analytics...');

    // Fetch all networks
    const polygonRows = await fetchNetwork('polygon', QUERIES.polygon);
    const stellarRows = await fetchNetwork('stellar', QUERIES.stellar);
    const solanaRows = await fetchNetwork('solana', QUERIES.solana);
    const tronRows = await fetchNetwork('tron', QUERIES.tron);

    // Format to pipe-delimited
    const polygonData = rowsToFormat(polygonRows, 'polygon');
    const stellarData = rowsToFormat(stellarRows, 'stellar');
    const solanaData = rowsToFormat(solanaRows, 'solana');
    const tronData = rowsToFormat(tronRows, 'tron');

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
