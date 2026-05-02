# ActivityPub Link Language for AD4M

An AD4M Link Language that bridges Perspectives to the Fediverse via ActivityPub federation.

## Overview

This language implements `perspective-commit`, `perspective-sync`, `perspective-query`, and `peers` capabilities using ActivityPub as the transport layer. A Neighbourhood using this language can have its links federated to and from AP servers — meaning AD4M agents sharing a perspective can have their content appear on Mastodon, Pleroma, and other Fediverse platforms.

## Features

### Federation
- Links committed to the perspective are translated to AP `Create{Note}` activities and delivered to follower inboxes
- Inbox processing — inbound AP activities become local links
- Follow/Accept/Undo handshake for the group actor
- Actor resolution with DID extraction and cache TTL
- Outbox sync with pagination for catching up missed activities
- Membership control (open, followers-only, allowlist) and rate limiting
- HTTP Signatures using the agent's DID keypair
- Template-driven AP Group Actor for the neighbourhood

### Chat & Social
- SDNA-aware pattern detection (chat messages, replies, reactions, mentions)
- Rich AP rendering — Notes with `inReplyTo`, `Mention` tags, `Like` activities
- Three rendering strategies: "semantic" (structured), "chat" (plain text), "raw" (triple)

### Storage & Architecture
- Local KV-backed link store with indexes by source, target, and predicate
- Dual-language architecture for coexisting with a primary p-diff-sync language
- Link origin tracking to prevent federation echo loops

### Cross-Runtime Portability
- Transport abstraction layer (`Transport` interface) — all HTTP goes through `getTransport()`
- Storage adapter interface (`StorageAdapter`) — all KV goes through `getStorage()`
- Signing adapter interface (`SigningAdapter`) — all cryptographic signing via `getSigning()`
- Runtime adapter interface (`RuntimeAdapter`) — hash, signals, perspective diffs
- Deno-specific implementations (`DenoTransport`, `DenoStorageAdapter`, `DenoSigningAdapter`, `DenoRuntime`) isolate all `ad4m:host` imports
- `WasmTransport` documents the future WASM runtime entry point
- WIT definition (`wit/http-ext.wit`) for the proposed executor HTTP extension
- Cross-runtime test harness with mock adapters (197 tests)

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              AP Link Language Instance                            │
│                                                                   │
│  Capabilities:                                                    │
│    ✓ perspective-commit  (write links → AP delivery)              │
│    ✓ perspective-query   (query links ← local store)              │
│    ✓ perspective-sync    (full bidirectional sync)                 │
│    ✓ peers               (AP followers = peer set)                │
│    ✗ telepresence        (not supported — no AP equiv)            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Core Logic (no ad4m:host imports)                          │  │
│  │                                                              │  │
│  │  translate.ts    — link ↔ AP activity conversion             │  │
│  │  store.ts        — link storage + indexing                   │  │
│  │  delivery.ts     — activity delivery to inboxes              │  │
│  │  sync.ts         — outbox polling + pagination               │  │
│  │  actors.ts       — actor resolution + DID extraction         │  │
│  │  follow.ts       — Follow/Accept/Undo handshake              │  │
│  │  security.ts     — membership + rate limiting + blocks       │  │
│  │  http-signatures — request signing                           │  │
│  │  inbox.ts        — inbound activity processing               │  │
│  │  sdna.ts         — SDNA pattern detection                    │  │
│  │  dual-language.ts — federation filter + origin tracking      │  │
│  │  *.pure.ts       — pure functional logic                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                          ↕ injected adapters                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Adapter Interfaces          │  Deno Implementations        │  │
│  │  transport.ts (Transport)    │  transport-deno.ts            │  │
│  │  storage-interface.ts        │  storage-deno.ts              │  │
│  │  signing-interface.ts        │  signing-deno.ts              │  │
│  │  runtime-interface.ts        │  runtime-deno.ts              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  index.ts — wires Deno adapters + defineLanguage entry point      │
└──────────────────────────────────────────────────────────────────┘
```

### Cross-Runtime Design

All core logic is runtime-agnostic. The four adapter interfaces abstract:

| Adapter | Purpose | Deno Impl | WASM (future) |
|---|---|---|---|
| `Transport` | HTTP requests | `DenoTransport` → `httpFetch` | `WasmTransport` → `http-ext.fetch` |
| `StorageAdapter` | KV persistence | `DenoStorageAdapter` → `storage*` | Component Model KV |
| `SigningAdapter` | Cryptographic signing | `DenoSigningAdapter` → `agentSignStringHex` | WASM crypto import |
| `RuntimeAdapter` | Hash, signals, diffs | `DenoRuntime` → `hash`, `emitSignal` | WASM host calls |

To port to a new runtime: implement the four interfaces and wire them in your entry point.

### WIT Definition

`wit/http-ext.wit` defines the proposed HTTP extension for the AD4M Language Interface. When the executor adds WASM support, Languages can import this interface to make sandboxed HTTP requests.

## Template Variables

| Variable | Description |
|---|---|
| `GROUP_ACTOR_URL` | AP Group Actor URL |
| `GROUP_INBOX_URL` | Group inbox endpoint |
| `GROUP_OUTBOX_URL` | Group outbox endpoint |
| `FEDERATION_DOMAIN` | Domain for AP federation |
| `NEIGHBOURHOOD_META` | JSON-encoded Neighbourhood metadata |

## File Structure

```
ap-link-language/
├── package.json
├── tsconfig.json
├── esbuild.ts
├── README.md
├── index.ts                        # Entry point (Deno runtime wiring)
├── wit/
│   └── http-ext.wit                # WIT definition for WASM HTTP extension
├── src/
│   ├── types.ts                    # Local type definitions (pure)
│   ├── activitypub.ts              # AP types + JSON-LD (pure)
│   ├── settings.ts                 # Settings parsing (pure)
│   ├── translate.ts                # Link ↔ Activity translation (pure)
│   ├── sdna.ts                     # SDNA pattern detection (pure)
│   ├── dual-language.ts            # Dual-language dedup (pure)
│   │
│   ├── transport.ts                # Transport interface + WasmTransport + singleton
│   ├── storage-interface.ts        # StorageAdapter interface + singleton
│   ├── signing-interface.ts        # SigningAdapter interface + singleton
│   ├── runtime-interface.ts        # RuntimeAdapter interface + singleton
│   │
│   ├── transport-deno.ts           # DenoTransport (ad4m:host httpFetch)
│   ├── storage-deno.ts             # DenoStorageAdapter (ad4m:host KV)
│   ├── signing-deno.ts             # DenoSigningAdapter (ad4m:host sign)
│   ├── runtime-deno.ts             # DenoRuntime (ad4m:host hash/emit)
│   │
│   ├── store.ts                    # Link store (uses StorageAdapter + RuntimeAdapter)
│   ├── delivery.ts                 # Outbound delivery (uses Transport + RuntimeAdapter)
│   ├── sync.ts                     # Outbox sync (uses Transport)
│   ├── http-signatures.ts          # HTTP Signatures (uses SigningAdapter)
│   ├── actors.ts                   # Actor resolution (uses Transport + StorageAdapter)
│   ├── follow.ts                   # Follow/Accept (uses Transport + StorageAdapter)
│   ├── security.ts                 # Security (uses StorageAdapter + RuntimeAdapter)
│   ├── inbox.ts                    # Inbox processing (uses RuntimeAdapter + StorageAdapter)
│   │
│   ├── actors.pure.ts              # Pure actor logic
│   ├── follow.pure.ts              # Pure follow logic
│   ├── inbox.pure.ts               # Pure inbox logic
│   └── security.pure.ts            # Pure security logic
├── tests/
│   ├── translate.test.ts           # Translation tests (pure)
│   ├── inbox.test.ts               # Inbox tests (pure)
│   ├── follow.test.ts              # Follow tests (pure)
│   ├── actors.test.ts              # Actor tests (pure)
│   ├── security.test.ts            # Security tests (pure)
│   ├── sdna.test.ts                # SDNA tests (pure)
│   ├── dual-language.test.ts       # Dual-language tests (pure)
│   └── cross-runtime.test.ts       # Cross-runtime tests (mock adapters)
└── build/
    └── bundle.js                   # esbuild output
