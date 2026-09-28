import type { DataTable, GetSummaryDataOptions } from '@tableau/extensions-api-types/ExternalContract/Shared/DataTableInterfaces';

declare global {
  interface Window {
    tableau?: {
      TableauEventType?: {
        SettingsChanged: string;
        FilterChanged?: string;
        SummaryDataChanged?: string;
      };
      extensions?: {
        initializeAsync(): Promise<void>;
        settings?: {
          get(key: string): string | undefined;
          getAll(): Record<string, string>;
          set(key: string, value: string): void;
          saveAsync(): Promise<Record<string, string>>;
          addEventListener(eventType: string, handler: () => void): () => boolean;
        };
        worksheetContent?: {
          worksheet: {
            getSummaryDataAsync(options?: GetSummaryDataOptions): Promise<DataTable>;
            addEventListener(eventType: string, handler: () => void): () => boolean;
          };
        };
      };
    };
  }
}

export {};