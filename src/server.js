import { WebSocketServer } from 'ws';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import { encrypt, decrypt, deriveKey, generateSessionKey } from './encryption.js';

let clientId = 0;

export default class SocketServer {
  clientMap = new Map();
  handlers = {};

  constructor() {
    if (SocketServer.instance) return SocketServer.instance;
    SocketServer.instance = this;
  }

  async init() {
    await this.discoverHandlers();
    this.validateAuthHandler();

    const { port, encryption, authKey } = config.sockets;
    this.encryptionEnabled = encryption === 'true' || encryption === true;

    if (this.encryptionEnabled) {
      this.globalKey = deriveKey(authKey);
    }

    const wss = new WebSocketServer({ port });
    this.wss = wss;

    log.socket(`WebSocket server is listening on port ${port}`);

    wss.on('connection', (client, request) => {
      const { remoteAddress } = request.socket;
      log.socket(`[${remoteAddress}] Client connected`);
      client.id = ++clientId;
      client.ip = remoteAddress;
      client.__authenticated = false;
      this.prepareSend(client);

      client.on('message', payload => this.onMessage(payload, client));
      client.on('close', () => this.handleDisconnect(client));
    });
  }

  async discoverHandlers() {
    const { handlerDir } = config.sockets;

    await forEachFileImport(handlerDir, (HandlerClass, { name }) => {
      const instance = new HandlerClass();

      if (typeof instance.server === 'function') {
        instance._serverRef = this;
        this.handlers[name] = instance;
      }
    }, { ignoreAccessFailure: true });
  }

  validateAuthHandler() {
    if (!this.handlers.auth) {
      throw new Error('SocketServer requires an "auth" handler with a server() method');
    }
  }

  async onMessage(payload, client) {
    try {
      let parsed;

      if (this.encryptionEnabled) {
        const key = client.__authenticated ? client.__sessionKey : this.globalKey;
        const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        parsed = JSON.parse(decrypt(raw, key));
      } else {
        parsed = JSON.parse(payload);
      }

      const { request, data } = parsed;

      // Built-in heartbeat — no handler needed
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
          client.send({ request, response, sessionKey: sessionKey.toString('base64') }, this.globalKey);
        } else {
          client.send({ request, response });
        }
        return;
      }

      client.send({ request, response });
    } catch (error) {
      log.socket(`Invalid payload from client`);
      if (config.debug) console.error(error);
      client.close();
    }
  }

  prepareSend(client) {
    const { send: socketSend } = client;
    const server = this;

    client.send = (payload, keyOverride) => {
      if (server.encryptionEnabled) {
        const key = keyOverride || client.__sessionKey;
        const data = encrypt(JSON.stringify(payload), key);
        socketSend.bind(client)(data);
      } else {
        socketSend.bind(client)(JSON.stringify(payload));
      }
    };
  }

  handleDisconnect(client) {
    const { ip } = client;
    log.socket(`[${ip}] Client disconnected`);
    this.clientMap.delete(client.id);
    this.onClientDisconnect?.(client);
  }

  sendTo(clientId, request, response) {
    const client = this.clientMap.get(clientId);
    if (!client) return;
    client.send({ request, response });
  }

  sendToByMeta(key, value, request, response) {
    for (const [, client] of this.clientMap) {
      if (client.meta?.[key] === value && client.__authenticated) {
        client.send({ request, response });
        return true;
      }
    }
    return false;
  }

  broadcast(request, response) {
    for (const [, client] of this.clientMap) {
      if (client.__authenticated) {
        client.send({ request, response });
      }
    }
  }

  close() {
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  reset() {
    this.close();
    this.clientMap.clear();
    this.handlers = {};
    clientId = 0;
    SocketServer.instance = null;
  }
}
