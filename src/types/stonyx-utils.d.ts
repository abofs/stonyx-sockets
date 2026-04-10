declare module '@stonyx/utils/file' {
  interface FileImportMeta {
    name: string;
    stats: import('fs').Stats;
    path: string;
    options?: unknown;
  }
  interface ForEachFileImportOptions {
    ignoreAccessFailure?: boolean;
    recursive?: boolean;
    recursiveNaming?: boolean;
    rawName?: boolean;
    namePrefix?: string;
    fullExport?: boolean;
  }
  export function forEachFileImport(dir: string, callback: (output: unknown, meta: FileImportMeta) => void | Promise<void>, options?: ForEachFileImportOptions): Promise<void>;
}

declare module '@stonyx/utils/promise' {
  export function sleep(seconds: number): Promise<void>;
}
