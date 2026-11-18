/**
 * Shared shaping for Dune rows → the pipe-delimited series in data.json.
 * The dashboard drops the same partial day in the browser (index.html cutoffDayFor).
 */

export const QUERIES = {
  polygon: [6614895, 6621899],
  stellar: [6712377],
  solana: [6689171],
  tron: [6695880],
  plasma: [6663259],
  bsc: [8748306],
  arc: [8924650],
};

export const COVERAGE_NOTE =
  'Figures include only the non-USD stablecoins currently tracked. Coverage is not exhaustive; more tokens and chains will be added.';

// Used only when a query omits transfer_volume_usd. Rates are USD per 1 unit.
// EUR/CHF/BRL/JPY/TRY and Arc currencies: ECB reference rates of 2026-10-09.
// A7A5, PHT, KGST: legacy values, not re-based.
// EURQ and EURI share the existing EUR rate. They are not live series by themselves.
// BRMB (CNY) and DDSC (AED) have no rate here.
// IDRX uses the static 0.000061 already written for XIDR, IDDR, and IDRT in
// sql/replacements/6621899_polygon.sql. It is not a live IDR feed.
export const FX_FALLBACK = {
  EURC: 1.1206, EUROe: 1.1206, VEUR: 1.1206, EURCV: 1.1206, EURQ: 1.1206, EURI: 1.1206,
  VCHF: 1.20326, BRZ: 0.1998, GYEN: 0.00631894,
  A7A5: 0.011, PHT: 0.017,
  IDRX: 0.000061,
  EUROP: 1.1206, TRYB: 0.0203364,
  KGST: 0.0114,
  EURAU: 1.1206, GBPA: 1.32204, MXNB: 0.0549448, AUDD: 0.698106, AUDF: 0.698106,
  ZARsc: 0.0604847,
  CADD: 0.702923, QCAD: 0.702923, KRW1: 0.000745442, SEKAU: 0.100345, ZARU: 0.0604847,
  CHFAU: 1.20326, BRLA: 0.1998, JPYC: 0.00631894,
};

/** Dune timestamps can carry nanoseconds, which Date cannot parse. */
export function normalizeIso(iso) {
  if (iso == null) return null;
  const s = String(iso).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?((?:Z|[+-]\d{2}:?\d{2})?)$/);
  if (!m) return s;
  const frac = (m[2] || '0').slice(0, 3).padEnd(3, '0');
  return `${m[1]}.${frac}${m[3] || 'Z'}`;
}

/** Calendar day (UTC) of a Dune timestamp, or null. */
export function utcDay(iso) {
  if (iso == null) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function rowDay(row) {
  const raw = row?.date;
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  const day = String(raw).split(' ')[0].slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function tokenCode(token) {
  if (token == null) return '';
  const text = String(token).trim();
  if (!text) return '';
  return text.includes(' - ') ? text.split(' - ').pop().trim() : text;
}

/**
 * Drop the incomplete execution day (and anything after it).
 * A query that finishes on 2026-11-05 still includes a partial 2026-11-05,
 * which shows up as a fake cliff at the right edge of the chart.
 */
export function dropPartialDays(rows, executionEndedAt) {
  const cut = utcDay(executionEndedAt);
  if (!cut) return rows.slice();
  return rows.filter(row => {
    const day = rowDay(row);
    return !day || day < cut;
  });
}

export function volumeUsd(row, code) {
  let volume = parseFloat(row.transfer_volume_usd || 0);
  if (!volume) {
    const nativeVol = parseFloat(row.transfer_volume || row.transfer_volume_native || 0);
    const fx = FX_FALLBACK[code];
    if (fx && nativeVol > 0) {
      volume = nativeVol * fx;
      return { volume, usedFallback: true, fx };
    }
  }
  return { volume: volume || 0, usedFallback: false, fx: null };
}

/** Pipe rows, newest day first. Duplicate token/day pairs are summed. */
export function rowsToPipe(rows, network, log = () => {}) {
  const byDate = new Map();

  for (const row of rows) {
    const date = rowDay(row);
    const code = tokenCode(row.token);
    if (!date || !code) continue;

    const tx = parseInt(row.daily_transactions, 10) || 0;
    const { volume, usedFallback, fx } = volumeUsd(row, code);
    if (usedFallback) {
      log(`  ⚠ ${network}/${code}: USD column empty, using fallback FX=${fx}`);
    }

    if (!byDate.has(date)) byDate.set(date, new Map());
    const day = byDate.get(date);
    const prev = day.get(code) || { tx: 0, volume: 0 };
    day.set(code, { tx: prev.tx + tx, volume: prev.volume + volume });
  }

  const dates = [...byDate.keys()].sort().reverse();
  return dates.map(date => {
    const parts = [date];
    for (const [code, agg] of byDate.get(date)) {
      parts.push(code, String(agg.tx), agg.volume.toFixed(2));
    }
    return parts.join('|');
  }).join('\n');
}

/** Oldest ISO timestamp, so a network is only as fresh as its stalest query. */
export function earliestIso(isos) {
  const usable = isos
    .map(iso => ({ iso, t: Date.parse(normalizeIso(iso)) }))
    .filter(item => item.iso && !Number.isNaN(item.t))
    .sort((a, b) => a.t - b.t);
  return usable.length ? usable[0].iso : null;
}

export function summarizePipe(pipe) {
  const tokens = new Set();
  let volume = 0;
  let tx = 0;
  let through = '';
  let from = '';
  const lines = String(pipe || '').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const parts = line.split('|');
    const day = parts[0];
    if (day && (!from || day < from)) from = day;
    if (day && day > through) through = day;
    for (let i = 1; i + 2 < parts.length; i += 3) {
      if (parts[i]) tokens.add(parts[i]);
      tx += parseInt(parts[i + 1], 10) || 0;
      volume += parseFloat(parts[i + 2]) || 0;
    }
  }
  return { tokens, volume, tx, through, from, days: lines.length };
}

export function coverageFromNetworks(dataMap) {
  const tokens = new Set();
  let chains = 0;
  let volume = 0;
  for (const pipe of Object.values(dataMap || {})) {
    const summary = summarizePipe(pipe);
    if (summary.days) chains += 1;
    summary.tokens.forEach(token => tokens.add(token));
    volume += summary.volume;
  }
  return {
    exhaustive: false,
    note: COVERAGE_NOTE,
    tokens: tokens.size,
    chains,
    volume,
  };
}

export function formatUsdCompact(n) {
  const abs = Math.abs(n || 0);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
