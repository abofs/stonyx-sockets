import Handler from '@stonyx/sockets/handler';
import config from 'stonyx/config';

interface AuthData {
  authKey: string;
  [key: string]: unknown;
}

interface AuthClient {
  id: number;
  close(): void;
}

export default class AuthHandler extends Handler {
  static skipAuth = true;

  declare _serverRef: { clientMap: Map<number, AuthClient> };

  server(data: AuthData, client: AuthClient): string | void {
    if (data.authKey !== config.sockets.authKey) return client.close();

    this._serverRef.clientMap.set(client.id, client);
    return 'success';
  }

  client(response: unknown): void {
    const ctx = this as unknown as { client: { promise: { resolve: () => void; reject: (reason?: unknown) => void } } };
    if (response !== 'success') ctx.client.promise.reject(response);

    ctx.client.promise.resolve();
  }
}
