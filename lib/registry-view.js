/**
 * HTML for the Registry tab. The tab is a catalog. It is not a volume chart.
 */

import { ACTIVATION_FACTS, MANUAL_QUERY_EDITS } from './activation-steps.js';

const STATUS_LABEL = {
  live: 'In published series',
  listed_in_repo_sql: 'In saved Arc SQL only',
  pending_dune: 'In replacement SQL',
  blocked_no_fx: 'No sourced USD rate',
  unsupported_chain: 'No dashboard chain',
};

const STATUS_CLASS = {
  live: 'status-live',
  listed_in_repo_sql: 'status-sql',
  pending_dune: 'status-pending',
  blocked_no_fx: 'status-blocked',
  unsupported_chain: 'status-unsupported',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decimalsText(value) {
  return value === 'n/a' ? 'n/a' : String(value);
}

function explorerLink(url, address) {
  const safeAddress = escapeHtml(address);
  if (typeof url === 'string' && /^https:\/\//.test(url)) {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${safeAddress}</a>`;
  }
  return safeAddress;
}

function queryLinks(ids) {
  if (!ids?.length) return '—';
  return ids.map(id => `<a href="https://dune.com/queries/${Number(id)}" target="_blank" rel="noopener noreferrer">${Number(id)}</a>`).join(', ');
}

function identityLine(row) {
  const parts = [];
  if (row.stellar?.asset_code) parts.push(`code ${row.stellar.asset_code}`);
  if (row.stellar?.issuer) parts.push(`issuer ${row.stellar.issuer}`);
  if (row.stellar?.sac_contract) parts.push(`SAC ${row.stellar.sac_contract}`);
  if (row.stellar?.contract) parts.push(`SEP-41 ${row.stellar.contract}`);
  if (row.currencyCodeHex) parts.push(`currency ${row.currencyCodeHex}`);
  if (!row.stellar && row.issuer) parts.push(`issuer ${row.issuer}`);
  if (row.token === 'EURITE') parts.push('product EURITE');
  return parts.length ? `<span class="sub">${escapeHtml(parts.join(' · '))}</span>` : '';
}

export function renderRegistryHtml(report) {
  const { summary, rows, exclusions, issues } = report;
  const filters = [
    ['all', 'All'],
    ['live', 'In series'],
    ['listed_in_repo_sql', 'Arc SQL'],
    ['pending_dune', 'Replacement SQL'],
    ['blocked_no_fx', 'No USD rate'],
    ['unsupported_chain', 'No chain'],
  ];
  const filterButtons = filters.map(([status, label], index) => (
    `<button type="button" class="tab${index === 0 ? ' on' : ''}" onclick="filterRegistry('${status}', this)">${label}</button>`
  )).join('');

  const body = rows.map(row => `<tr data-status="${row.status}">
    <td class="first">${escapeHtml(row.analyticsSymbol)}${row.token !== row.analyticsSymbol ? `<span class="sub">product ${escapeHtml(row.token)}</span>` : ''}</td>
    <td>${escapeHtml(row.network)}</td>
    <td>${escapeHtml(row.standard)}${identityLine(row)}</td>
    <td>${escapeHtml(decimalsText(row.decimals))}</td>
    <td>${explorerLink(row.explorer, row.address)}</td>
    <td><span class="status-pill ${STATUS_CLASS[row.status] || ''}">${escapeHtml(STATUS_LABEL[row.status] || row.status)}</span><span class="sub">${escapeHtml(row.detail)}</span></td>
    <td>${queryLinks(row.queryIds)}</td>
  </tr>`).join('');

  const exclusionItems = (exclusions || []).map(item => (
    `<li><strong>${escapeHtml(item.token)}</strong> on ${escapeHtml(item.network)}: ${escapeHtml(item.reason)}</li>`
  )).join('');

  const steps = MANUAL_QUERY_EDITS.map(step => {
    const ids = step.ids.map(id => escapeHtml(id)).join(', ');
    const action = step.mode === 'confirm-existing-sql'
      ? `Confirm ${escapeHtml(step.file)} matches query ${ids}. Symbols already listed: ${escapeHtml(step.symbols.join(', '))}.`
      : `Ad-hoc test ${escapeHtml(step.file)} before saving query ${ids}. Symbols: ${escapeHtml(step.symbols.join(', '))}.`;
    const note = step.note ? ` ${escapeHtml(step.note)}` : '';
    return `<li>${action}${note}</li>`;
  }).join('');

  const facts = ACTIVATION_FACTS.map(fact => `<li>${escapeHtml(fact)}</li>`).join('');
  const issueBlock = issues?.length
    ? `<p class="registry-warn">Registry file issues: ${escapeHtml(issues.join('; '))}</p>`
    : '';

  return `<p class="coverage-note registry-note">Verified catalog, not tracked volume. ${escapeHtml(summary.sentence)} These rows are not added to the charts, the hero total, or <code>data.json</code>.</p>
${issueBlock}
<div class="ctrl registry-ctrl"><div class="tabs">${filterButtons}</div></div>
<div class="registry-table-wrap">
  <table>
    <thead><tr><th>Series code</th><th>Network</th><th>Standard</th><th>Decimals</th><th>Address</th><th>Catalog status</th><th>Existing Dune id</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>
<section class="registry-steps">
  <h2>Manual Dune activation</h2>
  <p>The refresh job still executes only the seven existing networks. Saving a Dune query is a separate step, and the next refresh spends credits only after that save. This page does not start that execution.</p>
  <ol>${steps}</ol>
  <ul>${facts}</ul>
  <h2>Left out of the registry</h2>
  <ul>${exclusionItems}</ul>
</section>`;
}
