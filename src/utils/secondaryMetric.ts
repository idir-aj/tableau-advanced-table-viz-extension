import type { SecondaryMetricCalculationType, SecondaryMetricColorMode } from '../data/mockData';

// (Sum(N) - Sum(N-1)) / abs(Sum(N-1)) * 100 | (Sum(N) - Sum(N-1)) * 100 | Sum(N) - Sum(N-1)
export function computeSecondaryMetricValue(
  currentValue: number,
  comparisonValue: number | undefined,
  calculationType: SecondaryMetricCalculationType
): number | undefined {
  if (!Number.isFinite(currentValue) || comparisonValue === undefined || !Number.isFinite(comparisonValue)) {
    return undefined;
  }

  if (calculationType === 'PERCENTAGE') {
    if (comparisonValue === 0) {
      return undefined;
    }
    return ((currentValue - comparisonValue) / Math.abs(comparisonValue)) * 100;
  }

  if (calculationType === 'POINTS') {
    return (currentValue - comparisonValue) * 100;
  }

  return currentValue - comparisonValue;
}

export type SecondaryMetricTone = 'positive' | 'negative' | 'neutral' | 'inherit';

export function getSecondaryMetricTone(
  delta: number | undefined,
  colorMode: SecondaryMetricColorMode
): SecondaryMetricTone {
  if (colorMode === 'none') {
    return 'inherit';
  }

  if (delta === undefined || !Number.isFinite(delta) || delta === 0) {
    return 'neutral';
  }

  const isPositive = colorMode === 'inverted' ? delta < 0 : delta > 0;
  return isPositive ? 'positive' : 'negative';
}

export function getSecondaryMetricColor(delta: number | undefined, colorMode: SecondaryMetricColorMode): string {
  const tone = getSecondaryMetricTone(delta, colorMode);
  if (tone === 'positive') return '#166534';
  if (tone === 'negative') return '#991b1b';
  if (tone === 'neutral') return '#6B7280';
  return '';
}

interface AbsoluteDeltaFormatOptions {
  decimals?: number;
  formatStyle?: 'number' | 'currency' | 'percent';
  currency?: 'EUR' | 'USD' | 'GBP';
  scaleDivisor?: number;
  scaleSuffix?: string;
}

function getLocaleForCurrency(currency: 'EUR' | 'USD' | 'GBP'): string {
  if (currency === 'USD') return 'en-US';
  if (currency === 'GBP') return 'en-GB';
  return 'fr-FR';
}

function formatAbsoluteDelta(delta: number, options: AbsoluteDeltaFormatOptions): string {
  const decimals = Math.max(0, Math.min(6, options.decimals ?? 0));
  const currency = options.currency ?? 'EUR';
  const locale = getLocaleForCurrency(currency);
  const divisor = options.scaleDivisor && options.scaleDivisor > 0 ? options.scaleDivisor : 1;
  const suffix = options.scaleSuffix ?? '';
  const scaledValue = delta / divisor;

  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  const formattedNumber = formatter.format(scaledValue);
  const sign = delta > 0 ? '+' : '';

  if (options.formatStyle === 'currency') {
    if (currency === 'USD') {
      return `${sign}$${formattedNumber}${suffix}`;
    }
    if (currency === 'GBP') {
      return `${sign}£${formattedNumber}${suffix}`;
    }
    return suffix ? `${sign}${formattedNumber} ${suffix}€` : `${sign}${formattedNumber} €`;
  }

  return `${sign}${formattedNumber}${suffix ? ` ${suffix}` : ''}`;
}

export function formatSecondaryMetricLabel(
  delta: number | undefined,
  calculationType: SecondaryMetricCalculationType,
  options: AbsoluteDeltaFormatOptions
): string {
  if (delta === undefined || !Number.isFinite(delta)) {
    return 'N/A';
  }

  const decimals = Math.max(0, Math.min(6, options.decimals ?? 1));

  if (calculationType === 'PERCENTAGE' || calculationType === 'POINTS') {
    const formatter = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    const formattedNumber = formatter.format(delta);
    const sign = delta > 0 ? '+' : '';
    const unit = calculationType === 'POINTS' ? 'pts' : '%';
    return `${sign}${formattedNumber} ${unit}`;
  }

  return formatAbsoluteDelta(delta, options);
}
