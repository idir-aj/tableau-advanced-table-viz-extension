import * as d3 from 'd3';

interface SparklineRenderOptions {
  line1Color?: string;
  line2Color?: string;
  onPointHover?: (payload: {
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
    phase: 'enter' | 'move';
    index: number;
    date?: string | number;
    currentValue?: number;
    previousValue?: number;
    line: 'current' | 'previous';
  }) => void;
  onPointLeave?: () => void;
}

function parseDateValue(value: string | number): Date | null {
  if (typeof value === 'number') {
    const numericDate = new Date(value);
    return Number.isNaN(numericDate.getTime()) ? null : numericDate;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

export function renderSparklineCell(
  container: HTMLElement,
  dates: Array<string | number>,
  trendN: number[],
  trendN1: number[],
  options?: SparklineRenderOptions
): void {
    const line1Color = options?.line1Color ?? '#3643BA';
    const line2Color = options?.line2Color ?? '#D9DDE1';

  container.innerHTML = '';

  const width = 120;
  const height = 28;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const allVals = [...trendN, ...trendN1];
  const maxVal = d3.max(allVals) || 40;
  const minVal = d3.min(allVals) || 0;
  const parsedDates = dates.map(parseDateValue);
  const hasValidDates = parsedDates.length > 0 && parsedDates.every((value): value is Date => value !== null);

  const xByIndex = d3.scaleLinear()
    .domain([0, Math.max(trendN.length, trendN1.length) - 1])
    .range([4, width - 4]);

  const xByDate = hasValidDates
    ? d3.scaleTime()
        .domain(d3.extent(parsedDates) as [Date, Date])
        .range([4, width - 4])
    : null;

  const y = d3.scaleLinear()
    .domain([minVal, maxVal])
    .range([height - 4, 4]);

  const previousPoints = trendN1.map((value, index) => ({ value, index }));
  const currentPoints = trendN.map((value, index) => ({ value, index }));

  const lineBuilder = d3.line<number>()
    .x((_, i) => {
      if (xByDate && parsedDates[i]) {
        return xByDate(parsedDates[i] as Date);
      }
      return xByIndex(i);
    })
    .y(d => y(d))
    .curve(d3.curveMonotoneX);

  // Ligne N-1 (Gris clair)
  svg.append('path')
    .datum(trendN1)
    .attr('fill', 'none')
    .attr('stroke', line2Color)
    .attr('stroke-width', 2)
    .attr('d', lineBuilder);

  // Ligne N (Foncée)
  svg.append('path')
    .datum(trendN)
    .attr('fill', 'none')
    .attr('stroke', line1Color)
    .attr('stroke-width', 2.5)
    .attr('d', lineBuilder);

  // Show points so single-point or short series remain visible.
  svg
    .selectAll('circle.sparkline-prev')
    .data(previousPoints)
    .enter()
    .append('circle')
    .attr('class', 'sparkline-prev')
    .attr('cx', (d) => {
      if (xByDate && parsedDates[d.index]) {
        return xByDate(parsedDates[d.index] as Date);
      }
      return xByIndex(d.index);
    })
    .attr('cy', (d) => y(d.value))
    .attr('r', 1.8)
    .attr('fill', line2Color)
    .on('pointerenter', function (event, d) {
      options?.onPointHover?.({
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        phase: 'enter',
        index: d.index,
        date: dates[d.index],
        currentValue: trendN[d.index],
        previousValue: trendN1[d.index],
        line: 'previous'
      });
    })
    .on('pointermove', function (event, d) {
      options?.onPointHover?.({
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        phase: 'move',
        index: d.index,
        date: dates[d.index],
        currentValue: trendN[d.index],
        previousValue: trendN1[d.index],
        line: 'previous'
      });
    })
    .on('pointerleave', () => options?.onPointLeave?.());

  svg
    .selectAll('circle.sparkline-current')
    .data(currentPoints)
    .enter()
    .append('circle')
    .attr('class', 'sparkline-current')
    .attr('cx', (d) => {
      if (xByDate && parsedDates[d.index]) {
        return xByDate(parsedDates[d.index] as Date);
      }
      return xByIndex(d.index);
    })
    .attr('cy', (d) => y(d.value))
    .attr('r', 2.1)
    .attr('fill', line1Color)
    .on('pointerenter', function (event, d) {
      options?.onPointHover?.({
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        phase: 'enter',
        index: d.index,
        date: dates[d.index],
        currentValue: trendN[d.index],
        previousValue: trendN1[d.index],
        line: 'current'
      });
    })
    .on('pointermove', function (event, d) {
      options?.onPointHover?.({
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        phase: 'move',
        index: d.index,
        date: dates[d.index],
        currentValue: trendN[d.index],
        previousValue: trendN1[d.index],
        line: 'current'
      });
    })
    .on('pointerleave', () => options?.onPointLeave?.());
}