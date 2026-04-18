/**
 * Vercel Function: Serve dashboard data from KV cache
 * GET /api/dashboard-data
 *
 * Returns cached data updated by cron job
 * Version 2 - Fresh deployment
 */

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  // Cache on CDN for 1 hour, stale-while-revalidate for 24 hours
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  try {
    console.log(`[${new Date().toISOString()}] GET /api/dashboard-data — fetching from Redis...`);

    // Fetch all three datasets from Redis in parallel
    const [polygon, stellar, solana, updated] = await Promise.all([
      kv.get('dashboard:polygon'),
      kv.get('dashboard:stellar'),
      kv.get('dashboard:solana'),
      kv.get('dashboard:updated'),
    ]);

    console.log(`[${new Date().toISOString()}] Retrieved: polygon=${polygon ? polygon.length : 0} chars, stellar=${stellar ? stellar.length : 0} chars, solana=${solana ? solana.length : 0} chars`);

    // Check if data exists
    if (!polygon || !stellar || !solana) {
      return res.status(503).json({
        success: false,
        error: 'Data not yet cached. Cron job will populate data on first run.',
      });
    }

    res.status(200).json({
      success: true,
      timestamp: updated || new Date().toISOString(),
      data: {
        polygon,
        stellar,
        solana,
      },
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching from KV:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
