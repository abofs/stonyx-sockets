# @stonyx/sockets Documentation

`@stonyx/sockets` is a Stonyx framework module providing WebSocket server/client with handler auto-discovery, auth enforcement, AES-256-GCM encryption, and built-in heartbeat.

## Guides

- [Architecture](architecture.md) -- Module structure, singleton pattern, Stonyx integration, handler discovery lifecycle
- [Handlers](handlers.md) -- Handler class API, server/client hooks, auth flow, skipAuth, wire protocol
- [Encryption](encryption.md) -- AES-256-GCM encryption, key derivation, handshake flow, session keys
- [Configuration](configuration.md) -- All config options, env vars, defaults, how config loads via Stonyx
- [API Reference](api-reference.md) -- Complete method/property reference for SocketServer, SocketClient, Handler
- [Release](release.md) -- Release process
