import './style.css';
import {
  ensureDefaultColumnSettings,
  ensureDefaultColumnWidthsSettings,
  loadColumnSettingsFromTableau,
  loadColumnWidthsSettingsFromTableau,
  saveColumnWidthsSettingsToTableau
} from './data/columnSettings';
import {
  canProjectColumnsFromSourceCache,
  fetchTableauData,
  getLatestTableauFieldNames,
  setPageLoadProgressCallback
} from './data/tableauAdapter';
import { computeInitialExpandedIds, renderTable } from './components/table';
import { renderConfigPanel } from './components/configPanel';
import { getDefaultColumnSettings, saveColumnSettingsToTableau } from './data/columnSettings';
import { createAppState } from './state/appState';
import { hasDataStructureChanged } from './utils/dataStructure';

const appState = createAppState();
const unregisterHandlers: Array<() => boolean> = [];
let persistColumnWidthsTimeout: ReturnType<typeof setTimeout> | null = null;
let worksheetRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let isWorksheetRefreshRunning = false;
let worksheetRefreshRequestedVersion = 0;
let worksheetRefreshAppliedVersion = 0;
let lastWorksheetRefreshRequestAt = 0;
let worksheetRefreshRunStartedAt = 0;
const WORKSHEET_EVENT_COALESCE_MS = 180;
const WORKSHEET_EVENT_DUPLICATE_WINDOW_MS = 2500;

interface TableauRefreshRequest {
  preserveCurrentConfig?: boolean;
  refetchData?: boolean;
  forceSourceRefresh?: boolean;
}

interface RenderExtensionOptions {
  preserveCurrentConfig?: boolean;
  refetchData?: boolean;
  forceSourceRefresh?: boolean;
  applyInitialHierarchyExpansion?: boolean;
}

function setupConfigPanelToggle(): void {
  const toggleButton = document.getElementById('config-toggle-btn') as HTMLButtonElement | null;
  const panel = document.getElementById('config-panel-container');

  if (!toggleButton || !panel) {
    return;
  }

  const setPanelVisibility = (isOpen: boolean): void => {
    panel.classList.toggle('config-panel-collapsed', !isOpen);
    toggleButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggleButton.setAttribute(
      'aria-label',
      isOpen ? 'Close configuration' : 'Open configuration'
    );
  };

  setPanelVisibility(false);

  toggleButton.addEventListener('click', () => {
    const isOpen = toggleButton.getAttribute('aria-expanded') === 'true';
    setPanelVisibility(!isOpen);
  });
}

function getFallbackAvailableFields(): string[] {
  const fieldNames = new Set<string>();
  appState.latestData.forEach((row) => {
    Object.keys(row.values).forEach((key) => fieldNames.add(key));
  });

  return Array.from(fieldNames).sort((left, right) => left.localeCompare(right));
}

function getActiveColumns() {
  return window.tableau?.extensions?.settings ? loadColumnSettingsFromTableau() : appState.columns;
}

function getActiveColumnWidths(): Record<string, number> {
  return window.tableau?.extensions?.settings ? loadColumnWidthsSettingsFromTableau() : appState.columnWidths;
}

