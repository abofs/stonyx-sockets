import Handler from '../../../src/handler.js';
import config from 'stonyx/config';

export default class AuthHandler extends Handler {
  static skipAuth = true;

  server(data, client) {
    if (data.authKey !== config.sockets.authKey) return client.close();

    this._serverRef.clientMap.set(client.id, client);
    return 'success';
  }

  client(response) {
    if (response !== 'success') this.client.promise.reject(response);

    this.client.nextHeartBeat();
    this.client.promise.resolve();
  }
}
