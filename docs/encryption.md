# Encryption

## Overview

Encryption is enabled by default (`SOCKET_ENCRYPTION=true`). All message encryption uses Node.js native `crypto` with zero external dependencies.

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **IV:** 12 bytes (GCM recommended)
- **Auth tag:** 16 bytes
- **Key size:** 256-bit (32 bytes)

## Key Derivation

The user-provided `authKey` string (from config) is run through `crypto.scryptSync` to derive a proper 32-byte AES key:

```javascript
export function deriveKey(authKey) {
  return crypto.scryptSync(authKey, 'stonyx-sockets', 32);
}
```

This ensures even short/weak auth key strings produce valid 256-bit encryption keys. The salt `'stonyx-sockets'` is fixed (deterministic derivation).

## Wire Format

Encrypted messages are sent as binary buffers:

```
[ IV (12 bytes) ][ Auth Tag (16 bytes) ][ Ciphertext (variable) ]
```

## Handshake Flow

1. Client connects and sends the `auth` request encrypted with the **global key** (derived from `authKey`)
2. Server decrypts using the global key, validates credentials via the auth handler
3. Server generates a **per-session key** (`crypto.randomBytes(32)`) for this client
4. Server responds with auth success + the session key (base64-encoded), encrypted with the global key
5. Client stores the session key
6. **All subsequent messages** (both directions) use the per-session key

### Key usage by message type

| Message | Encrypt with | Decrypt with |
|---------|-------------|-------------|
| Auth request (client → server) | Global key | Global key |
| Auth response (server → client) | Global key | Global key |
| All other messages | Session key | Session key |

## Functions (src/encryption.ts)

### `encrypt(data, key) → Buffer`

Encrypts a UTF-8 string using AES-256-GCM. Returns `Buffer` of `iv + tag + ciphertext`.

### `decrypt(buffer, key) → string`

Decrypts a buffer (or base64 string) back to UTF-8. Throws on tampered data or wrong key.

### `generateSessionKey() → Buffer`

Returns `crypto.randomBytes(32)` — a random 256-bit key for per-session encryption.

### `deriveKey(authKey) → Buffer`

Derives a 32-byte key from a string using `scryptSync`.

## Integration Points

### Server (src/server.ts)

- `init()`: If encryption enabled, derives `this.globalKey` from `config.sockets.authKey`
- `prepareSend(client)`: Wraps `client.send()` to encrypt with the client's session key (or a key override for auth)
- `onMessage()`: Decrypts with session key (or global key for unauthenticated clients)
- Auth response: Generates `client.__sessionKey`, includes base64-encoded key in the response, encrypts with global key

### Client (src/client.ts)

- `init()`: If encryption enabled, derives `this.globalKey` from `config.sockets.authKey`
- `send()`: Encrypts with session key (or global key if `useGlobalKey=true` for auth)
- `onMessage()`: Decrypts with session key (or global key if no session key yet)
- Auth response: Stores `this.sessionKey` from the base64-encoded key in the response

## Disabling Encryption

Set `SOCKET_ENCRYPTION=false` in the environment. When disabled:

- Messages are sent as plain JSON strings
- No key derivation occurs
- No session keys are generated
- The `authKey` is still sent in the auth request (as plaintext JSON)

## Security Notes

- **`authKey` default.** `config/environment.js` falls back to the literal `'AUTH_KEY'` when `SOCKET_AUTH_KEY` is unset. Nothing checks for that value or for a weak key at runtime; production deployments must set their own.
- **Fixed salt.** `deriveKey` uses the fixed salt `'stonyx-sockets'`, so every deployment with the same `authKey` derives the same global key. The salt is not secret; it only separates this key from other uses of the same string.
- **Encryption switch.** Only `encryption === 'true'` or `encryption === true` turns encryption on. Any other value, including `'yes'` or `1`, runs in plaintext without a warning. An `undefined` value makes `init()` throw on both server and client rather than fall back to plaintext.
- **No transport security.** Encryption is at the application layer over `ws`. Use a `wss://` address and a TLS terminator in front of the server if you need transport security.
- **Session lifetime.** `client.__authenticated` is set once, when the `auth` handler returns a truthy value, and lasts for the life of the connection. There is no expiry, re-authentication or session-key rotation; the heartbeat is a keep-alive only.
- **Auth gate.** The handler named `auth` is always dispatched, whatever its `skipAuth`. Other handlers run for an unauthenticated client only when they declare `static skipAuth = true`. A request from an unauthenticated client to any other existing handler closes the connection; an unauthenticated `heartBeat` gets no reply.
- **Malformed input.** On the server, a payload that fails to decrypt or parse closes the connection; a single corrupted byte ends the session, and there is no protocol-level retry. A well-formed request naming an unknown handler is logged and ignored, and the connection stays open.
- **Sending.** `prepareSend()` replaces `send` on the connection object itself at connect time, so `client.send()` from handlers is encrypted when encryption is on. Code that writes to the socket through any other path is not.
- **Client metadata.** `client.meta` is whatever the consumer's `auth` handler sets; the framework does not validate it. `sendToByMeta(key, value, request, response)` sends to the first authenticated client whose `meta[key] === value` and returns `true`, or returns `false` if none matches.
- **Client registry.** `clientMap` is filled by the consumer's `auth` handler, not by the framework. A client the handler does not add is authenticated but unreachable through `sendTo`, `sendToByMeta` and `broadcast`.
- **Client IP.** `client.ip` is `request.socket.remoteAddress`, recorded on connect and used only in log lines. Behind a proxy it is the proxy's address.
