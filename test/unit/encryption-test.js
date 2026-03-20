import QUnit from 'qunit';
import { encrypt, decrypt, deriveKey, generateSessionKey } from '../../src/encryption.js';

const { module, test } = QUnit;

module('[Unit] Encryption', function () {

  test('deriveKey returns a 32-byte Buffer', function (assert) {
    const key = deriveKey('test-key');
    assert.ok(Buffer.isBuffer(key));
    assert.strictEqual(key.length, 32);
  });

  test('deriveKey is deterministic', function (assert) {
    const key1 = deriveKey('my-secret');
    const key2 = deriveKey('my-secret');
    assert.ok(key1.equals(key2));
  });

  test('deriveKey produces different keys for different inputs', function (assert) {
    const key1 = deriveKey('key-a');
    const key2 = deriveKey('key-b');
    assert.notOk(key1.equals(key2));
  });

  test('generateSessionKey returns a 32-byte Buffer', function (assert) {
    const key = generateSessionKey();
    assert.ok(Buffer.isBuffer(key));
    assert.strictEqual(key.length, 32);
  });

  test('generateSessionKey returns unique keys', function (assert) {
    const key1 = generateSessionKey();
    const key2 = generateSessionKey();
    assert.notOk(key1.equals(key2));
  });

  test('encrypt/decrypt round-trip with derived key', function (assert) {
    const key = deriveKey('test-auth-key');
    const message = JSON.stringify({ request: 'auth', data: { authKey: 'test' } });

    const encrypted = encrypt(message, key);
    assert.ok(Buffer.isBuffer(encrypted));
    assert.notStrictEqual(encrypted.toString('utf8'), message);

    const decrypted = decrypt(encrypted, key);
    assert.strictEqual(decrypted, message);
  });

  test('encrypt/decrypt round-trip with session key', function (assert) {
    const key = generateSessionKey();
    const message = 'hello world';

    const encrypted = encrypt(message, key);
    const decrypted = decrypt(encrypted, key);
    assert.strictEqual(decrypted, message);
  });

  test('decrypt fails with wrong key', function (assert) {
    const key1 = deriveKey('correct-key');
    const key2 = deriveKey('wrong-key');
    const message = 'secret data';

    const encrypted = encrypt(message, key1);

    assert.throws(() => {
      decrypt(encrypted, key2);
    }, /Unsupported state/);
  });

  test('encrypted output contains iv + tag + ciphertext', function (assert) {
    const key = deriveKey('test');
    const encrypted = encrypt('test', key);

    // IV (12) + Tag (16) + at least 1 byte of ciphertext
    assert.ok(encrypted.length >= 29);
  });
});
