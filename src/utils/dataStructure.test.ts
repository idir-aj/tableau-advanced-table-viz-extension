import { describe, expect, it } from 'vitest';
import type { BarColumnConfig, SecondaryMetricConfig, TextColumnConfig } from '../data/mockData';
import { hasDataStructureChanged } from './dataStructure';

const baseSecondaryMetric: SecondaryMetricConfig = {
  enabled: false,
  sourceType: 'field',
  comparisonField: 'Revenue N-1',
  comparisonFormula: 'Revenue_N1',
  calculationType: 'PERCENTAGE',
  colorMode: 'auto',
  decimals: 1
};

const textColumn: TextColumnConfig = {
  id: 'text-1',
  header: 'Revenue',
  type: 'text',
  valueField: 'Revenue'
};

const barColumn: BarColumnConfig = {
  id: 'bar-1',
  header: 'Revenue bar',
  type: 'bar',
  valueField: 'Revenue',
  maxField: 'Revenue max'
};

function withSecondaryMetric<T extends TextColumnConfig | BarColumnConfig>(
  column: T,
  patch: Partial<SecondaryMetricConfig>
): T {
  return { ...column, secondaryMetric: { ...baseSecondaryMetric, ...patch } };
}

describe('hasDataStructureChanged secondary metric handling', () => {
  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('detects first activation for %s columns', (_label, column) => {
    const nextColumn = withSecondaryMetric(column, { enabled: true });
    expect(hasDataStructureChanged([column], [nextColumn])).toBe(true);
  });

  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('detects disabling for %s columns', (_label, column) => {
    const previousColumn = withSecondaryMetric(column, { enabled: true });
    expect(hasDataStructureChanged([previousColumn], [column])).toBe(true);
  });

  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('detects comparison field changes for %s columns', (_label, column) => {
    const previousColumn = withSecondaryMetric(column, { enabled: true, comparisonField: 'Revenue N-1' });
    const nextColumn = withSecondaryMetric(column, { enabled: true, comparisonField: 'Revenue Prior Year' });
    expect(hasDataStructureChanged([previousColumn], [nextColumn])).toBe(true);
  });

  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('detects switching source type for %s columns', (_label, column) => {
    const previousColumn = withSecondaryMetric(column, { enabled: true, sourceType: 'field' });
    const nextColumn = withSecondaryMetric(column, { enabled: true, sourceType: 'formula' });
    expect(hasDataStructureChanged([previousColumn], [nextColumn])).toBe(true);
  });

  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('detects comparison formula changes for %s columns', (_label, column) => {
    const previousColumn = withSecondaryMetric(column, { enabled: true, sourceType: 'formula', comparisonFormula: 'Revenue_N1' });
    const nextColumn = withSecondaryMetric(column, { enabled: true, sourceType: 'formula', comparisonFormula: 'Revenue_LastYear' });
    expect(hasDataStructureChanged([previousColumn], [nextColumn])).toBe(true);
  });

  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('detects calculation type changes for %s columns', (_label, column) => {
    const previousColumn = withSecondaryMetric(column, { enabled: true, calculationType: 'PERCENTAGE' });
    const nextColumn = withSecondaryMetric(column, { enabled: true, calculationType: 'POINTS' });
    expect(hasDataStructureChanged([previousColumn], [nextColumn])).toBe(true);
  });

  it.each([
    ['Text', textColumn],
    ['Bar', barColumn]
  ])('does not treat display-only settings as data changes for %s columns', (_label, column) => {
    const previousColumn = withSecondaryMetric(column, { enabled: true, colorMode: 'auto', decimals: 1 });
    const nextColumn = withSecondaryMetric(column, { enabled: true, colorMode: 'inverted', decimals: 3 });
    expect(hasDataStructureChanged([previousColumn], [nextColumn])).toBe(false);
  });
});
