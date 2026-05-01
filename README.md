# ActivityPub Link Language for AD4M

An AD4M Link Language that bridges Perspectives to the Fediverse via ActivityPub federation.

## Overview

This language implements `perspective-commit`, `perspective-sync`, `perspective-query`, and `peers` capabilities using ActivityPub as the transport layer. A Neighbourhood using this language can have its links federated to and from AP servers — meaning AD4M agents sharing a perspective can have their content appear on Mastodon, Pleroma, and other Fediverse platforms.

## Phase 1: Outbound-Only MVP

The current implementation (Phase 1) supports:

- **Outbound publishing** — Links committed to the perspective are translated to AP `Create{Note}` activities and delivered to follower inboxes
- **Local link store** — Full KV-backed link store with indexes by source, target, and predicate
- **AP Group Actor** — Template-driven Group Actor document for the neighbourhood
- **HTTP Signatures** — Signed outbound requests using the agent's DID keypair
- **Three rendering strategies** — "semantic" (structured), "chat" (plain text), "raw" (triple)
- **Query support** — Link pattern queries against the local store

## Architecture

```
┌──────────────────────────────────────────────────────┐
│          AP Link Language Instance                    │
│                                                       │
│  Exports:                                            │
│    ✓ perspective-commit  (write links → AP delivery) │
│    ✓ perspective-query   (query links ← local store) │
│    ✓ perspective-sync    (Phase 2: full sync)         │
│    ✓ peers               (AP followers = peer set)    │
│    ✗ telepresence        (not supported — no AP equiv)│
│                                                       │
│  Transport:                                          │
│    ActivityPub S2S federation (HTTP POST to inboxes)  │
│                                                       │
│  Storage:                                            │
│    Local link store (KV via ad4m:host storage)        │
└──────────────────────────────────────────────────────┘
```

## Template Variables

When creating a Neighbourhood with this language, the following template variables are filled:

| Variable | Description |
|---|---|
| `GROUP_ACTOR_URL` | AP Group Actor URL |
| `GROUP_INBOX_URL` | Group inbox endpoint |
| `GROUP_OUTBOX_URL` | Group outbox endpoint |
| `FEDERATION_DOMAIN` | Domain for AP federation |
| `NEIGHBOURHOOD_META` | JSON-encoded Neighbourhood metadata |

## Building

```bash
# Type-check
pnpm run typecheck

# Bundle for the AD4M executor
deno run --allow-all esbuild.ts

# Run tests
pnpm run test
```

## Spec

See [`activitypub-link-language.md`](../docs/activitypub-link-language.md) for the full proposal.

## License

CAL-1.0 — same as AD4M.
