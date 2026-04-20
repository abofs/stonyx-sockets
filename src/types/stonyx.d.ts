declare module 'stonyx/config' {
  interface SocketsConfig {
    port: number;
    address: string;
    authKey: string;
    authData?: Record<string, unknown>;
    encryption: string | boolean;
    handlerDir: string;
    heartBeatInterval: number;
    reconnectBaseDelay?: number;
    reconnectMaxDelay?: number;
    maxReconnectAttempts?: number;
    debug?: boolean;
    logColor?: string;
    logMethod?: string;
  }
  interface Config {
    sockets: SocketsConfig;
    debug?: boolean;
    [key: string]: unknown;
  }
  const config: Config;
  export default config;
}

declare module 'stonyx/log' {
  interface Log {
    socket(message: string): void;
    error(message: string, ...args: unknown[]): void;
    defineType(type: string, setting: string, options?: Record<string, unknown> | null): void;
    [key: string]: unknown;
  }
  const log: Log;
  export default log;
}