function getActiveWorksheet() {
  const extensions = window.tableau?.extensions as unknown as {
    worksheetContent?: { worksheet?: unknown };
    dashboardContent?: { dashboard?: { worksheets?: unknown[] } };
  } | undefined;

  type HoverWorksheet = {
    name?: string;
    hoverTupleAsync?: (
      tupleId: number,
      options?: { tooltipAnchorPoint?: { x: number; y: number } }
    ) => Promise<unknown> | unknown;
  };

  const worksheetFromContent = extensions?.worksheetContent?.worksheet as HoverWorksheet | undefined;
  const dashboardWorksheets = (extensions?.dashboardContent?.dashboard?.worksheets ?? []) as HoverWorksheet[];

  const hasHoverApi = (worksheet: HoverWorksheet | undefined): boolean =>
    Boolean(worksheet && typeof worksheet.hoverTupleAsync === 'function');

  if (hasHoverApi(worksheetFromContent)) {
    return worksheetFromContent;
  }

  if (worksheetFromContent?.name) {
    const sameNameWorksheet = dashboardWorksheets.find((worksheet) => worksheet.name === worksheetFromContent.name);
    if (hasHoverApi(sameNameWorksheet)) {
      return sameNameWorksheet;
    }
  }

  const dashboardHoverWorksheet = dashboardWorksheets.find((worksheet) => hasHoverApi(worksheet));
  if (dashboardHoverWorksheet) {
    return dashboardHoverWorksheet;
  }

  return worksheetFromContent as {
    hoverTupleAsync?: (
      tupleId: number,
      options?: { tooltipAnchorPoint?: { x: number; y: number } }
    ) => Promise<unknown> | unknown;
  } | undefined;
}

function scheduleColumnWidthsSave(): void {
  if (!window.tableau?.extensions?.settings) {
    return;
  }

  if (persistColumnWidthsTimeout) {
    clearTimeout(persistColumnWidthsTimeout);
  }

  persistColumnWidthsTimeout = setTimeout(() => {
    const widthsToSave = { ...appState.columnWidths };
    void saveColumnWidthsSettingsToTableau(widthsToSave).catch(() => {
      console.warn('Unable to save column widths.');
    });
  }, 250);
}

function renderDataBanner(): void {
  const bannerId = 'data-cap-banner';
  document.getElementById(bannerId)?.remove();
}

function showLoadingBanner(processedRows: number, totalRows: number): void {
  const safeTotal = Math.max(1, totalRows);
  const safeProcessed = Math.min(Math.max(0, processedRows), safeTotal);
  const pct = Math.round((safeProcessed / safeTotal) * 100);
  const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n);
  let banner = document.getElementById('loading-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'loading-banner';
    banner.className = 'loading-banner';
    document.getElementById('app')?.prepend(banner);
  }
  banner.innerText = `Loading... ${pct}% - ${fmt(safeProcessed)} / ${fmt(safeTotal)} marks processed`;
}

function hideLoadingBanner(): void {
  document.getElementById('loading-banner')?.remove();
}

function queueWorksheetRefresh(request: TableauRefreshRequest = {}): void {
  const now = Date.now();
  if (now - lastWorksheetRefreshRequestAt > WORKSHEET_EVENT_COALESCE_MS) {
    worksheetRefreshRequestedVersion += 1;
  }
  lastWorksheetRefreshRequestAt = now;

  if (worksheetRefreshTimeout) {
    clearTimeout(worksheetRefreshTimeout);
  }

  worksheetRefreshTimeout = setTimeout(() => {
    void flushWorksheetDataRefresh(request);
  }, 120);
}

async function flushWorksheetDataRefresh(request: TableauRefreshRequest = {}): Promise<void> {
  if (isWorksheetRefreshRunning) {
    return;
  }

  if (worksheetRefreshRequestedVersion <= worksheetRefreshAppliedVersion) {
    return;
  }

  isWorksheetRefreshRunning = true;
  worksheetRefreshRunStartedAt = Date.now();
  const targetVersion = worksheetRefreshRequestedVersion;
  try {
    await renderExtension({
      preserveCurrentConfig: true,
      refetchData: true,
      forceSourceRefresh: true,
      ...request
    });
  } finally {
    const hadNewRequestsWhileRunning = worksheetRefreshRequestedVersion > targetVersion;
    const latestRequestDelayFromRunStart = lastWorksheetRefreshRequestAt - worksheetRefreshRunStartedAt;

    if (hadNewRequestsWhileRunning && latestRequestDelayFromRunStart <= WORKSHEET_EVENT_DUPLICATE_WINDOW_MS) {
      worksheetRefreshAppliedVersion = worksheetRefreshRequestedVersion;
    } else {
      worksheetRefreshAppliedVersion = targetVersion;
    }

    isWorksheetRefreshRunning = false;

    if (worksheetRefreshRequestedVersion > worksheetRefreshAppliedVersion) {
      if (worksheetRefreshTimeout) {
        clearTimeout(worksheetRefreshTimeout);
      }

      worksheetRefreshTimeout = setTimeout(() => {
        void flushWorksheetDataRefresh(request);
      }, 120);
    }
  }
}

