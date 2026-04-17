/**
 * Vercel Function: Serve dashboard data from KV cache
 * GET /api/dashboard-data
 *
 * Returns cached data updated by cron job
 */

const redis = require('@vercel/kv').createClient({
  url: process.env.REDIS_URL,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  // Cache on CDN for 1 hour, stale-while-revalidate for 24 hours
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  try {
    // Fetch all three datasets from Redis in parallel
    const [polygon, stellar, solana, updated] = await Promise.all([
      redis.get('dashboard:polygon'),
      redis.get('dashboard:stellar'),
      redis.get('dashboard:solana'),
      redis.get('dashboard:updated'),
    ]);

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
    console.error('Error fetching from KV:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
