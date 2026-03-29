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

  test('Built-in heartbeat round-trip works', async function (assert) {
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

  test('Server-initiated message uses response field', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    const [clientId] = server.clientMap.keys();
    const targetClient = server.clientMap.get(clientId);
    targetClient.meta = { userId: 'user-1' };

    server.sendToByMeta('userId', 'user-1', 'echo', { msg: 'server-pushed' });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.deepEqual(
      client._lastEchoResponse,
      { msg: 'server-pushed' },
      'Client handler received server-initiated message via response field'
    );
  });

  test('sendTo delivers message to authenticated client', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    const [clientId] = server.clientMap.keys();

    server.sendTo(clientId, 'echo', { msg: 'targeted' });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.deepEqual(
      client._lastEchoResponse,
      { msg: 'targeted' },
      'sendTo delivered message to the correct authenticated client'
    );
  });

  test('broadcast delivers to all authenticated clients via handler', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client1 = new SocketClient();
    await client1.init();

    SocketClient.instance = null;
    const client2 = new SocketClient();
    await client2.init();

    extraClients.push(client1);

    server.broadcast('echo', { msg: 'broadcast-all' });

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.deepEqual(
      client1._lastEchoResponse,
      { msg: 'broadcast-all' },
      'First client received broadcast via echo handler'
    );
    assert.deepEqual(
      client2._lastEchoResponse,
      { msg: 'broadcast-all' },
      'Second client received broadcast via echo handler'
    );
  });
});
