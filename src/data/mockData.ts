export type TableCellValue = string | number | boolean | string[] | number[];

export interface TableRowData {
  id: string;
  tupleId?: number;
  parentId?: string;
  label: string;
  level: number;
  hasChildren?: boolean;
  values: Record<string, TableCellValue | undefined>;
}

export type ConditionOperator =
  | 'between'
  | 'not-between'
  | 'equal'
  | 'not-equal'
  | 'greater'
  | 'less'
  | 'greater-equal'
  | 'less-equal';

export interface BarConditionalRule {
  id: string;
  operator: ConditionOperator;
  value?: number;
  min?: number;
  max?: number;
  barColor?: string;
  textColor?: string;
}

export interface TextConditionalRule {
  id: string;
  operator: ConditionOperator;
  value?: number;
  min?: number;
  max?: number;
  textColor?: string;
  shading?: string;
}

export type SecondaryMetricSourceType = 'field' | 'formula';
export type SecondaryMetricCalculationType = 'PERCENTAGE' | 'POINTS' | 'ABSOLUTE';
export type SecondaryMetricColorMode = 'auto' | 'inverted' | 'none';

export interface SecondaryMetricConfig {
  enabled: boolean;
  sourceType: SecondaryMetricSourceType;
  comparisonField?: string;
  comparisonFormula?: string;
  calculationType: SecondaryMetricCalculationType;
  colorMode: SecondaryMetricColorMode;
  decimals: number;
}

export interface TextColumnConfig {
  id: string;
  header: string;
  type: 'text';
  valueField: string;
  alignment?: 'left' | 'center' | 'right';
  decimals?: number;
  formatStyle?: 'number' | 'currency' | 'percent';
  currency?: 'EUR' | 'USD' | 'GBP';
  scale?: 'auto' | 'none' | 'k' | 'm';
  suffix?: string;
  conditions?: TextConditionalRule[];
  secondaryMetric?: SecondaryMetricConfig;
}

export type BarScaleMode = 'per-level' | 'relative-to-parent' | 'whole-table';

export interface BarColumnConfig {
  id: string;
  header: string;
  type: 'bar';
  valueField: string;
  maxField?: string;
  barColor?: string;
  barScale?: BarScaleMode;
  decimals?: number;
  formatStyle?: 'number' | 'currency' | 'percent';
  currency?: 'EUR' | 'USD' | 'GBP';
  scale?: 'auto' | 'none' | 'k' | 'm';
  conditions?: BarConditionalRule[];
  secondaryMetric?: SecondaryMetricConfig;
}

export interface DualLineColumnConfig {
  id: string;
  header: string;
  type: 'dual-line';
  dateField: string;
  primaryMetricField: string;
  secondaryMetricField: string;
  compare?: boolean;
  label2?: string;
  line1Color?: string;
  line2Color?: string;
}

export type HierarchyExpandTo = 'level-1' | 'level-2' | 'level-3' | 'all';

export interface HierarchyColumnConfig {
  id: string;
  header: string;
  type: 'hierarchy';
  level1Field: string;
  level2Field?: string;
  level3Field?: string;
  level4Field?: string;
  level5Field?: string;
  level6Field?: string;
  levelCount?: 1 | 2 | 3 | 4 | 5 | 6;
  expandTo?: HierarchyExpandTo;
}

export interface BaseColumnConfig {
  id: string;
  header: string;
  fieldName: string;
  customFormula?: string; // Optional custom formula for calculated fields
}

export type TableColumnConfig = TextColumnConfig | BarColumnConfig | DualLineColumnConfig | HierarchyColumnConfig;

export const defaultTableColumns: TableColumnConfig[] = [
  {
    id: 'metric1',
    header: 'Metric 1',
    type: 'text',
    valueField: 'metric1',
    alignment: 'right',
    decimals: 0,
    formatStyle: 'currency',
    currency: 'EUR',
    scale: 'none',
    suffix: ''
  },
  {
    id: 'metric2',
    header: 'Metric 2',
    type: 'bar',
    valueField: 'metric2',
    maxField: 'metric2max',
    barColor: '#3643BA',
    decimals: 0,
    formatStyle: 'number',
    currency: 'EUR',
    scale: 'auto'
  },
  {
    id: 'metric3',
    header: 'Metric 3 (N vs N-1)',
    type: 'dual-line',
    dateField: 'trenddates',
    primaryMetricField: 'trendn',
    secondaryMetricField: 'trendn1',
    line1Color: '#3643BA',
    line2Color: '#D9DDE1'
  },
  {
    id: 'metric4',
    header: 'Metric 4',
    type: 'text',
    valueField: 'metric4',
    alignment: 'left',
    decimals: 0,
    formatStyle: 'number',
    currency: 'EUR',
    scale: 'none'
  }
];

const mockDates = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'];

export const mockTableData: TableRowData[] = [
  {
    id: 'dep-a',
    label: 'Département A',
    level: 0,
    hasChildren: false,
    values: {
      metric1: 467,
      metric2: 7890,
      metric2max: 10000,
      trenddates: mockDates,
      trendn: [25, 20, 22, 21, 18, 15, 12, 8],
      trendn1: [12, 18, 20, 16, 15, 14, 10, 8],
      metric4: '89%'
    }
  },
  {
    id: 'dep-b',
    label: 'Département B',
    level: 0,
    hasChildren: false,
    values: {
      metric1: 456,
      metric2: 6800,
      metric2max: 10000,
      trenddates: mockDates,
      trendn: [10, 15, 12, 18, 22, 24, 23, 20],
      trendn1: [18, 20, 15, 12, 10, 12, 15, 14],
      metric4: '5%'
    }
  },
  {
    id: 'dep-c',
    label: 'Département C',
    level: 0,
    hasChildren: true,
    values: {
      metric1: 1000,
      metric2: 500,
      metric2max: 10000,
      trenddates: mockDates,
      trendn: [12, 22, 18, 24, 21, 19, 15, 12],
      trendn1: [8, 12, 15, 18, 20, 22, 18, 14],
      metric4: ''
    }
  },
  {
    id: 'fam-c1',
    parentId: 'dep-c',
    label: 'Famille C1',
    level: 1,
    hasChildren: false,
    values: {
      metric1: 300,
      metric2: 6000,
      metric2max: 10000,
      trenddates: mockDates,
      trendn: [10, 25, 18, 26, 20, 22, 18, 16],
      trendn1: [6, 10, 14, 16, 18, 15, 12, 10],
      metric4: ''
    }
  },
  {
    id: 'fam-c2',
    parentId: 'dep-c',
    label: 'Famille C2',
    level: 1,
    hasChildren: false,
    values: {
      metric1: 700,
      metric2: 2500,
      metric2max: 10000,
      trenddates: mockDates,
      trendn: [12, 20, 18, 19, 18, 17, 16, 14],
      trendn1: [8, 12, 15, 17, 16, 14, 12, 10],
      metric4: ''
    }
  },
  {
    id: 'dep-d',
    label: 'Département D',
    level: 0,
    hasChildren: false,
    values: {
      metric1: 130,
      metric2: 2500,
      metric2max: 10000,
      trenddates: mockDates,
      trendn: [8, 12, 10, 18, 15, 22, 24, 28],
      trendn1: [15, 12, 18, 20, 22, 20, 18, 16],
      metric4: ''
    }
  }
];