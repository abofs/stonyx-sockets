import Handler from '@stonyx/sockets/handler';

interface EchoClientContext {
  client: { _lastEchoResponse: unknown };
}

export default class EchoHandler extends Handler {
  server = function (data: unknown): unknown {
    return data;
  };

  client = function (this: EchoClientContext, response: unknown): void {
    this.client._lastEchoResponse = response;
  };
}
