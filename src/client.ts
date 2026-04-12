import { WebSocket } from 'ws';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import { sleep } from '@stonyx/utils/promise';
import { encrypt, decrypt, deriveKey } from './encryption.js';

interface SocketsConfig {
  address: string;
  authKey: string;
  authData?: Record<string, unknown>;
  encryption: string | boolean;
  handlerDir: string;
  heartBeatInterval: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  maxReconnectAttempts?: number;
}

interface SocketMessage {
  request: string;
  data?: unknown;
  response?: unknown;
  sessionKey?: string;
}

interface HandlerInstance {
  _clientRef?: SocketClient;
  client: (response: unknown) => void;
  [key: string]: unknown;
}

export default class SocketClient {
  static instance: SocketClient | null;

  handlers: Record<string, HandlerInstance> = {};
  reconnectCount = 0;
  _intentionalClose = false;
  socket: WebSocket | null = null;
  sessionKey: Buffer | null = null;
  globalKey: Buffer | null = null;
  encryptionEnabled = false;
  _heartBeatTimer: ReturnType<typeof setTimeout> | null = null;
  promise: { resolve: () => void; reject: (reason?: unknown) => void } | null = null;

  onDisconnect: ((code: number, reason: string) => void) | null = null;
  onReconnecting: ((attempt: number, delay: number) => void) | null = null;
  onReconnected: (() => void) | null = null;
  onReconnectFailed: (() => void) | null = null;

  constructor() {
    if (SocketClient.instance) return SocketClient.instance;
    SocketClient.instance = this;
  }

  async init(): Promise<void> {
    await this.discoverHandlers();

    const { encryption, authKey } = (config as unknown as Record<string, SocketsConfig>).sockets;
    this.encryptionEnabled = encryption === 'true' || encryption === true;

    if (this.encryptionEnabled) {
      this.globalKey = deriveKey(authKey);
    }

    return this.connect();
  }

  async discoverHandlers(): Promise<void> {
    const { handlerDir } = (config as unknown as Record<string, SocketsConfig>).sockets;

    await forEachFileImport(handlerDir, (HandlerClassUntyped: unknown, { name }) => {
      const HandlerClass = HandlerClassUntyped as new () => HandlerInstance;
      const instance = new HandlerClass();

      if (typeof instance.client === 'function') {
        instance._clientRef = this;
        this.handlers[name] = instance;
      }
    }, { ignoreAccessFailure: true });
  }

  async connect(): Promise<void> {
    if (this.sessionKey) log.socket('Clearing stale sessionKey');
    this.sessionKey = null;
    return new Promise<void>((resolve, reject) => {
      const { address, authKey, authData } = (config as unknown as Record<string, SocketsConfig>).sockets;
      this.promise = { resolve, reject };

      log.socket(`Connecting to remote server: ${address}`);
      const socket = new WebSocket(address);
      this.socket = socket;

      socket.on('message', (data: Buffer) => this.onMessage(data));
      socket.on('close', (code: number, reason: Buffer) => this.onClose(code, reason.toString()));
      socket.on('error', () => {
        log.socket(`Error connecting to socket server`);
        reject('Error connecting to socket server');
      });

      socket.on('open', () => {
        this._intentionalClose = false;
        this.reconnectCount = 0;
        this.send({ request: 'auth', data: { authKey, ...authData } }, true);
      });
    });
  }

  onMessage(payload: Buffer | string): void {
    try {
      let parsed: SocketMessage;

      if (this.encryptionEnabled) {
        const key = this.sessionKey || this.globalKey!;
        const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload as string);
        parsed = JSON.parse(decrypt(raw, key)) as SocketMessage;
      } else {
        const raw = Buffer.isBuffer(payload) ? payload.toString() : payload;
        parsed = JSON.parse(raw as string) as SocketMessage;
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

      handler.client.call({ ...(handler as Record<string, unknown>), client: this }, response);
    } catch {
      log.socket(`Invalid payload received from remote server`);
    }
  }

  send(payload: SocketMessage, useGlobalKey = false): void {
    if (this.encryptionEnabled) {
      const key = useGlobalKey ? this.globalKey! : this.sessionKey!;
      const data = encrypt(JSON.stringify(payload), key);
      this.socket!.send(data);
    } else {
      this.socket!.send(JSON.stringify(payload));
    }
  }

  heartBeat(): void {
    this.send({ request: 'heartBeat' });
  }

  nextHeartBeat(): void {
    const { heartBeatInterval } = (config as unknown as Record<string, SocketsConfig>).sockets;
    this._heartBeatTimer = setTimeout(() => this.heartBeat(), heartBeatInterval);
  }

  onClose(code?: number, reason?: string): void {
    log.socket(`Disconnected from remote server (code: ${code ?? 'unknown'}, reason: ${reason || 'none'})`);
    if (this._heartBeatTimer) clearTimeout(this._heartBeatTimer);

    this.onDisconnect?.(code ?? 1006, reason ?? '');

    if (!this._intentionalClose) {
      this.reconnect();
    }
  }

  close(): void {
    this._intentionalClose = true;
    if (this._heartBeatTimer) clearTimeout(this._heartBeatTimer);
    if (this.socket) this.socket.close();
  }

  getReconnectDelay(): number {
    const {
      reconnectBaseDelay = 1000,
      reconnectMaxDelay = 60000,
    } = (config as unknown as Record<string, SocketsConfig>).sockets;

    const exponential = reconnectBaseDelay * Math.pow(2, this.reconnectCount - 1);
    const capped = Math.min(exponential, reconnectMaxDelay);
    const jitter = Math.floor(Math.random() * 1000);
    return capped + jitter;
  }

  async reconnect(): Promise<void> {
    const { maxReconnectAttempts = Infinity } = (config as unknown as Record<string, SocketsConfig>).sockets;

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

  reset(): void {
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
