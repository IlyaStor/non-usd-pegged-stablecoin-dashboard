#!/usr/bin/env node

/**
 * Refresh dashboard data from Dune and update Vercel env vars
 * Run manually: node refresh-data.js
 * Or schedule via: vercel env add
 */

const DUNE_API_KEY = process.env.DUNE_API_KEY;
const DUNE_BASE = 'https://api.dune.com/api/v1';

const QUERIES = {
  polygon: 6621899,
  stellar: 6712377,
  solana: 6689171,
};

/**
 * Execute Dune query and wait for completion
 */
async function executeDuneQuery(queryId) {
  console.log(`Executing query ${queryId}...`);

  const execRes = await fetch(`${DUNE_BASE}/query/${queryId}/execute`, {
    method: 'POST',
    headers: { 'X-DUNE-API-KEY': DUNE_API_KEY },
  });
  const execJson = await execRes.json();
  if (!execJson.execution_id) {
    throw new Error(`Failed to start query ${queryId}: ${JSON.stringify(execJson)}`);
  }
  const execution_id = execJson.execution_id;
  console.log(`  Execution ID: ${execution_id}`);

  // Poll for completion (max 5 minutes)
  let attempts = 0;
  while (attempts < 300) {
    const statusRes = await fetch(`${DUNE_BASE}/execution/${execution_id}/results`, {
      headers: { 'X-DUNE-API-KEY': DUNE_API_KEY },
    });
    const status = await statusRes.json();

    if (status.state === 'QUERY_STATE_COMPLETED') {
      console.log(`  ✓ Completed (${attempts}s)`);
      return status.result.rows;
    }
    if (status.state === 'QUERY_STATE_FAILED') {
      throw new Error(`Query ${queryId} failed: ${status.error}`);
    }

    attempts++;
    if (attempts % 10 === 0) {
      console.log(`  Still executing... (${attempts}s)`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Query ${queryId} timeout after 5 minutes`);
}

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

  try {
    console.log('Fetching fresh data from Dune...\n');

    const polygonRows = await executeDuneQuery(QUERIES.polygon);
    const stellarRows = await executeDuneQuery(QUERIES.stellar);
    const solanaRows = await executeDuneQuery(QUERIES.solana);

    const polygon = rowsToFormat(polygonRows, 'polygon');
    const stellar = rowsToFormat(stellarRows, 'stellar');
    const solana = rowsToFormat(solanaRows, 'solana');

    console.log('\n✓ Data fetched successfully!\n');
    console.log('To update Vercel, run:\n');
    console.log('vercel env add POLYGON_DATA');
    console.log('vercel env add STELLAR_DATA');
    console.log('vercel env add SOLANA_DATA');
    console.log('\nThen paste the data below:\n');

    console.log('=== POLYGON_DATA ===');
    console.log(polygon);
    console.log('\n=== STELLAR_DATA ===');
    console.log(stellar);
    console.log('\n=== SOLANA_DATA ===');
    console.log(solana);

  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();
