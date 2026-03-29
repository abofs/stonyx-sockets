import { WebSocket } from 'ws';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import { sleep } from '@stonyx/utils/promise';
import { encrypt, decrypt, deriveKey } from './encryption.js';

export default class SocketClient {
  handlers = {};
  reconnectCount = 0;
  _intentionalClose = false;

  onDisconnect = null;
  onReconnecting = null;
  onReconnected = null;
  onReconnectFailed = null;

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
      const { address, authKey, authData } = config.sockets;
      this.promise = { resolve, reject };

      log.socket(`Connecting to remote server: ${address}`);
      const socket = new WebSocket(address);
      this.socket = socket;

      socket.onmessage = this.onMessage.bind(this);
      socket.onclose = this.onClose.bind(this);
      socket.onerror = event => {
        log.socket(`Error connecting to socket server`);
        reject('Error connecting to socket server');
      };

      socket.onopen = () => {
        this._intentionalClose = false;
        this.reconnectCount = 0;
        this.send({ request: 'auth', data: { authKey, ...authData } }, true);
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
        const raw = Buffer.isBuffer(payload) ? payload.toString() : payload;
        parsed = JSON.parse(raw);
      }

      const { request, response, sessionKey } = parsed;

      if (request === 'auth') {
        if (sessionKey && this.encryptionEnabled) {
          this.sessionKey = Buffer.from(sessionKey, 'base64');
        }
        this.nextHeartBeat();
      }

      if (request === 'heartBeat') {
        this.nextHeartBeat();
        return;
      }

      const handler = this.handlers[request];

      if (!handler) {
        log.socket(`Call to invalid handler: ${request}`);
        return;
      }

      handler.client.call({ client: this, ...handler }, response);
    } catch (error) {
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

    this.onDisconnect?.();

    if (!this._intentionalClose) {
      this.reconnect();
    }
  }

  close() {
    this._intentionalClose = true;
    if (this._heartBeatTimer) clearTimeout(this._heartBeatTimer);
    if (this.socket) this.socket.close();
  }

  getReconnectDelay() {
    const {
      reconnectBaseDelay = 1000,
      reconnectMaxDelay = 60000,
    } = config.sockets;

    const exponential = reconnectBaseDelay * Math.pow(2, this.reconnectCount - 1);
    const capped = Math.min(exponential, reconnectMaxDelay);
    const jitter = Math.floor(Math.random() * 1000);
    return capped + jitter;
  }

  async reconnect() {
    const { maxReconnectAttempts = Infinity } = config.sockets;

    this.reconnectCount++;

    if (this.reconnectCount > maxReconnectAttempts) {
      log.socket('Max reconnect attempts exceeded');
      this.onReconnectFailed?.();
      return;
    }

    const delay = this.getReconnectDelay();
    this.onReconnecting?.(this.reconnectCount, delay);
    log.socket(`Reconnecting (attempt ${this.reconnectCount}, delay ${delay}ms)`);

    await sleep(delay / 1000);

    try {
      await this.connect();
      this.onReconnected?.();
    } catch {
      // onClose will fire and trigger the next reconnect attempt
    }
  }

  reset() {
    this.close();
    this.handlers = {};
    this.sessionKey = null;
    this.reconnectCount = 0;
    this._intentionalClose = false;
    this.onDisconnect = null;
    this.onReconnecting = null;
    this.onReconnected = null;
    this.onReconnectFailed = null;
    SocketClient.instance = null;
  }
}
