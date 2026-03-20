import QUnit from 'qunit';
import sinon from 'sinon';
import SocketServer from '../../src/server.js';

const { module, test } = QUnit;

module('[Unit] SocketServer', function (hooks) {
  hooks.afterEach(function () {
    const server = SocketServer.instance;
    if (server) server.reset();
    sinon.restore();
  });

  test('Singleton pattern: returns same instance', function (assert) {
    const server1 = new SocketServer();
    const server2 = new SocketServer();
    assert.strictEqual(server1, server2);
    server1.reset();
  });

  test('reset() clears instance and state', function (assert) {
    const server = new SocketServer();
    server.handlers = { auth: {} };
    server.clientMap.set(1, {});

    server.reset();

    assert.strictEqual(SocketServer.instance, null);
    assert.deepEqual(server.handlers, {});
    assert.strictEqual(server.clientMap.size, 0);
  });

  test('validateAuthHandler throws when no auth handler', function (assert) {
    const server = new SocketServer();
    server.handlers = {};

    assert.throws(() => {
      server.validateAuthHandler();
    }, /requires an "auth" handler/);

    server.reset();
  });

  test('validateAuthHandler does not throw when auth handler exists', function (assert) {
    const server = new SocketServer();
    server.handlers = { auth: { server() { return 'success'; } } };

    server.validateAuthHandler();
    assert.ok(true, 'No error thrown');

    server.reset();
  });

  test('handleDisconnect removes client from clientMap', function (assert) {
    const server = new SocketServer();
    const client = { id: 5, ip: '127.0.0.1' };
    server.clientMap.set(5, client);

    server.handleDisconnect(client);

    assert.strictEqual(server.clientMap.size, 0);
    server.reset();
  });

  test('broadcast sends to all authenticated clients', function (assert) {
    const server = new SocketServer();
    const sent = [];

    const client1 = { __authenticated: true, send: msg => sent.push({ id: 1, msg }) };
    const client2 = { __authenticated: false, send: msg => sent.push({ id: 2, msg }) };
    const client3 = { __authenticated: true, send: msg => sent.push({ id: 3, msg }) };

    server.clientMap.set(1, client1);
    server.clientMap.set(2, client2);
    server.clientMap.set(3, client3);

    server.broadcast('test', { data: 'hello' });

    assert.strictEqual(sent.length, 2);
    assert.deepEqual(sent[0].msg, { request: 'test', data: { data: 'hello' } });
    assert.deepEqual(sent[1].msg, { request: 'test', data: { data: 'hello' } });

    server.reset();
  });

  test('sendTo sends to specific client by id', function (assert) {
    const server = new SocketServer();
    let received = null;

    const client = { send: msg => { received = msg; } };
    server.clientMap.set(42, client);

    server.sendTo(42, 'update', { score: 100 });

    assert.deepEqual(received, { request: 'update', data: { score: 100 } });

    server.reset();
  });

  test('sendTo does nothing for non-existent client', function (assert) {
    const server = new SocketServer();
    server.sendTo(999, 'update', {});
    assert.ok(true, 'No error thrown');
    server.reset();
  });
});
