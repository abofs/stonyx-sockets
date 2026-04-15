import QUnit from 'qunit';
import Handler from '../../src/handler.js';

const { module, test } = QUnit;

module('[Unit] Handler', function () {

  test('Handler has skipAuth defaulting to false', function (assert) {
    assert.strictEqual(Handler.skipAuth, false);
  });

  test('Handler can be instantiated', function (assert) {
    const handler = new Handler();
    assert.ok(handler instanceof Handler);
  });

  test('Handler subclass can override skipAuth', function (assert) {
    class AuthHandler extends Handler {
      static skipAuth = true;
    }

    assert.strictEqual(AuthHandler.skipAuth, true);
    assert.strictEqual(Handler.skipAuth, false, 'Base class not affected');
  });

  test('Handler subclass can define server() method', function (assert) {
    class TestHandler extends Handler {
      override server = (data: unknown): unknown => data;
    }

    const instance = new TestHandler();
    assert.strictEqual(typeof instance.server, 'function');
    assert.deepEqual(instance.server!({ foo: 'bar' }), { foo: 'bar' });
  });

  test('Handler subclass can define client() method', function (assert) {
    class TestHandler extends Handler {
      override client = (response: unknown): void => { void response; };
    }

    const instance = new TestHandler();
    assert.strictEqual(typeof instance.client, 'function');
    instance.client!('ok');
    assert.ok(true, 'client() method callable');
  });

  test('Handler base class has no server() or client() methods', function (assert) {
    const instance = new Handler();
    assert.strictEqual(instance.server, undefined);
    assert.strictEqual(instance.client, undefined);
  });
});
