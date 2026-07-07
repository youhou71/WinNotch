/**
 * Libellé de récence court et partagé par les deux sources de la search bar
 * (`vs` solutions et `/` workspaces VS Code). Sort une chaîne « il y a X … »
 * cohérente avec les libellés du prototype.
 */
export function relativeLabel(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  const w = Math.floor(d / 7);
  if (w < 5) return `il y a ${w} sem`;
  const mo = Math.floor(d / 30);
  return `il y a ${mo} mois`;
}
