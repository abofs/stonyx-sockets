import { WebSocket } from 'ws';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import { encrypt, decrypt, deriveKey } from './encryption.js';

export default class SocketClient {
  handlers = {};
  reconnectCount = 0;

  constructor() {
    if (SocketClient.instance) return SocketClient.instance;
    SocketClient.instance = this;
  }

  async init() {
    await this.discoverHandlers();

    const { encryption, authKey } = config.sockets;
    this.encryptionEnabled = encryption === 'true' || encryption === true;

    if (this.encryptionEnabled) {
      this.globalKey = deriveKey(authKey);
    }

    return this.connect();
  }

  async discoverHandlers() {
    const { handlerDir } = config.sockets;

    await forEachFileImport(handlerDir, (HandlerClass, { name }) => {
      const instance = new HandlerClass();

      if (typeof instance.client === 'function') {
        instance._clientRef = this;
        this.handlers[name] = instance;
      }
    }, { ignoreAccessFailure: true });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const { address, authKey } = config.sockets;
      this.promise = { resolve, reject };

      log.socket(`Connecting to remote server: ${address}`);
      const socket = new WebSocket(address);
      this.socket = socket;

      socket.onmessage = this.onMessage.bind(this);
      socket.onclose = this.onClose.bind(this);
      socket.onerror = event => {
        console.error(event);
        reject('Error connecting to socket server');
      };

      socket.onopen = () => {
        this.reconnectCount = 0;
        this.send({ request: 'auth', data: { authKey } }, true);
      };
    });
  }

  onMessage({ data: payload }) {
    try {
      let parsed;

      if (this.encryptionEnabled) {
        const key = this.sessionKey || this.globalKey;
        const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        parsed = JSON.parse(decrypt(raw, key));
      } else {
        parsed = JSON.parse(payload);
      }

      const { request, response, sessionKey } = parsed;

      // Built-in auth session key handling + heartbeat kickoff
      if (request === 'auth') {
        if (sessionKey && this.encryptionEnabled) {
          this.sessionKey = Buffer.from(sessionKey, 'base64');
        }
        this.nextHeartBeat();
      }

      // Built-in heartbeat — schedule next beat on response
      if (request === 'heartBeat') {
        this.nextHeartBeat();
        return;
      }

      const handler = this.handlers[request];

      if (!handler) {
        console.error(`Call to invalid handler: ${request}`);
        return;
      }

      handler.client.call({ client: this, ...handler }, response);
    } catch (error) {
      console.error(error);
      log.socket(`Invalid payload received from remote server`);
    }
  }

  send(payload, useGlobalKey = false) {
    if (this.encryptionEnabled) {
      const key = useGlobalKey ? this.globalKey : this.sessionKey;
      const data = encrypt(JSON.stringify(payload), key);
      this.socket.send(data);
    } else {
      this.socket.send(JSON.stringify(payload));
    }
  }

  heartBeat() {
    this.send({ request: 'heartBeat' });
  }

  nextHeartBeat() {
    this._heartBeatTimer = setTimeout(() => this.heartBeat(), config.sockets.heartBeatInterval);
  }

  onClose() {
    log.socket('Disconnected from remote server');
    if (this._heartBeatTimer) clearTimeout(this._heartBeatTimer);
  }

  close() {
    if (this._heartBeatTimer) clearTimeout(this._heartBeatTimer);
    if (this.socket) this.socket.close();
  }

  reconnect() {
    if (this.reconnectCount > 5) {
      log.socket('Max reconnect attempts exceeded');
      return;
    }

    this.reconnectCount++;
    return this.connect();
  }

  reset() {
    this.close();
    this.handlers = {};
    this.sessionKey = null;
    this.reconnectCount = 0;
    SocketClient.instance = null;
  }
}
