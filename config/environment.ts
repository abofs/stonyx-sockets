const {
  SOCKET_AUTH_KEY,
  SOCKET_PORT,
  SOCKET_ADDRESS,
  SOCKET_HEARTBEAT_INTERVAL,
  SOCKET_HANDLER_DIR,
  SOCKET_LOG,
  SOCKET_ENCRYPTION,
  SOCKET_RECONNECT_BASE_DELAY,
  SOCKET_RECONNECT_MAX_DELAY,
  SOCKET_MAX_RECONNECT_ATTEMPTS,
} = process.env;

const port: string | number = SOCKET_PORT ?? 2667;

interface SocketsEnvironmentConfig {
  port: string | number;
  address: string;
  authKey: string;
  authData: Record<string, unknown>;
  heartBeatInterval: string | number;
  handlerDir: string;
  log: string | boolean;
  logColor: string;
  logMethod: string;
  encryption: string;
  reconnectBaseDelay: string | number;
  reconnectMaxDelay: string | number;
  maxReconnectAttempts: string | number;
}

const config: SocketsEnvironmentConfig = {
  port,
  address: SOCKET_ADDRESS ?? `ws://localhost:${port}`,
  authKey: SOCKET_AUTH_KEY ?? 'AUTH_KEY',
  authData: {},
  heartBeatInterval: SOCKET_HEARTBEAT_INTERVAL ?? 30000,
  handlerDir: SOCKET_HANDLER_DIR ?? './socket-handlers',
  log: SOCKET_LOG ?? false,
  logColor: 'white',
  logMethod: 'socket',
  encryption: SOCKET_ENCRYPTION ?? 'true',
  reconnectBaseDelay: SOCKET_RECONNECT_BASE_DELAY ?? 1000,
  reconnectMaxDelay: SOCKET_RECONNECT_MAX_DELAY ?? 60000,
  maxReconnectAttempts: SOCKET_MAX_RECONNECT_ATTEMPTS ?? Infinity,
};

export default config;
