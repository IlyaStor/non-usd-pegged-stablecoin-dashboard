/**
 * Vercel Function: Fetch dashboard data from Dune Analytics
 * GET /api/dashboard-data
 *
 * Returns: {polygon, stellar, solana} in pipe-delimited format
 */

const DUNE_API_KEY = process.env.DUNE_API_KEY;
const DUNE_BASE = 'https://api.dune.com/api/v1';

// Dune query IDs (90-day rolling window, Jan 15 - Apr 15 hardcoded)
const QUERIES = {
  polygon: 6621899,
  stellar: 6712377,
  solana: 6689171,
};

/**
 * Execute Dune query and wait for completion
 */
async function executeDuneQuery(queryId) {
  // Start execution
  const execRes = await fetch(`${DUNE_BASE}/query/${queryId}/execute`, {
    method: 'POST',
    headers: { 'X-DUNE-API-KEY': DUNE_API_KEY },
  });
  const { execution_id } = await execRes.json();

  // Poll for completion (max 60s)
  let attempts = 0;
  while (attempts < 120) {
    const statusRes = await fetch(`${DUNE_BASE}/execution/${execution_id}/results`, {
      headers: { 'X-DUNE-API-KEY': DUNE_API_KEY },
    });
    const status = await statusRes.json();

    if (status.state === 'QUERY_STATE_COMPLETED') {
      return status.result.rows;
    }
    if (status.state === 'QUERY_STATE_FAILED') {
      throw new Error(`Query ${queryId} failed: ${status.error}`);
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Query ${queryId} timeout`);
}

/**
 * Convert row data to pipe-delimited format
 * Format: date|TOKEN|txcount|volume_usd|TOKEN|txcount|volume_usd|...
 */
function rowsToFormat(rows, network) {
  const byDate = {};

  rows.forEach(row => {
    // Extract date (handle both "2026-01-15" and "2026-01-15 00:00:00.000 UTC")
    const dateStr = typeof row.date === 'string' ? row.date.split(' ')[0] : row.date;

    // Extract token code (last part after " - ")
    const tokenCode = row.token.includes(' - ')
      ? row.token.split(' - ').pop()
      : row.token;

    const txCount = parseInt(row.daily_transactions, 10);

    // Determine volume field name by network
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

  // Build pipe-delimited string, reverse chronological
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

/**
 * Main handler
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Allow 5 min cache on CDN
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  try {
    console.log('Fetching Polygon...');
    const polygonRows = await executeDuneQuery(QUERIES.polygon);

    console.log('Fetching Stellar...');
    const stellarRows = await executeDuneQuery(QUERIES.stellar);

    console.log('Fetching Solana...');
    const solanaRows = await executeDuneQuery(QUERIES.solana);

    // Convert to dashboard format
    const polygon = rowsToFormat(polygonRows, 'polygon');
    const stellar = rowsToFormat(stellarRows, 'stellar');
    const solana = rowsToFormat(solanaRows, 'solana');

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        polygon,
        stellar,
        solana,
      },
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
