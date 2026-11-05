/**
 * Build the 1200×630 social image from data.json.
 * Totals are labeled as tracked volume and the image says coverage is not exhaustive.
 *
 *   node generate-og.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { coverageFromNetworks, earliestIso, formatUsdCompact, utcDay } from './lib/series.js';

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ogSvg(payload) {
  const data = payload?.data || {};
  const coverage = coverageFromNetworks(data);
  const chains = Object.entries(data)
    .filter(([, pipe]) => String(pipe || '').trim())
    .map(([name]) => name);
  const total = formatUsdCompact(coverage.volume);
  const execution = earliestIso(
    Object.values(payload?.executions || {}).map(item => item?.execution_ended_at),
  );
  const through = execution ? `Dune run ${utcDay(execution)}` : 'Refreshed about every 2 days';
  const chainLine = chains.map(name => name.toUpperCase()).join('   ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0A0B0F"/>
  <rect width="10" height="${HEIGHT}" fill="#10B981"/>
  <circle cx="78" cy="92" r="8" fill="#10B981"/>
  <text x="98" y="100" fill="#9CA3AF" font-family="Liberation Sans, sans-serif" font-size="22" font-weight="700" letter-spacing="2">NON-USD STABLECOINS</text>
  <text x="64" y="250" fill="#F3F4F6" font-family="Liberation Sans, sans-serif" font-size="92" font-weight="700">${escapeXml(total)}</text>
  <text x="68" y="310" fill="#34D399" font-family="Liberation Sans, sans-serif" font-size="28" font-weight="700">Tracked non-USD stablecoin volume · 365d</text>
  <text x="68" y="390" fill="#9CA3AF" font-family="Liberation Sans, sans-serif" font-size="22">${escapeXml(chainLine)}</text>
  <text x="68" y="470" fill="#F3F4F6" font-family="Liberation Sans, sans-serif" font-size="26">${coverage.tokens} tracked tokens · ${coverage.chains} chains</text>
  <text x="68" y="514" fill="#9CA3AF" font-family="Liberation Sans, sans-serif" font-size="22">Coverage is not exhaustive — more tokens and chains will be added</text>
  <text x="68" y="575" fill="#6B7280" font-family="Liberation Sans, sans-serif" font-size="20">${escapeXml(through)} · analytics.solosolver.xyz</text>
</svg>`;
}

export async function generateOg(dataPath = 'data.json', outPath = 'og.png') {
  const payload = JSON.parse(readFileSync(dataPath, 'utf8'));
  const svg = ogSvg(payload);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Liberation Sans',
    },
  });
  const png = resvg.render().asPng();
  writeFileSync(outPath, png);
  return outPath;
}

const isDirect = process.argv[1] && process.argv[1].endsWith('generate-og.js');
if (isDirect) {
  generateOg().then(path => {
    console.log(`Wrote ${path}`);
  }).catch(error => {
    console.error('ERROR:', error.message);
    process.exit(1);
  });
}
