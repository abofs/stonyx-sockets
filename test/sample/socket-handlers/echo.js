import Handler from '../../../src/handler.js';

export default class EchoHandler extends Handler {
  server(data) {
    return data;
  }

  client(response) {
    this.client._lastEchoResponse = response;
  }
}
