/**
 * View filter for the published series. It does not change data.json.
 * Default is included. without=A7A5 drops rows whose token label is exactly A7A5.
 */

export const A7A5_SYMBOL = 'A7A5';
export const WITHOUT_PARAM = 'without';

export function withoutA7A5Requested(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return params.get(WITHOUT_PARAM) === A7A5_SYMBOL;
}

export function searchWithWithoutParam(search, exclude) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (exclude) params.set(WITHOUT_PARAM, A7A5_SYMBOL);
  else params.delete(WITHOUT_PARAM);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Drop day-rows that only contained A7A5. Other token labels stay, including near-misses. */
export function dropA7A5Items(rows, exclude) {
  if (!exclude) return rows;
  return (rows || [])
    .map(row => ({
      ...row,
      items: (row.items || []).filter(item => item.t !== A7A5_SYMBOL),
    }))
    .filter(row => row.items.length > 0);
}

export function parseTrackedRows(data, executions) {
  const rows = [];
  for (const [network, block] of Object.entries(data || {})) {
    const iso = executions?.[network]?.execution_ended_at;
    const cutoff = typeof iso === 'string' ? iso.slice(0, 10) : null;
    for (const line of String(block || '').split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      const day = parts[0];
      if (cutoff && day >= cutoff) continue;
      const items = [];
      for (let i = 1; i + 2 < parts.length; i += 3) {
        const token = parts[i];
        if (!token) continue;
        items.push({
          t: token,
          tx: parseInt(parts[i + 1], 10) || 0,
          v: parseFloat(parts[i + 2]) || 0,
        });
      }
      if (items.length) rows.push({ network, d: day, items });
    }
  }
  return rows;
}

export function a7a5VolumeShare(rows) {
  let total = 0;
  let volume = 0;
  const chains = new Set();
  for (const row of rows || []) {
    for (const item of row.items || []) {
      const value = Number(item.v) || 0;
      total += value;
      if (item.t === A7A5_SYMBOL) {
        volume += value;
        if (row.network) chains.add(row.network);
      }
    }
  }
  return {
    symbol: A7A5_SYMBOL,
    volume,
    total,
    share: total > 0 ? volume / total : 0,
    chains: [...chains],
  };
}
