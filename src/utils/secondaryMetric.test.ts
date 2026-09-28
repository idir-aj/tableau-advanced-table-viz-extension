import { describe, expect, it } from 'vitest';
import {
  computeSecondaryMetricValue,
  formatSecondaryMetricLabel,
  getSecondaryMetricColor,
  getSecondaryMetricTone
} from './secondaryMetric';

describe('computeSecondaryMetricValue', () => {
  it('computes PERCENTAGE as (N - N-1) / abs(N-1) * 100', () => {
    expect(computeSecondaryMetricValue(150, 100, 'PERCENTAGE')).toBeCloseTo(50);
    expect(computeSecondaryMetricValue(50, -100, 'PERCENTAGE')).toBeCloseTo(150);
  });

  it('computes POINTS as (N - N-1) * 100', () => {
    expect(computeSecondaryMetricValue(0.15, 0.12, 'POINTS')).toBeCloseTo(3);
  });

  it('computes ABSOLUTE as N - N-1', () => {
    expect(computeSecondaryMetricValue(15.3, 14.1, 'ABSOLUTE')).toBeCloseTo(1.2);
  });

  it('returns undefined when comparison value is 0 for PERCENTAGE', () => {
    expect(computeSecondaryMetricValue(100, 0, 'PERCENTAGE')).toBeUndefined();
  });

  it('returns undefined when comparison value is missing', () => {
    expect(computeSecondaryMetricValue(100, undefined, 'PERCENTAGE')).toBeUndefined();
    expect(computeSecondaryMetricValue(100, undefined, 'ABSOLUTE')).toBeUndefined();
  });

  it('never returns NaN or Infinity', () => {
    const result = computeSecondaryMetricValue(100, 0, 'PERCENTAGE');
    expect(result === undefined || Number.isFinite(result)).toBe(true);
  });
});

describe('getSecondaryMetricColor', () => {
  it('applies auto mode: green for positive, red for negative, gray for zero', () => {
    expect(getSecondaryMetricColor(5, 'auto')).toBe('#166534');
    expect(getSecondaryMetricColor(-5, 'auto')).toBe('#991b1b');
    expect(getSecondaryMetricColor(0, 'auto')).toBe('#6B7280');
  });

  it('applies inverted mode: red for positive, green for negative', () => {
    expect(getSecondaryMetricColor(5, 'inverted')).toBe('#991b1b');
    expect(getSecondaryMetricColor(-5, 'inverted')).toBe('#166534');
  });

  it('returns no text color in none mode and a neutral color for an unavailable delta', () => {
    expect(getSecondaryMetricColor(5, 'none')).toBe('');
    expect(getSecondaryMetricColor(undefined, 'auto')).toBe('#6B7280');
  });

  it('maps values to positive, negative, neutral, or inherited chip tones', () => {
    expect(getSecondaryMetricTone(1, 'auto')).toBe('positive');
    expect(getSecondaryMetricTone(-1, 'auto')).toBe('negative');
    expect(getSecondaryMetricTone(0, 'auto')).toBe('neutral');
    expect(getSecondaryMetricTone(undefined, 'auto')).toBe('neutral');
    expect(getSecondaryMetricTone(1, 'inverted')).toBe('negative');
    expect(getSecondaryMetricTone(-1, 'inverted')).toBe('positive');
    expect(getSecondaryMetricTone(1, 'none')).toBe('inherit');
  });
});

describe('formatSecondaryMetricLabel', () => {
  it('formats PERCENTAGE with a leading plus sign only when positive', () => {
    expect(formatSecondaryMetricLabel(7.8, 'PERCENTAGE', { decimals: 1 })).toBe('+7,8 %');
    expect(formatSecondaryMetricLabel(-7.8, 'PERCENTAGE', { decimals: 1 })).toContain('7,8 %');
    expect(formatSecondaryMetricLabel(0, 'PERCENTAGE', { decimals: 1 })).toBe('0,0 %');
  });

  it('formats POINTS with the pts unit', () => {
    expect(formatSecondaryMetricLabel(3, 'POINTS', { decimals: 1 })).toBe('+3,0 pts');
  });

  it('formats ABSOLUTE using the primary currency/scale', () => {
    expect(
      formatSecondaryMetricLabel(1200000, 'ABSOLUTE', {
        decimals: 1,
        formatStyle: 'currency',
        currency: 'EUR',
        scaleDivisor: 1_000_000,
        scaleSuffix: 'M'
      })
    ).toBe('+1,2 M€');
  });

  it('returns N/A when the delta is unavailable', () => {
    expect(formatSecondaryMetricLabel(undefined, 'PERCENTAGE', { decimals: 1 })).toBe('N/A');
  });
});
