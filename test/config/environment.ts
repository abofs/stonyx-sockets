interface TestSocketsConfig {
  handlerDir: string;
  heartBeatInterval: number;
  encryption: string;
  maxReconnectAttempts: number;
  reconnectBaseDelay: number;
}

interface TestEnvironmentConfig {
  sockets: TestSocketsConfig;
}

const config: TestEnvironmentConfig = {
  sockets: {
    handlerDir: './dist-test/test/sample/socket-handlers',
    heartBeatInterval: 60000,
    encryption: 'false',
    maxReconnectAttempts: 0,
    reconnectBaseDelay: 100,
  }
};

export default config;
