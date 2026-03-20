export { default as SocketServer } from './server.js';
export { default as SocketClient } from './client.js';
export { default as Handler } from './handler.js';

export default class Sockets {
  constructor() {
    if (Sockets.instance) return Sockets.instance;
    Sockets.instance = this;
  }

  async init() {
    // Handler discovery is deferred to SocketServer.init() / SocketClient.init()
    // This entry point satisfies Stonyx module auto-initialization
  }

  reset() {
    Sockets.instance = null;
  }
}
