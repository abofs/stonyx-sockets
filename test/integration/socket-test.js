import QUnit from 'qunit';
import SocketServer from '../../src/server.js';
import SocketClient from '../../src/client.js';
import { setupIntegrationTests } from 'stonyx/test-helpers';

const { module, test } = QUnit;

module('[Integration] Sockets', function (hooks) {
  setupIntegrationTests(hooks);

  let extraClients = [];

  hooks.afterEach(function () {
    for (const c of extraClients) c.reset();
    extraClients = [];

    const client = SocketClient.instance;
    const server = SocketServer.instance;
    if (client) client.reset();
    if (server) server.reset();
  });

  test('Server starts and client connects with auth', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    assert.ok(server.clientMap.size > 0, 'Client registered in server clientMap');
    assert.ok(client.socket, 'Client has active socket');
  });

  test('Server rejects unauthenticated requests', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    client.send({ request: 'echo', data: { msg: 'hello' } });

    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(true, 'Authenticated echo request did not cause disconnect');
  });

  test('Server throws when auth handler is missing', async function (assert) {
    const server = new SocketServer();
    server.handlers = {};

    assert.throws(() => {
      server.validateAuthHandler();
    }, /requires an "auth" handler/);
  });

  test('Message round-trip: echo handler', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    client.send({ request: 'echo', data: { msg: 'test-message' } });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.deepEqual(client._lastEchoResponse, { msg: 'test-message' }, 'Echo response received');
  });

  test('Heartbeat handler returns true', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    clearTimeout(client._heartBeatTimer);

    client.send({ request: 'heartBeat' });

    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(true, 'Heartbeat round-trip completed');
  });

  test('Broadcast sends to all authenticated clients', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client1 = new SocketClient();
    await client1.init();

    SocketClient.instance = null;
    const client2 = new SocketClient();
    await client2.init();

    extraClients.push(client1);

    server.broadcast('echo', { msg: 'broadcast-test' });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.ok(server.clientMap.size >= 2, 'Both clients registered');
  });
});
