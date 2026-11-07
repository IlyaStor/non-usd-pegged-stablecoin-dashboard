import { buildCatalogReport } from './lib/token-catalog.js';
import { renderRegistryHtml } from './lib/registry-view.js';

export async function loadCatalogView({ data, executions }) {
  const registryRes = await fetch('/registry/verified-additions.json', { cache: 'no-store' });
  if (!registryRes.ok) throw new Error(`registry ${registryRes.status}`);
  const registry = await registryRes.json();
  const sqlRes = await fetch('/sql/arc_nonusd_transfers.sql', { cache: 'no-store' });
  if (!sqlRes.ok) throw new Error(`Arc SQL ${sqlRes.status}`);
  const arcSql = await sqlRes.text();
  const report = buildCatalogReport({ registry, data, executions, arcSql });
  return { report, html: renderRegistryHtml(report) };
}
