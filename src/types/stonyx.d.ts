declare module 'stonyx/config' {
  const config: Record<string, unknown>;
  export default config;
}

declare module 'stonyx/log' {
  interface Log {
    socket(message: string): void;
    error(message: string, ...args: unknown[]): void;
    [key: string]: unknown;
  }
  const log: Log;
  export default log;
}
