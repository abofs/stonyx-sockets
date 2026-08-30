// Local decoy WebSocket listener for stonyx-sockets#45.
//
// Stands in for the "live external host" that SOCKET_ADDRESS pointed at. It is
// bound to 127.0.0.1 on an ephemeral port and is entirely under this suite's
// control -- nothing here ever contacts a real remote host.
//
// It records contact at THREE layers so a test can assert that the suite made
// ZERO contact with it, and so a green assertion means what it says:
//
//   tcpConnections -- a TCP socket was accepted. This is the layer the leak is
//                     at: dialling a foreign host is contact whether or not the
//                     WebSocket handshake ever completes.
//   connections    -- a WebSocket upgrade completed.
//   frames         -- payload was received. The first frame the client sends is
//                     the plain-UTF8 auth frame carrying `config.sockets.authKey`,
//                     so this is the layer credential DISCLOSURE happens at.
//
// WHY TCP IS COUNTED SEPARATELY, AND WHY IT IS THE ONE THAT MATTERS FOR A4
// --------------------------------------------------------------------------
// This listener used to expose `connections` alone, incremented on
// `wss.on('connection')` -- a COMPLETED upgrade. `test/unit/client-test.ts`
// calls `connect()` and tears the socket down immediately (that is the point of
// the #41 test), so its TCP connection to the foreign host frequently completes
// while the upgrade does not. Measured over three runs of exactly the scenario
// A4 exists for: `tcp=1 wsHandshakes=0`, `tcp=1 wsHandshakes=0`,
// `tcp=0 wsHandshakes=0`.
//
// So A4 -- which was just re-pointed at `client-test.ts` precisely because that
// is the file that dials -- would have gone GREEN on two of three runs that did
// dial out, and its red state was race-dependent for the very file it was
// extended to cover. Fixing the guard's target exposed that its instrument was
// calibrated one layer too high. The credential itself only leaves after the
// upgrade, so disclosure was still detected; "opens zero connections to the
// foreign host" was not.
//
// The `WebSocketServer` is therefore attached to an `http.Server` rather than
// owning the port, because that is the object that can see a TCP accept.
import { createServer, type Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'net';

export interface Decoy {
  port: number;
  address: string;
  /** TCP sockets accepted -- contact, whether or not it became a WebSocket. */
  tcpConnections: number;
  /** WebSocket upgrades completed. */
  connections: number;
  frames: string[];
  close: () => Promise<void>;
}

export async function startDecoy(): Promise<Decoy> {
  const server: Server = createServer();
  const wss = new WebSocketServer({ server });

  const decoy: Decoy = {
    port: 0,
    address: '',
    tcpConnections: 0,
    connections: 0,
    frames: [],
    close: () => new Promise<void>(resolve => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => server.close(() => resolve()));
    }),
  };

  // The TCP layer. Fires on accept, before any HTTP request or upgrade, so it
  // sees a dial that is torn down mid-handshake.
  server.on('connection', function () {
    decoy.tcpConnections += 1;
  });

  wss.on('connection', function (socket: WebSocket) {
    decoy.connections += 1;
    socket.on('message', function (raw: Buffer | string) {
      decoy.frames.push(raw.toString());
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(0, '127.0.0.1');
  });

  decoy.port = (server.address() as AddressInfo).port;
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
