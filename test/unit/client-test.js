import QUnit from 'qunit';
import sinon from 'sinon';
import config from 'stonyx/config';
import SocketClient from '../../src/client.js';
import { encrypt, generateSessionKey, deriveKey } from '../../src/encryption.js';

const { module, test } = QUnit;

module('[Unit] SocketClient', function (hooks) {
  hooks.afterEach(function () {
    const client = SocketClient.instance;
    if (client) client.reset();
    sinon.restore();
  });

  test('Singleton pattern: returns same instance', function (assert) {
    const client1 = new SocketClient();
    const client2 = new SocketClient();
    assert.strictEqual(client1, client2);
    client1.reset();
  });

  test('reset() clears instance and state', function (assert) {
    const client = new SocketClient();
    client.handlers = { echo: {} };
    client.sessionKey = Buffer.alloc(32);
    client.reconnectCount = 3;
    client._intentionalClose = true;
    client.onDisconnect = () => {};
    client.onReconnecting = () => {};
    client.onReconnected = () => {};
    client.onReconnectFailed = () => {};

    client.reset();

    assert.strictEqual(SocketClient.instance, null);
    assert.deepEqual(client.handlers, {});
    assert.strictEqual(client.sessionKey, null);
    assert.strictEqual(client.reconnectCount, 0);
    assert.false(client._intentionalClose);
    assert.strictEqual(client.onDisconnect, null);
    assert.strictEqual(client.onReconnecting, null);
    assert.strictEqual(client.onReconnected, null);
    assert.strictEqual(client.onReconnectFailed, null);
  });

  test('getReconnectDelay returns exponential backoff with jitter', function (assert) {
    const client = new SocketClient();
    const baseDelay = config.sockets.reconnectBaseDelay;
    client.reconnectCount = 1;

    const delay = client.getReconnectDelay();

    assert.true(delay >= baseDelay, `delay >= base delay (${baseDelay})`);
    assert.true(delay <= baseDelay + 1000, `delay <= base delay + max jitter`);
    client.reset();
  });

  test('getReconnectDelay caps at maxDelay', function (assert) {
    const client = new SocketClient();
    const maxDelay = config.sockets.reconnectMaxDelay;
    client.reconnectCount = 20;

    const delay = client.getReconnectDelay();

    assert.true(delay <= maxDelay + 1000, `delay <= maxDelay + max jitter`);
    client.reset();
  });

  test('close() sets _intentionalClose flag', function (assert) {
    const client = new SocketClient();
    client.socket = { close: sinon.stub() };

    client.close();

    assert.true(client._intentionalClose);
    client.reset();
  });

  test('onClose calls onDisconnect hook', function (assert) {
    const client = new SocketClient();
    const spy = sinon.spy();
    client.onDisconnect = spy;
    client._intentionalClose = true;

    client.onClose();

    assert.true(spy.calledOnce);
    client.reset();
  });

  test('onClose passes close code and reason to onDisconnect', function (assert) {
    const client = new SocketClient();
    const spy = sinon.spy();
    client.onDisconnect = spy;
    client._intentionalClose = true;

    client.onClose(1001, 'server restart');

    assert.true(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[0], 1001, 'code passed to onDisconnect');
    assert.strictEqual(spy.firstCall.args[1], 'server restart', 'reason passed to onDisconnect');
    client.reset();
  });

  test('onClose defaults code to 1006 and reason to empty string when not provided', function (assert) {
    const client = new SocketClient();
    const spy = sinon.spy();
    client.onDisconnect = spy;
    client._intentionalClose = true;

    client.onClose();

    assert.true(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[0], 1006, 'code defaults to 1006');
    assert.strictEqual(spy.firstCall.args[1], '', 'reason defaults to empty string');
    client.reset();
  });

  test('onClose does not auto-reconnect when _intentionalClose is true', function (assert) {
    const client = new SocketClient();
    client._intentionalClose = true;
    const reconnectStub = sinon.stub(client, 'reconnect');

    client.onClose();

    assert.false(reconnectStub.called);
    client.reset();
  });

  test('onClose triggers reconnect when not intentional', function (assert) {
    const client = new SocketClient();
    client._intentionalClose = false;
    const reconnectStub = sinon.stub(client, 'reconnect');

    client.onClose();

    assert.true(reconnectStub.calledOnce);
    client.reset();
  });

  test('reconnect calls onReconnecting with attempt and delay', async function (assert) {
    const originalMax = config.sockets.maxReconnectAttempts;
    config.sockets.maxReconnectAttempts = 5;

    const client = new SocketClient();
    const spy = sinon.spy();
    client.onReconnecting = spy;
    sinon.stub(client, 'connect').rejects('fail');
    sinon.stub(client, 'getReconnectDelay').returns(0);
    client._intentionalClose = true;

    await client.reconnect();

    assert.true(spy.calledOnce);
    assert.strictEqual(spy.firstCall.args[0], 1);
    assert.strictEqual(spy.firstCall.args[1], 0);

    config.sockets.maxReconnectAttempts = originalMax;
    client.reset();
  });

  test('reconnect calls onReconnected on success', async function (assert) {
    const originalMax = config.sockets.maxReconnectAttempts;
    config.sockets.maxReconnectAttempts = 5;

    const client = new SocketClient();
    const spy = sinon.spy();
    client.onReconnected = spy;
    sinon.stub(client, 'connect').resolves();
    sinon.stub(client, 'getReconnectDelay').returns(0);
    client._intentionalClose = true;

    await client.reconnect();

    assert.true(spy.calledOnce);

    config.sockets.maxReconnectAttempts = originalMax;
    client.reset();
  });

  test('reconnect calls onReconnectFailed when max attempts exceeded', async function (assert) {
    const client = new SocketClient();
    const spy = sinon.spy();
    client.onReconnectFailed = spy;

    await client.reconnect();

    assert.true(spy.calledOnce);
    client.reset();
  });

  test('connect() clears stale sessionKey (regression: #12)', function (assert) {
    const client = new SocketClient();
    const staleKey = generateSessionKey();
    client.sessionKey = staleKey;

    // connect() clears sessionKey synchronously before creating the WebSocket
    client.connect().catch(() => {}); // Rejects — no real server

    assert.strictEqual(client.sessionKey, null, 'sessionKey is null after connect() starts');
    assert.ok(staleKey, 'sessionKey was set before connect()');
    client.reset();
  });

  test('onMessage decrypts auth response with globalKey when sessionKey is null (regression: #12)', function (assert) {
    const client = new SocketClient();
    const globalKey = deriveKey('test-auth-key');
    const newSessionKey = generateSessionKey();

    client.encryptionEnabled = true;
    client.globalKey = globalKey;
    client.sessionKey = null;
    client.promise = { resolve: sinon.stub(), reject: sinon.stub() };
    sinon.stub(client, 'nextHeartBeat');

    const authResponse = { request: 'auth', response: { authenticated: true }, sessionKey: newSessionKey.toString('base64') };
    const encrypted = encrypt(JSON.stringify(authResponse), globalKey);

    client.onMessage(encrypted);

    assert.ok(client.sessionKey, 'sessionKey is set after auth');
    assert.ok(client.sessionKey.equals(newSessionKey), 'sessionKey matches server-provided key');
    client.reset();
  });

  test('onMessage fails to decrypt auth response when stale sessionKey is set (proves bug: #12)', function (assert) {
    const client = new SocketClient();
    const globalKey = deriveKey('test-auth-key');
    const staleSessionKey = generateSessionKey();

    client.encryptionEnabled = true;
    client.globalKey = globalKey;
    client.sessionKey = staleSessionKey; // Stale key from previous connection
    client.promise = { resolve: sinon.stub(), reject: sinon.stub() };
    sinon.stub(client, 'nextHeartBeat');

    const authResponse = { request: 'auth', response: { authenticated: true }, sessionKey: generateSessionKey().toString('base64') };
    const encrypted = encrypt(JSON.stringify(authResponse), globalKey);

    // With stale sessionKey, decryption fails — caught as "Invalid payload"
    client.onMessage(encrypted);

    assert.deepEqual(client.sessionKey, staleSessionKey,
      'sessionKey remains the stale value — decryption failed');
    assert.false(client.nextHeartBeat.called,
      'nextHeartBeat was never called — auth handler never reached');
    client.reset();
  });

  test('connect() clears sessionKey even when encryption is disabled (regression: #12)', function (assert) {
    const client = new SocketClient();
    client.sessionKey = generateSessionKey();
    client.encryptionEnabled = false;

    client.connect().catch(() => {}); // Rejects — no real server

    assert.strictEqual(client.sessionKey, null, 'sessionKey is null regardless of encryption state');
    client.reset();
  });
});
