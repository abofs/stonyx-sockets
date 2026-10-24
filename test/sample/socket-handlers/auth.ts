import { timingSafeEqual } from 'node:crypto';
import Handler from '@stonyx/sockets/handler';
import config from 'stonyx/config';

interface AuthClient {
  id: number;
  close(): void;
}

interface AuthServerContext {
  _serverRef: { clientMap: Map<number, AuthClient> };
}

interface AuthClientContext {
  client: { promise: { resolve: () => void; reject: (reason?: unknown) => void } };
}

// Constant-time comparison of the shared secret. A length mismatch is
// rejected before timingSafeEqual, which throws on unequal lengths.
function authKeyMatches(given: unknown): boolean {
  const { authKey } = (config as { sockets: { authKey?: unknown } }).sockets;
  if (typeof authKey !== 'string' || authKey === '' || typeof given !== 'string') return false;

  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(authKey);
  return givenBuffer.length === expectedBuffer.length && timingSafeEqual(givenBuffer, expectedBuffer);
}

export default class AuthHandler extends Handler {
  static skipAuth = true;

  // Hooks are function-valued properties (not methods) so they match the
  // published Handler type. Use `function`, not an arrow: the client hook is
  // invoked with `this` bound to a context whose `client` is the SocketClient.
  server = function (this: AuthServerContext, data: unknown, client: unknown): string | void {
    const authClient = client as AuthClient;
    const { authKey } = (data ?? {}) as { authKey?: unknown };
    if (!authKeyMatches(authKey)) return authClient.close();

    this._serverRef.clientMap.set(authClient.id, authClient);
    return 'success';
  };

  client = function (this: AuthClientContext, response: unknown): void {
    if (response !== 'success') return this.client.promise.reject(response);

    this.client.promise.resolve();
  };
}