```

### `ad4m:host` Import Boundary

`ad4m:host` imports appear **only** in:
- `src/transport-deno.ts` — `httpFetch`
- `src/storage-deno.ts` — `storageGet`, `storagePut`, `storageDelete`, `storageListKeys`
- `src/signing-deno.ts` — `agentSignStringHex`, `agentSigningKeyId`
- `src/runtime-deno.ts` — `hash`, `emitSignal`, `emitPerspectiveDiff`
- `index.ts` — `defineLanguage`, `agentDid`, `languageSettings`, `hash`, `emitPerspectiveDiff`

All other source files are runtime-agnostic.

## Building

```bash
# Type-check
pnpm run typecheck

# Bundle for the AD4M executor
deno run --allow-all esbuild.ts

# Run tests (197 tests across 5 test files)
pnpm run test
```

## Testing

The test suite includes:

- **`tests/translate.test.ts`** — Link ↔ AP activity translation, rendering strategies
- **`tests/actors.test.ts`** — Actor resolution, DID extraction, caching
- **`tests/follow.test.ts`** — Follow/Accept/Undo handshake
- **`tests/inbox.test.ts`** — Inbox signal parsing, activity routing
- **`tests/security.test.ts`** — Membership, rate limiting, block lists
- **`tests/sdna.test.ts`** — SDNA pattern detection
- **`tests/dual-language.test.ts`** — Federation filtering, origin tracking
- **`tests/cross-runtime.test.ts`** — Full stack with mock adapters (store, delivery, sync, actors, follow, security, HTTP signatures, round-trip)

The cross-runtime tests prove the core logic has zero hidden dependency on `ad4m:host` — every external call goes through the injected adapters.

## License

CAL-1.0 — same as AD4M.
