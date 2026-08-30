// Local decoy WebSocket listener for stonyx-sockets#45.
//
// Stands in for the "live external host" that SOCKET_ADDRESS pointed at. It is
// bound to 127.0.0.1 on an ephemeral port and is entirely under this suite's
// control -- nothing here ever contacts a real remote host.
//
// It records every connection and every frame received so a test can assert
// that the suite made ZERO contact with it. Recording frames (not just
// connections) is what lets the guard speak to the safety dimension of #45:
// the first frame the client sends is the plain-UTF8 auth frame carrying
// `config.sockets.authKey`.
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'net';

export interface Decoy {
  port: number;
  address: string;
  connections: number;
  frames: string[];
  close: () => Promise<void>;
}

export async function startDecoy(): Promise<Decoy> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });

  const decoy: Decoy = {
    port: 0,
    address: '',
    connections: 0,
    frames: [],
    close: () => new Promise<void>(resolve => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => resolve());
    }),
  };

  wss.on('connection', function (socket: WebSocket) {
    decoy.connections += 1;
    socket.on('message', function (raw: Buffer | string) {
      decoy.frames.push(raw.toString());
    });
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  decoy.port = (wss.address() as AddressInfo).port;
  decoy.address = `ws://127.0.0.1:${decoy.port}`;

  return decoy;
}

/** Find a free TCP port so a subprocess suite can bind without colliding with the outer run. */
export async function freePort(): Promise<number> {
  const { createServer } = await import('net');
  const srv = createServer();
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>(resolve => srv.close(() => resolve()));
  return port;
}
