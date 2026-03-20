import QUnit from 'qunit';
import sinon from 'sinon';
import SocketClient from '../../src/client.js';

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

    client.reset();

    assert.strictEqual(SocketClient.instance, null);
    assert.deepEqual(client.handlers, {});
    assert.strictEqual(client.sessionKey, null);
    assert.strictEqual(client.reconnectCount, 0);
  });
});
