type BarFormatStyle = 'number' | 'currency' | 'percent';
type BarScale = 'auto' | 'none' | 'k' | 'm';
type BarCurrency = 'EUR' | 'USD' | 'GBP';

interface BarCellFormatOptions {
  barColor?: string;
  textColor?: string;
  decimals?: number;
  formatStyle?: BarFormatStyle;
  currency?: BarCurrency;
  scale?: BarScale;
  secondaryLabel?: { text: string; tone: string };
}

function getLocaleForCurrency(currency: BarCurrency): string {
  if (currency === 'USD') return 'en-US';
  if (currency === 'GBP') return 'en-GB';
  return 'fr-FR';
}

function getScaleInfo(value: number, scale: BarScale): { divisor: number; suffix: string } {
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

function formatBarValue(value: number, options?: BarCellFormatOptions): string {
  const decimals = Math.max(0, Math.min(6, options?.decimals ?? 0));
  const formatStyle = options?.formatStyle ?? 'number';
  const scale = options?.scale ?? 'auto';
  const currency = options?.currency ?? 'EUR';
  const locale = getLocaleForCurrency(currency);

  if (formatStyle === 'percent') {
    const displayValue = value * 100;
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return `${formatter.format(displayValue)} %`;
  }

  const { divisor, suffix } = getScaleInfo(value, scale);
  const scaledValue = value / divisor;

  if (formatStyle === 'currency') {
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    const formattedNumber = formatter.format(scaledValue);

    if (currency === 'USD') {
      return `$${formattedNumber}${suffix}`;
    }

    if (currency === 'GBP') {
      return `£${formattedNumber}${suffix}`;
    }

    if (suffix) {
      return `${formattedNumber} ${suffix}€`;
    }

    return `${formattedNumber} €`;
  }

  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return `${formatter.format(scaledValue)}${suffix ? ` ${suffix}` : ''}`;
}

export function renderBarCell(container: HTMLElement, value: number, max: number, formatOptions?: BarCellFormatOptions): void {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'bar-wrapper';

  const safeMax = max > 0 ? max : 1;
  const percentage = Math.min(100, Math.max(0, (value / safeMax) * 100));

  const barBg = document.createElement('div');
  barBg.className = 'bar-bg';
  barBg.style.width = `${percentage}px`;
  barBg.style.backgroundColor = formatOptions?.barColor ?? '#3643BA';
  barBg.style.borderColor = formatOptions?.barColor ?? '#3643BA';

  const valText = document.createElement('span');
  valText.className = 'bar-value';
  valText.innerText = formatBarValue(value, formatOptions);
  valText.style.color = formatOptions?.textColor ?? '';

  const valueGroup = document.createElement('div');
  valueGroup.className = 'bar-value-group';
  valueGroup.appendChild(valText);

  if (formatOptions?.secondaryLabel) {
    const secondaryText = document.createElement('span');
    secondaryText.className = `secondary-metric-label secondary-metric-${formatOptions.secondaryLabel.tone}`;
    secondaryText.innerText = formatOptions.secondaryLabel.text;
    valueGroup.appendChild(secondaryText);
  }

  wrapper.appendChild(barBg);
  wrapper.appendChild(valueGroup);
  container.appendChild(wrapper);
}