import Handler from '@stonyx/sockets/handler';

export default class EchoHandler extends Handler {
  server(data: unknown): unknown {
    return data;
  }

  client(response: unknown): void {
    const ctx = this as unknown as { client: { _lastEchoResponse: unknown } };
    ctx.client._lastEchoResponse = response;
  }
}
