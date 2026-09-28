import type { TableColumnConfig } from '../data/mockData';

function hasSecondaryMetricSourceChanged(
  oldColumn: Extract<TableColumnConfig, { type: 'text' | 'bar' }>,
  newColumn: Extract<TableColumnConfig, { type: 'text' | 'bar' }>
): boolean {
  const oldMetric = oldColumn.secondaryMetric;
  const newMetric = newColumn.secondaryMetric;

  return oldMetric?.enabled !== newMetric?.enabled
    || oldMetric?.sourceType !== newMetric?.sourceType
    || oldMetric?.comparisonField !== newMetric?.comparisonField
    || oldMetric?.comparisonFormula !== newMetric?.comparisonFormula
    || oldMetric?.calculationType !== newMetric?.calculationType;
}

export function hasDataStructureChanged(oldCols: TableColumnConfig[], newCols: TableColumnConfig[]): boolean {
  if (newCols.length !== oldCols.length) {
    return true;
  }

  const oldColumnsById = new Map(oldCols.map((column) => [column.id, column]));

  return newCols.some((newColumn) => {
    const oldColumn = oldColumnsById.get(newColumn.id);
    if (!oldColumn || oldColumn.type !== newColumn.type) {
      return true;
    }

    if (newColumn.type === 'text') {
      return oldColumn.type !== 'text'
        || oldColumn.valueField !== newColumn.valueField
        || hasSecondaryMetricSourceChanged(oldColumn, newColumn);
    }

    if (newColumn.type === 'bar') {
      return oldColumn.type !== 'bar'
        || oldColumn.valueField !== newColumn.valueField
        || oldColumn.maxField !== newColumn.maxField
        || hasSecondaryMetricSourceChanged(oldColumn, newColumn);
    }

    if (newColumn.type === 'dual-line') {
      return oldColumn.type !== 'dual-line'
        || oldColumn.dateField !== newColumn.dateField
        || oldColumn.primaryMetricField !== newColumn.primaryMetricField
        || oldColumn.secondaryMetricField !== newColumn.secondaryMetricField
        || oldColumn.compare !== newColumn.compare;
    }

    return oldColumn.type !== 'hierarchy'
      || oldColumn.level1Field !== newColumn.level1Field
      || oldColumn.level2Field !== newColumn.level2Field
      || oldColumn.level3Field !== newColumn.level3Field
      || oldColumn.level4Field !== newColumn.level4Field
      || oldColumn.level5Field !== newColumn.level5Field
      || oldColumn.level6Field !== newColumn.level6Field
      || oldColumn.levelCount !== newColumn.levelCount;
  });
}