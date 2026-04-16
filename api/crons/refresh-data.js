/**
 * Vercel Cron Job: Refresh dashboard data from Dune
 * Runs hourly, updates KV store
 *
 * Add to vercel.json:
 * "crons": [{"path": "/api/crons/refresh-data", "schedule": "0 * * * *"}]
 */

const { kv } = require('@vercel/kv');

const DUNE_API_KEY = process.env.DUNE_API_KEY;
const DUNE_BASE = 'https://api.dune.com/api/v1';

const QUERIES = {
  polygon: 6621899,
  stellar: 6712377,
  solana: 6689171,
};

async function executeDuneQuery(queryId) {
  console.log(`[${new Date().toISOString()}] Executing query ${queryId}...`);

  const execRes = await fetch(`${DUNE_BASE}/query/${queryId}/execute`, {
    method: 'POST',
    headers: { 'X-DUNE-API-KEY': DUNE_API_KEY },
  });
  const execJson = await execRes.json();
  if (!execJson.execution_id) {
    throw new Error(`Failed to start query ${queryId}: ${JSON.stringify(execJson)}`);
  }
  const execution_id = execJson.execution_id;

  // Poll for completion (max 5 minutes)
  let attempts = 0;
  while (attempts < 300) {
    const statusRes = await fetch(`${DUNE_BASE}/execution/${execution_id}/results`, {
      headers: { 'X-DUNE-API-KEY': DUNE_API_KEY },
    });
    const status = await statusRes.json();

    if (status.state === 'QUERY_STATE_COMPLETED') {
      console.log(`  ✓ Query ${queryId} completed (${attempts}s)`);
      return status.result.rows;
    }
    if (status.state === 'QUERY_STATE_FAILED') {
      throw new Error(`Query ${queryId} failed: ${status.error}`);
    }

    attempts++;
    if (attempts % 30 === 0) {
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

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log(`[${new Date().toISOString()}] Starting data refresh...`);

    const polygonRows = await executeDuneQuery(QUERIES.polygon);
    const stellarRows = await executeDuneQuery(QUERIES.stellar);
    const solanaRows = await executeDuneQuery(QUERIES.solana);

    const polygon = rowsToFormat(polygonRows, 'polygon');
    const stellar = rowsToFormat(stellarRows, 'stellar');
    const solana = rowsToFormat(solanaRows, 'solana');

    // Save to KV with 24h TTL
    const ttl = 86400; // 24 hours
    await Promise.all([
      kv.set('dashboard:polygon', polygon, { ex: ttl }),
      kv.set('dashboard:stellar', stellar, { ex: ttl }),
      kv.set('dashboard:solana', solana, { ex: ttl }),
      kv.set('dashboard:updated', new Date().toISOString(), { ex: ttl }),
    ]);

    console.log(`[${new Date().toISOString()}] ✓ Data refresh complete`);
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Data refreshed successfully',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ERROR:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
