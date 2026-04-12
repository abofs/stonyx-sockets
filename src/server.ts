import { WebSocket, WebSocketServer } from 'ws';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import { encrypt, decrypt, deriveKey, generateSessionKey } from './encryption.js';

interface SocketsConfig {
  port: number;
  encryption: string | boolean;
  authKey: string;
  handlerDir: string;
  debug?: boolean;
}

interface SocketMessage {
  request: string;
  data?: unknown;
  response?: unknown;
  sessionKey?: string;
}

interface ConnectedClient {
  id: number;
  ip: string;
  __authenticated: boolean;
  __sessionKey?: Buffer;
  meta?: Record<string, unknown>;
  send(payload: SocketMessage, keyOverride?: Buffer): void;
  close(): void;
  terminate(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

interface HandlerInstance {
  _serverRef?: SocketServer;
  server: (data: unknown, client: ConnectedClient) => unknown | Promise<unknown>;
  constructor: { skipAuth: boolean };
  [key: string]: unknown;
}

let clientId = 0;

export default class SocketServer {
  static instance: SocketServer | null;

  clientMap: Map<number, ConnectedClient> = new Map();
  handlers: Record<string, HandlerInstance> = {};
  wss: WebSocketServer | null = null;
  encryptionEnabled = false;
  globalKey: Buffer | null = null;

  onClientDisconnect: ((client: ConnectedClient, code: number, reason: string) => void) | null = null;

  constructor() {
    if (SocketServer.instance) return SocketServer.instance;
    SocketServer.instance = this;
  }

  async init(): Promise<void> {
    await this.discoverHandlers();
    this.validateAuthHandler();

    const { port, encryption, authKey } = (config as unknown as Record<string, SocketsConfig>).sockets;
    this.encryptionEnabled = encryption === 'true' || encryption === true;

    if (this.encryptionEnabled) {
      this.globalKey = deriveKey(authKey);
    }

    const wss = new WebSocketServer({ port });
    this.wss = wss;

    log.socket(`WebSocket server is listening on port ${port}`);

    wss.on('connection', (ws: WebSocket, request) => {
      const { remoteAddress } = request.socket;
      log.socket(`[${remoteAddress}] Client connected`);

      const client = ws as unknown as ConnectedClient;
      client.id = ++clientId;
      client.ip = remoteAddress || '';
      client.__authenticated = false;
      this.prepareSend(client, ws);

      ws.on('message', (payload: Buffer) => this.onMessage(payload, client));
      ws.on('close', (code: number, reason: Buffer) => this.handleDisconnect(client, code, reason.toString()));
    });
  }

  async discoverHandlers(): Promise<void> {
    const { handlerDir } = (config as unknown as Record<string, SocketsConfig>).sockets;

    await forEachFileImport(handlerDir, (HandlerClassUntyped: unknown, { name }) => {
      const HandlerClass = HandlerClassUntyped as new () => HandlerInstance;
      const instance = new HandlerClass();

      if (typeof instance.server === 'function') {
        instance._serverRef = this;
        this.handlers[name] = instance;
      }
    }, { ignoreAccessFailure: true });
  }

  validateAuthHandler(): void {
    if (!this.handlers.auth) {
      throw new Error('SocketServer requires an "auth" handler with a server() method');
    }
  }

  async onMessage(payload: Buffer | string, client: ConnectedClient): Promise<void> {
    try {
      let parsed: SocketMessage;

      if (this.encryptionEnabled) {
        const key = client.__authenticated ? client.__sessionKey! : this.globalKey!;
        const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        parsed = JSON.parse(decrypt(raw, key)) as SocketMessage;
      } else {
        parsed = JSON.parse(typeof payload === 'string' ? payload : payload.toString()) as SocketMessage;
      }

      const { request, data } = parsed;

      // Built-in heartbeat - no handler needed
      if (request === 'heartBeat') {
        if (client.__authenticated) client.send({ request: 'heartBeat', response: true });
        return;
      }

      const handler = this.handlers[request];

      if (!handler) {
        log.socket(`Invalid request received: ${request}`);
        return;
      }

      if (request !== 'auth' && !handler.constructor.skipAuth && !client.__authenticated) {
        log.socket(`Rejected unauthenticated request: ${request}`);
        client.close();
        return;
      }

      const response = await handler.server(data, client);
      if (response === undefined || response === null) return;

      if (request === 'auth' && response) {
        client.__authenticated = true;

        if (this.encryptionEnabled) {
          const sessionKey = generateSessionKey();
          client.__sessionKey = sessionKey;
          client.send({ request, response, sessionKey: sessionKey.toString('base64') }, this.globalKey!);
        } else {
          client.send({ request, response });
        }
        return;
      }

      client.send({ request, response });
    } catch (error) {
      log.socket(`Invalid payload from client`);
      if ((config as Record<string, unknown>).debug) console.error(error);
      client.close();
    }
  }

  prepareSend(client: ConnectedClient, ws: WebSocket): void {
    const socketSend = ws.send.bind(ws);
    const server = this;

    client.send = (payload: SocketMessage, keyOverride?: Buffer) => {
      if (server.encryptionEnabled) {
        const key = keyOverride || client.__sessionKey!;
        const data = encrypt(JSON.stringify(payload), key);
        socketSend(data);
      } else {
        socketSend(JSON.stringify(payload));
      }
    };
  }

  // ws always provides code and reason; params are optional for direct calls and testing
  handleDisconnect(client: ConnectedClient, code?: number, reason?: string): void {
    const { ip } = client;
    log.socket(`[${ip}] Client disconnected (code: ${code ?? 'unknown'}, reason: ${reason || 'none'})`);
    this.clientMap.delete(client.id);
    this.onClientDisconnect?.(client, code ?? 1006, reason ?? '');
  }

  sendTo(clientId: number, request: string, response: unknown): void {
    const client = this.clientMap.get(clientId);
    if (!client) return;
    client.send({ request, response });
  }

  sendToByMeta(key: string, value: unknown, request: string, response: unknown): boolean {
    for (const [, client] of this.clientMap) {
      if (client.meta?.[key] === value && client.__authenticated) {
        client.send({ request, response });
        return true;
      }
    }
    return false;
  }

  broadcast(request: string, response: unknown): void {
    for (const [, client] of this.clientMap) {
      if (client.__authenticated) {
        client.send({ request, response });
      }
    }
  }

  close(): void {
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  reset(): void {
    this.close();
    this.clientMap.clear();
    this.handlers = {};
    clientId = 0;
    SocketServer.instance = null;
  }
}
