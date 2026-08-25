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
    client.handlers = { echo: {} } as unknown as typeof client.handlers;
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
    client.socket = { close: sinon.stub(), removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;

    client.close();

    assert.true(client._intentionalClose);
    client.reset();
  });

  test('close() calls removeAllListeners + terminate and nulls socket (#41)', function (assert) {
    const client = new SocketClient();
    const removeAllListenersStub = sinon.stub();
    const terminateStub = sinon.stub();
    client.socket = { close: sinon.stub(), removeAllListeners: removeAllListenersStub, on: sinon.stub(), terminate: terminateStub } as unknown as typeof client.socket;

    client.close();

    assert.true(removeAllListenersStub.calledOnce, 'removeAllListeners called');
    assert.true(terminateStub.calledOnce, 'terminate called');
    assert.strictEqual(client.socket, null, 'socket nulled after close');
    client.reset();
  });

  test('connect() cleans up existing socket before creating new one (#41)', function (assert) {
    const client = new SocketClient();
    const removeAllListenersStub = sinon.stub();
    const onStub = sinon.stub();
    const terminateStub = sinon.stub();
    const oldSocket = { close: sinon.stub(), removeAllListeners: removeAllListenersStub, on: onStub, terminate: terminateStub } as unknown as typeof client.socket;
    client.socket = oldSocket;

    // connect() will create a real WebSocket; cleanup of the old socket happens synchronously first
    client.connect().catch(() => {});

    assert.true(removeAllListenersStub.calledOnce, 'removeAllListeners called on old socket');
    assert.true(terminateStub.calledOnce, 'terminate called on old socket');

    // Safe-close the real WebSocket that connect() just created so reset() doesn't throw
    if (client.socket && client.socket !== oldSocket) {
      client.socket.removeAllListeners();
      client.socket.on('error', () => {});
      client.socket.terminate();
      client.socket = null;
    }
    client.reset();
  });

  test('onClose calls onDisconnect hook', function (assert) {
    const client = new SocketClient();
    const spy = sinon.spy();
    client.onDisconnect = spy as typeof client.onDisconnect;
    client._intentionalClose = true;

    client.onClose();

    assert.true(spy.calledOnce);
    client.reset();
  });

  test('onClose passes close code and reason to onDisconnect', function (assert) {
    const client = new SocketClient();
    const spy = sinon.spy();
    client.onDisconnect = spy as typeof client.onDisconnect;
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
    client.onDisconnect = spy as typeof client.onDisconnect;
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
    client.onReconnecting = spy as typeof client.onReconnecting;
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
    client.onReconnected = spy as typeof client.onReconnected;
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
    client.onReconnectFailed = spy as typeof client.onReconnectFailed;

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

  test('onMessage resolves connect promise on auth response (regression: #31)', function (assert) {
    const client = new SocketClient();
    const resolveSpy = sinon.spy();
    client.promise = { resolve: resolveSpy as unknown as () => void, reject: sinon.stub() as unknown as (reason?: unknown) => void };
    client.encryptionEnabled = false;
    sinon.stub(client, 'nextHeartBeat');

    const authResponse = JSON.stringify({ request: 'auth', response: { authenticated: true } });
    client.onMessage(Buffer.from(authResponse));

    assert.true(resolveSpy.calledOnce, 'promise.resolve() called on auth');
    assert.strictEqual(client.promise, null, 'promise nulled after resolve');
    client.reset();
  });

  test('onMessage decrypts auth response with globalKey when sessionKey is null (regression: #12)', function (assert) {
    const client = new SocketClient();
    const globalKey = deriveKey('test-auth-key');
    const newSessionKey = generateSessionKey();

    client.encryptionEnabled = true;
    client.globalKey = globalKey;
    client.sessionKey = null;
    client.promise = { resolve: sinon.stub() as unknown as () => void, reject: sinon.stub() as unknown as (reason?: unknown) => void };
    sinon.stub(client, 'nextHeartBeat');

    const authResponse = { request: 'auth', response: { authenticated: true }, sessionKey: newSessionKey.toString('base64') };
    const encrypted = encrypt(JSON.stringify(authResponse), globalKey);

    client.onMessage(encrypted);

    assert.ok(client.sessionKey, 'sessionKey is set after auth');
    assert.ok(client.sessionKey!.equals(newSessionKey), 'sessionKey matches server-provided key');
    client.reset();
  });

  test('onMessage fails to decrypt auth response when stale sessionKey is set (proves bug: #12)', function (assert) {
    const client = new SocketClient();
    const globalKey = deriveKey('test-auth-key');
    const staleSessionKey = generateSessionKey();

    client.encryptionEnabled = true;
    client.globalKey = globalKey;
    client.sessionKey = staleSessionKey; // Stale key from previous connection
    client.promise = { resolve: sinon.stub() as unknown as () => void, reject: sinon.stub() as unknown as (reason?: unknown) => void };
    const nextHeartBeatStub = sinon.stub(client, 'nextHeartBeat');

    const authResponse = { request: 'auth', response: { authenticated: true }, sessionKey: generateSessionKey().toString('base64') };
    const encrypted = encrypt(JSON.stringify(authResponse), globalKey);

    // With stale sessionKey, decryption fails — caught as "Invalid payload"
    client.onMessage(encrypted);

    assert.deepEqual(client.sessionKey, staleSessionKey,
      'sessionKey remains the stale value — decryption failed');
    assert.false(nextHeartBeatStub.called,
      'nextHeartBeat was never called — auth handler never reached');
    client.reset();
  });

  test('nextHeartBeat schedules a response timeout after heartbeat is sent (#33)', function (assert) {
    const clock = (sinon as any).useFakeTimers();
    const client = new SocketClient();
    client.socket = { send: sinon.stub(), close: sinon.stub(), removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;
    client.encryptionEnabled = false;

    const { heartBeatInterval } = config.sockets;
    client.nextHeartBeat();

    // Advance past the heartbeat send timer
    clock.tick(heartBeatInterval);

    assert.notStrictEqual(client._heartBeatResponseTimer, null, 'response timeout is scheduled after heartbeat sent');
    clock.restore();
    client.reset();
  });

  test('response timeout fires socket.close() when no heartbeat response arrives (#33)', function (assert) {
    const clock = (sinon as any).useFakeTimers();
    const client = new SocketClient();
    const closeStub = sinon.stub();
    client.socket = { send: sinon.stub(), close: closeStub, removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;
    client.encryptionEnabled = false;

    const { heartBeatInterval } = config.sockets;
    client.nextHeartBeat();

    // Advance past heartbeat send + response timeout
    clock.tick(heartBeatInterval * 2);

    assert.true(closeStub.calledOnce, 'socket.close() called when response timeout fires');
    clock.restore();
    client.reset();
  });

  test('heartbeat response clears the response timeout (#33)', function (assert) {
    const clock = (sinon as any).useFakeTimers();
    const client = new SocketClient();
    client.socket = { send: sinon.stub(), close: sinon.stub(), removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;
    client.encryptionEnabled = false;

    const { heartBeatInterval } = config.sockets;
    client.nextHeartBeat();

    // Fire the heartbeat send
    clock.tick(heartBeatInterval);
    assert.notStrictEqual(client._heartBeatResponseTimer, null, 'response timer set after heartbeat');

    // Simulate server response — nextHeartBeat() is called again
    client.nextHeartBeat();
    assert.strictEqual(client._heartBeatResponseTimer, null, 'response timer cleared on heartbeat response');

    clock.restore();
    client.reset();
  });

  test('onClose clears the heartbeat response timeout (#33)', function (assert) {
    const clock = (sinon as any).useFakeTimers();
    const client = new SocketClient();
    client.socket = { send: sinon.stub(), close: sinon.stub(), removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;
    client.encryptionEnabled = false;
    client._intentionalClose = true;

    const { heartBeatInterval } = config.sockets;
    client.nextHeartBeat();
    clock.tick(heartBeatInterval);
    assert.notStrictEqual(client._heartBeatResponseTimer, null, 'response timer exists before onClose');

    client.onClose();

    assert.strictEqual(client._heartBeatResponseTimer, null, 'response timer cleared by onClose');
    clock.restore();
    client.reset();
  });

  test('close() clears the heartbeat response timeout (#33)', function (assert) {
    const clock = (sinon as any).useFakeTimers();
    const client = new SocketClient();
    client.socket = { send: sinon.stub(), close: sinon.stub(), removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;
    client.encryptionEnabled = false;

    const { heartBeatInterval } = config.sockets;
    client.nextHeartBeat();
    clock.tick(heartBeatInterval);
    assert.notStrictEqual(client._heartBeatResponseTimer, null, 'response timer exists before close');

    client.close();

    assert.strictEqual(client._heartBeatResponseTimer, null, 'response timer cleared by close()');
    clock.restore();
    client.reset();
  });

  test('heartbeat loop continues normally when responses arrive on time (#33)', function (assert) {
    const clock = (sinon as any).useFakeTimers();
    const client = new SocketClient();
    const sendStub = sinon.stub();
    client.socket = { send: sendStub, close: sinon.stub(), removeAllListeners: sinon.stub(), on: sinon.stub(), terminate: sinon.stub() } as unknown as typeof client.socket;
    client.encryptionEnabled = false;

    const { heartBeatInterval } = config.sockets;

    // First cycle
    client.nextHeartBeat();
    clock.tick(heartBeatInterval);
    assert.true(sendStub.calledOnce, 'first heartbeat sent');

    // Server responds — nextHeartBeat called again
    client.nextHeartBeat();
    assert.strictEqual(client._heartBeatResponseTimer, null, 'response timer cleared');

    // Second cycle
    clock.tick(heartBeatInterval);
    assert.strictEqual((sendStub as any).callCount, 2, 'second heartbeat sent');

    // Server responds again
    client.nextHeartBeat();
    assert.strictEqual(client._heartBeatResponseTimer, null, 'response timer cleared again');

    // No socket.close should have been called
    assert.false((client.socket!.close as any).called, 'socket.close never called during normal operation');

    clock.restore();
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

  test('init() does not call connect() when NODE_ENV=test', async function (assert) {
    const client = new SocketClient();
    const connectStub = sinon.stub(client, 'connect').resolves();
    sinon.stub(client, 'discoverHandlers').resolves();

    await client.init();

    assert.false(connectStub.called, 'connect() not called in test mode');
    client.reset();
  });

  module('fail-closed config guards (#39)', function (guardHooks) {
    let originalSockets: typeof config.sockets;

    guardHooks.beforeEach(function () {
      originalSockets = config.sockets;
    });

    guardHooks.afterEach(function () {
      (config as any).sockets = originalSockets;
    });

    test('init() throws when config.sockets.encryption is undefined', async function (assert) {
      const client = new SocketClient();
      (config as any).sockets = { handlerDir: '/some/path', encryption: undefined };

      try {
        await client.init();
        assert.ok(false, 'init() should have thrown');
      } catch (err) {
        assert.ok(
          /encryption is undefined/.test((err as Error).message),
          'throws descriptive error when encryption is undefined'
        );
      }
      client.reset();
    });

    test('init() throws when config.sockets.handlerDir is undefined', async function (assert) {
      const client = new SocketClient();
      (config as any).sockets = { handlerDir: undefined, encryption: false };

      try {
        await client.init();
        assert.ok(false, 'init() should have thrown');
      } catch (err) {
        assert.ok(
          /handlerDir is undefined/.test((err as Error).message),
          'throws descriptive error when handlerDir is undefined'
        );
      }
      client.reset();
    });

    test('init() does not throw when encryption is explicitly false', async function (assert) {
      const client = new SocketClient();
      sinon.stub(client, 'discoverHandlers').resolves();

      (config as any).sockets = { ...originalSockets, encryption: false, handlerDir: '/some/path' };

      try {
        await client.init();
        assert.ok(true, 'guard did not throw for encryption=false');
      } catch (err) {
        const msg = (err as Error).message;
        assert.notOk(
          /encryption is undefined/.test(msg),
          'error is not about encryption being undefined'
        );
        assert.notOk(
          /handlerDir is undefined/.test(msg),
          'error is not about handlerDir being undefined'
        );
      }
      client.reset();
    });

    test('init() does not throw when encryption is explicitly true', async function (assert) {
      const client = new SocketClient();
      sinon.stub(client, 'discoverHandlers').resolves();

      (config as any).sockets = { ...originalSockets, encryption: true, authKey: 'test-key', handlerDir: '/some/path' };

      try {
        await client.init();
        assert.ok(true, 'guard did not throw for encryption=true');
      } catch (err) {
        const msg = (err as Error).message;
        assert.notOk(
          /encryption is undefined/.test(msg),
          'error is not about encryption being undefined'
        );
        assert.notOk(
          /handlerDir is undefined/.test(msg),
          'error is not about handlerDir being undefined'
        );
      }
      client.reset();
    });
  });

  module('camelCase dispatch normalization (#37)', function () {
    test('dispatches kebab-case request to camelCased handler', function (assert) {
      const client = new SocketClient();
      client.encryptionEnabled = false;
      const spy = sinon.spy();
      client.handlers = {
        testHandler: { client: spy } as unknown as typeof client.handlers[string],
      };

      client.onMessage(Buffer.from(JSON.stringify({ request: 'test-handler', response: 'ok' })));

      assert.true(spy.calledOnce, 'handler.client called for kebab-case request');
      client.reset();
    });

    test('dispatches camelCase request directly (backward compat)', function (assert) {
      const client = new SocketClient();
      client.encryptionEnabled = false;
      const spy = sinon.spy();
      client.handlers = {
        testHandler: { client: spy } as unknown as typeof client.handlers[string],
      };

      client.onMessage(Buffer.from(JSON.stringify({ request: 'testHandler', response: 'ok' })));

      assert.true(spy.calledOnce, 'handler.client called for camelCase request');
      client.reset();
    });

    test('dispatches single-word request without regression', function (assert) {
      const client = new SocketClient();
      client.encryptionEnabled = false;
      const spy = sinon.spy();
      client.handlers = {
        echo: { client: spy } as unknown as typeof client.handlers[string],
      };

      client.onMessage(Buffer.from(JSON.stringify({ request: 'echo', response: 'pong' })));

      assert.true(spy.calledOnce, 'handler.client called for single-word request');
      client.reset();
    });

    test('does not dispatch nonExistent request', function (assert) {
      const client = new SocketClient();
      client.encryptionEnabled = false;
      const spy = sinon.spy();
      client.handlers = {
        echo: { client: spy } as unknown as typeof client.handlers[string],
      };

      client.onMessage(Buffer.from(JSON.stringify({ request: 'nonExistent', response: 'x' })));

      assert.false(spy.called, 'handler.client not called for unknown request');
      client.reset();
    });
  });
});
