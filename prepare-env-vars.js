#!/usr/bin/env node

/**
 * Convert existing JSON dumps to Vercel env var format
 */

const fs = require('fs');
const path = require('path');

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

function main() {
  try {
    console.log('Processing JSON files...\n');

    const polygon = JSON.parse(fs.readFileSync(path.join(__dirname, 'polygon_full.json'), 'utf8'));
    const stellar = JSON.parse(fs.readFileSync(path.join(__dirname, 'stellar_full.json'), 'utf8'));
    const solana = JSON.parse(fs.readFileSync(path.join(__dirname, 'solana_full.json'), 'utf8'));

    const polygonData = rowsToFormat(polygon.result.rows, 'polygon');
    const stellarData = rowsToFormat(stellar.result.rows, 'stellar');
    const solanaData = rowsToFormat(solana.result.rows, 'solana');

    // Save to .env.local for testing
    const envContent = `POLYGON_DATA=${polygonData}\nSTELLAR_DATA=${stellarData}\nSOLANA_DATA=${solanaData}\n`;
    fs.writeFileSync(path.join(__dirname, '.env.local'), envContent);

    console.log('✓ Created .env.local\n');
    console.log('To update Vercel:\n');
    console.log('1. Go to https://vercel.com/dashboard/projects');
    console.log('2. Select non-usd-pegged-stablecoin-dashboard');
    console.log('3. Settings → Environment Variables');
    console.log('4. Remove old DUNE_API_KEY (no longer needed)');
    console.log('5. Add three new variables:\n');

    console.log(`vercel env add POLYGON_DATA`);
    console.log('# Paste content from below:');
    console.log(polygonData.substring(0, 100) + '...\n');

    console.log(`vercel env add STELLAR_DATA`);
    console.log('# Paste content from below:');
    console.log(stellarData.substring(0, 100) + '...\n');

    console.log(`vercel env add SOLANA_DATA`);
    console.log('# Paste content from below:');
    console.log(solanaData.substring(0, 100) + '...\n');

    console.log('Data lengths:');
    console.log(`  POLYGON_DATA: ${polygonData.length} chars`);
    console.log(`  STELLAR_DATA: ${stellarData.length} chars`);
    console.log(`  SOLANA_DATA: ${solanaData.length} chars`);

  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();