function registerWorksheetAutoRefresh(): void {
  const worksheet = window.tableau?.extensions?.worksheetContent?.worksheet;
  if (!worksheet) {
    return;
  }

  while (unregisterHandlers.length > 0) {
    unregisterHandlers.pop()?.();
  }

  const filterChangedEvent = window.tableau?.TableauEventType?.FilterChanged ?? 'filter-changed';
  const summaryChangedEvent = window.tableau?.TableauEventType?.SummaryDataChanged ?? 'summary-data-changed';

  unregisterHandlers.push(
    worksheet.addEventListener(filterChangedEvent, () => {
      queueWorksheetRefresh({ preserveCurrentConfig: true, refetchData: true, forceSourceRefresh: true });
    })
  );

  unregisterHandlers.push(
    worksheet.addEventListener(summaryChangedEvent, () => {
      queueWorksheetRefresh({ preserveCurrentConfig: true, refetchData: true, forceSourceRefresh: true });
    })
  );
}

async function initializeTableauExtension(): Promise<boolean> {
  if (!window.tableau?.extensions) {
    console.info('Running outside Tableau: using mock data.');
    return false;
  }

  await window.tableau.extensions.initializeAsync();
  return true;
}

async function fetchWithProgress(forceSourceRefresh = false): Promise<Awaited<ReturnType<typeof fetchTableauData>>> {
  if (!forceSourceRefresh && canProjectColumnsFromSourceCache(appState.columns)) {
    return fetchTableauData(appState.columns, { forceRefresh: false });
  }

  setPageLoadProgressCallback(showLoadingBanner);
  try {
    return await fetchTableauData(appState.columns, { forceRefresh: forceSourceRefresh });
  } finally {
    setPageLoadProgressCallback(null);
    hideLoadingBanner();
  }
}

