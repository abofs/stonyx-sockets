import Handler from '@stonyx/sockets/handler';

export default class EchoHandler extends Handler {
  server(data) {
    return data;
  }

  client(response) {
    this.client._lastEchoResponse = response;
  }
}
