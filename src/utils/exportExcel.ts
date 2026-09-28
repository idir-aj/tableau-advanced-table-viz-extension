import type { TableColumnConfig, TableRowData } from '../data/mockData';
import { formatSecondaryMetricLabel } from './secondaryMetric';

function escapeCsvValue(value: unknown): string {
  const raw = String(value ?? '');
  const trimmedStart = raw.trimStart();

  // Neutralize potential spreadsheet formulas when opening CSV in Excel/Sheets.
  const safe = /^[=+\-@]/.test(trimmedStart) ? `'${raw}` : raw;
  return `"${safe.replace(/\"/g, '""')}"`;
}

function getExportScaleInfo(value: number, scale: 'auto' | 'none' | 'k' | 'm' | undefined): { divisor: number; suffix: string } {
  if (scale === 'k') {
    return { divisor: 1_000, suffix: 'K' };
  }
  if (scale === 'm') {
    return { divisor: 1_000_000, suffix: 'M' };
  }
  if (scale === 'auto') {
    const absoluteValue = Math.abs(value);
    if (absoluteValue >= 1_000_000) {
      return { divisor: 1_000_000, suffix: 'M' };
    }
    if (absoluteValue >= 1_000) {
      return { divisor: 1_000, suffix: 'K' };
    }
  }
  return { divisor: 1, suffix: '' };
}

function getSecondaryMetricSuffix(
  column: Extract<TableColumnConfig, { type: 'text' }> | Extract<TableColumnConfig, { type: 'bar' }>,
  row: TableRowData,
  currentValue: number
): string {
  const config = column.secondaryMetric;
  if (!config?.enabled) {
    return '';
  }

  const rawDelta = row.values[`__delta__${column.id}`];
  const delta = typeof rawDelta === 'number' && Number.isFinite(rawDelta) ? rawDelta : undefined;
  const { divisor, suffix } = getExportScaleInfo(currentValue, column.scale);
  const label = formatSecondaryMetricLabel(delta, config.calculationType, {
    decimals: config.decimals,
    formatStyle: column.formatStyle,
    currency: column.currency,
    scaleDivisor: divisor,
    scaleSuffix: suffix
  });

  return ` (${label})`;
}

export function exportToExcel(
  rows: TableRowData[],
  columns: TableColumnConfig[],
  fileName = 'Export_Data.csv'
): void {
  // 1. Filtrer les colonnes à exporter (Texte, Barre et Hiérarchie. Exclusion de dual-line)
  const exportableColumns = columns.filter((col) => col.type !== 'dual-line');

  // 2. Déterminer la profondeur maximale de la hiérarchie
  let maxHierarchyDepth = 1;
  const hierarchyCol = columns.find(
    (col): col is Extract<TableColumnConfig, { type: 'hierarchy' }> => col.type === 'hierarchy'
  );

  if (hierarchyCol) {
    maxHierarchyDepth = Math.max(1, Math.min(6, hierarchyCol.levelCount ?? 3));
  }

  // 3. Construire la ligne d'en-tête (séparateur point-virgule pour Excel FR)
  const headers: string[] = [];
  exportableColumns.forEach((col) => {
    if (col.type === 'hierarchy') {
      for (let depth = 1; depth <= maxHierarchyDepth; depth++) {
        headers.push(escapeCsvValue(`Level ${depth}`));
      }
    } else {
      headers.push(escapeCsvValue(col.header));
    }
  });

  const csvLines: string[] = [headers.join(';')];

  // 4. Transformer les lignes de données
  rows.forEach((row) => {
    const lineValues: string[] = [];

    exportableColumns.forEach((col) => {
      if (col.type === 'hierarchy') {
        const pathSegments = String(row.id).split('||');
        for (let depth = 0; depth < maxHierarchyDepth; depth++) {
          const val = pathSegments[depth] ?? '';
          lineValues.push(escapeCsvValue(val));
        }
      } else if (col.type === 'text') {
        const rawVal = row.values[col.valueField];
        const displayVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';
        const numericVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        const secondarySuffix = Number.isFinite(numericVal) ? getSecondaryMetricSuffix(col, row, numericVal) : '';
        lineValues.push(escapeCsvValue(`${displayVal}${secondarySuffix}`));
      } else if (col.type === 'bar') {
        const barKey = `__bar__${col.id}__value`;
        const rawVal = row.values[barKey] ?? row.values[col.valueField];
        const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal) || 0;
        // Formatage numérique standard
        const secondarySuffix = getSecondaryMetricSuffix(col, row, numVal);
        lineValues.push(escapeCsvValue(`${String(numVal).replace('.', ',')}${secondarySuffix}`));
      }
    });

    csvLines.push(lineValues.join(';'));
  });

// 5. Génération et déclenchement du téléchargement
  const csvContent = '\uFEFF' + csvLines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // Utilisation du mode navigateur / fallback MS Blob
  if (window.navigator && (window.navigator as unknown as { msSaveOrOpenBlob?: Function }).msSaveOrOpenBlob) {
    (window.navigator as unknown as { msSaveOrOpenBlob: Function }).msSaveOrOpenBlob(blob, fileName);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  // Nettoyage différé pour laisser le temps à l'Iframe Tableau d'exécuter l'action
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 500);
}