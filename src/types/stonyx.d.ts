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
    [key: string]: unknown;
  }
  const log: Log;
  export default log;
}