async function renderExtension(options?: RenderExtensionOptions): Promise<void> {
  const preserveCurrentConfig = options?.preserveCurrentConfig ?? false;
  const refetchData = options?.refetchData ?? appState.latestData.length === 0;
  const forceSourceRefresh = options?.forceSourceRefresh ?? false;

  if (!preserveCurrentConfig) {
    appState.columns = getActiveColumns();
    appState.columnWidths = getActiveColumnWidths();
  }

  if (refetchData) {
    appState.latestData = await fetchWithProgress(forceSourceRefresh);

    if (options?.applyInitialHierarchyExpansion && appState.expandedHierarchyIds.size === 0) {
      const hierarchyColumn = appState.columns.find(
        (column): column is Extract<typeof column, { type: 'hierarchy' }> => column.type === 'hierarchy'
      );
      appState.expandedHierarchyIds = computeInitialExpandedIds(appState.latestData, hierarchyColumn?.expandTo);
    }
  }
  const availableFields = getLatestTableauFieldNames().length > 0
    ? getLatestTableauFieldNames()
    : getFallbackAvailableFields();

  const renderCurrentTable = (): void => {
    renderTable('custom-table-container', appState.latestData, appState.columns, {
      tableauWorksheet: getActiveWorksheet(),
      onColumnsReordered: (columns) => {
        appState.columns = columns.map((column) => ({ ...column }));
        void renderExtension({ preserveCurrentConfig: true });
      },
      columnWidths: appState.columnWidths,
      onColumnWidthsChange: (columnWidths) => {
        appState.columnWidths = { ...columnWidths };
        scheduleColumnWidthsSave();
        renderCurrentTable();
      },
      expandedNodeIds: appState.expandedHierarchyIds,
      onExpandedNodeIdsChange: (expandedNodeIds) => {
        appState.expandedHierarchyIds = expandedNodeIds;
      },
      columnFilters: appState.columnFilters,
      onColumnFiltersChange: (columnFilters) => {
        appState.columnFilters = columnFilters;
        renderCurrentTable();
      },
      sortState: appState.sortState,
      onSortStateChange: (sortState) => {
        appState.sortState = sortState;
        renderCurrentTable();
      }
    });
  };

  renderCurrentTable();
  renderDataBanner();
  renderConfigPanel({
    containerId: 'config-panel-container',
    columns: appState.columns,
    rows: appState.latestData,
    availableFields,
    canPersist: Boolean(window.tableau?.extensions?.settings),
    onSave: async (columns) => {
      const needsRefetch = hasDataStructureChanged(appState.columns, columns);
      const previousHierarchyColumn = appState.columns.find(
        (column): column is Extract<typeof column, { type: 'hierarchy' }> => column.type === 'hierarchy'
      );
      const nextHierarchyColumn = columns.find(
        (column): column is Extract<typeof column, { type: 'hierarchy' }> => column.type === 'hierarchy'
      );
      const expandToChanged = previousHierarchyColumn?.expandTo !== nextHierarchyColumn?.expandTo;

      appState.columns = columns.map((column) => ({ ...column }));

      if (needsRefetch) {
        appState.latestData = await fetchWithProgress(false);
      }

      if (nextHierarchyColumn && expandToChanged) {
        appState.expandedHierarchyIds = computeInitialExpandedIds(appState.latestData, nextHierarchyColumn.expandTo);
      }

      renderCurrentTable();

      if (window.tableau?.extensions?.settings) {
        let saveFailed = false;
        await saveColumnSettingsToTableau(appState.columns).catch(() => {
          saveFailed = true;
        });

        if (saveFailed) {
          console.warn('Unable to save Tableau configuration.');
        }
      }
    },
    onReset: async () => {
      appState.columns = getDefaultColumnSettings();
      appState.columnWidths = {};
      appState.columnFilters = {};
      appState.sortState = null;
      appState.latestData = await fetchWithProgress(false);
      renderCurrentTable();

      if (window.tableau?.extensions?.settings) {
        let resetFailed = false;
        await saveColumnSettingsToTableau(appState.columns).catch(() => {
          resetFailed = true;
        });

        await saveColumnWidthsSettingsToTableau(appState.columnWidths).catch(() => {
          resetFailed = true;
        });

        if (resetFailed) {
          console.warn('Unable to reset Tableau configuration.');
        }
      }

      await renderExtension({ preserveCurrentConfig: true, refetchData: false });
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupConfigPanelToggle();

  const initialize = async (): Promise<void> => {
    const isTableauRuntime = await initializeTableauExtension();

    if (isTableauRuntime && window.tableau?.extensions?.settings) {
      ensureDefaultColumnSettings();
      ensureDefaultColumnWidthsSettings();
      registerWorksheetAutoRefresh();

      if (window.tableau.extensions.settings.get('advanced-table.columns') === undefined) {
        let persistDefaultsFailed = false;
        await window.tableau.extensions.settings.saveAsync().catch(() => {
          persistDefaultsFailed = true;
        });

        if (persistDefaultsFailed) {
          console.warn('Unable to persist default settings outside authoring mode.');
        }
      }

      const settingsChangedEventType = window.tableau.TableauEventType?.SettingsChanged ?? 'settings-changed';
      window.tableau.extensions.settings.addEventListener(settingsChangedEventType, () => {
        queueWorksheetRefresh({ preserveCurrentConfig: false, refetchData: false, forceSourceRefresh: false });
      });
    }

    await renderExtension({ preserveCurrentConfig: false, refetchData: true, forceSourceRefresh: true, applyInitialHierarchyExpansion: true });
  };

  void initialize().catch(() => {
    renderTable('custom-table-container', [], []);
    console.error('Failed to initialize Tableau extension.');
  });
});