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
    server.handlers = { auth: {} } as unknown as typeof server.handlers;
    server.clientMap.set(1, {} as unknown as Parameters<typeof server.clientMap.set>[1]);

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
    server.handlers = { auth: { server() { return 'success'; } } } as unknown as typeof server.handlers;

    server.validateAuthHandler();
    assert.ok(true, 'No error thrown');

    server.reset();
  });

  test('handleDisconnect removes client from clientMap', function (assert) {
    const server = new SocketServer();
    const client = { id: 5, ip: '127.0.0.1' } as Parameters<typeof server.handleDisconnect>[0];
    server.clientMap.set(5, client);

    server.handleDisconnect(client);

    assert.strictEqual(server.clientMap.size, 0);
    server.reset();
  });

  test('handleDisconnect calls onClientDisconnect hook', function (assert) {
    const server = new SocketServer();
    const spy = sinon.spy();
    server.onClientDisconnect = spy as typeof server.onClientDisconnect;
    const client = { id: 5, ip: '127.0.0.1' } as Parameters<typeof server.handleDisconnect>[0];
    server.clientMap.set(5, client);

    server.handleDisconnect(client);

    assert.true(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[0], client);
    server.reset();
  });

  test('handleDisconnect passes close code and reason to onClientDisconnect', function (assert) {
    const server = new SocketServer();
    const spy = sinon.spy();
    server.onClientDisconnect = spy as typeof server.onClientDisconnect;
    const client = { id: 6, ip: '127.0.0.1' } as Parameters<typeof server.handleDisconnect>[0];
    server.clientMap.set(6, client);

    server.handleDisconnect(client, 1001, 'server restart');

    assert.true(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[0], client, 'client passed');
    assert.strictEqual(spy.firstCall.args[1], 1001, 'code passed');
    assert.strictEqual(spy.firstCall.args[2], 'server restart', 'reason passed');
    server.reset();
  });

  test('handleDisconnect defaults code to 1006 and reason to empty string when not provided', function (assert) {
    const server = new SocketServer();
    const spy = sinon.spy();
    server.onClientDisconnect = spy as typeof server.onClientDisconnect;
    const client = { id: 7, ip: '127.0.0.1' } as Parameters<typeof server.handleDisconnect>[0];
    server.clientMap.set(7, client);

    server.handleDisconnect(client);

    assert.true(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[1], 1006, 'code defaults to 1006');
    assert.strictEqual(spy.firstCall.args[2], '', 'reason defaults to empty string');
    server.reset();
  });

  test('broadcast sends to all authenticated clients', function (assert) {
    const server = new SocketServer();
    const sent: { id: number; msg: unknown }[] = [];

    type MockClient = Parameters<typeof server.clientMap.set>[1];
    const client1 = { __authenticated: true, send: (msg: unknown) => sent.push({ id: 1, msg }) } as unknown as MockClient;
    const client2 = { __authenticated: false, send: (msg: unknown) => sent.push({ id: 2, msg }) } as unknown as MockClient;
    const client3 = { __authenticated: true, send: (msg: unknown) => sent.push({ id: 3, msg }) } as unknown as MockClient;

    server.clientMap.set(1, client1);
    server.clientMap.set(2, client2);
    server.clientMap.set(3, client3);

    server.broadcast('test', { data: 'hello' });

    assert.strictEqual(sent.length, 2);
    assert.deepEqual(sent[0].msg, { request: 'test', response: { data: 'hello' } });
    assert.deepEqual(sent[1].msg, { request: 'test', response: { data: 'hello' } });

    server.reset();
  });

  test('sendTo sends to specific client by id', function (assert) {
    const server = new SocketServer();
    let received: unknown = null;

    type MockClient = Parameters<typeof server.clientMap.set>[1];
    const client = { send: (msg: unknown) => { received = msg; } } as unknown as MockClient;
    server.clientMap.set(42, client);

    server.sendTo(42, 'update', { score: 100 });

    assert.deepEqual(received, { request: 'update', response: { score: 100 } });

    server.reset();
  });

  test('sendTo does nothing for non-existent client', function (assert) {
    const server = new SocketServer();
    server.sendTo(999, 'update', {});
    assert.ok(true, 'No error thrown');
    server.reset();
  });

  test('sendToByMeta sends to client matching meta key/value', function (assert) {
    const server = new SocketServer();
    let received: unknown = null;

    type MockClient = Parameters<typeof server.clientMap.set>[1];
    const client = {
      __authenticated: true,
      meta: { agent: 'Trix' },
      send: (msg: unknown) => { received = msg; },
    } as unknown as MockClient;
    server.clientMap.set(1, client);

    const result = server.sendToByMeta('agent', 'Trix', 'dispatch', { text: 'hello' });

    assert.true(result);
    assert.deepEqual(received, { request: 'dispatch', response: { text: 'hello' } });
    server.reset();
  });

  test('sendToByMeta returns false when no match', function (assert) {
    const server = new SocketServer();

    type MockClient = Parameters<typeof server.clientMap.set>[1];
    const client = {
      __authenticated: true,
      meta: { agent: 'Bee' },
      send: sinon.stub(),
    } as unknown as MockClient;
    server.clientMap.set(1, client);

    const result = server.sendToByMeta('agent', 'Trix', 'dispatch', {});

    assert.false(result);
    assert.false((client.send as unknown as { called: boolean }).called);
    server.reset();
  });

  test('sendToByMeta skips unauthenticated clients', function (assert) {
    const server = new SocketServer();

    type MockClient = Parameters<typeof server.clientMap.set>[1];
    const client = {
      __authenticated: false,
      meta: { agent: 'Trix' },
      send: sinon.stub(),
    } as unknown as MockClient;
    server.clientMap.set(1, client);

    const result = server.sendToByMeta('agent', 'Trix', 'dispatch', {});

    assert.false(result);
    assert.false((client.send as unknown as { called: boolean }).called);
    server.reset();
  });

  test('sendToByMeta handles clients without meta', function (assert) {
    const server = new SocketServer();

    type MockClient = Parameters<typeof server.clientMap.set>[1];
    const client = { __authenticated: true, send: sinon.stub() } as unknown as MockClient;
    server.clientMap.set(1, client);

    const result = server.sendToByMeta('agent', 'Trix', 'dispatch', {});

    assert.false(result);
    server.reset();
  });
});
