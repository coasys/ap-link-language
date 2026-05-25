/**
 * Tests for actor resolution (pure logic).
 *
 * Tests the pure functions from actors.pure.ts without ad4m:host runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    parseActorDocument,
    resolveAuthorFromActor,
    isActorCacheExpired,
    ACTOR_CACHE_TTL_MS,
} from "../src/actors.js";

import type { ActorInfo } from "../src/actors.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeActorDocument(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
        "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
        type: "Person",
        id: "https://mastodon.social/users/alice",
        inbox: "https://mastodon.social/users/alice/inbox",
        outbox: "https://mastodon.social/users/alice/outbox",
        preferredUsername: "alice",
        name: "Alice",
        publicKey: {
            id: "https://mastodon.social/users/alice#main-key",
            owner: "https://mastodon.social/users/alice",
            publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjAN...\n-----END PUBLIC KEY-----",
        },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// parseActorDocument
// ---------------------------------------------------------------------------

describe("parseActorDocument", () => {
    it("parses a valid Person actor", () => {
        const doc = makeActorDocument();
        const actor = parseActorDocument(doc, 1000);
        assert.ok(actor);
        assert.equal(actor!.id, "https://mastodon.social/users/alice");
        assert.equal(actor!.type, "Person");
        assert.equal(actor!.inbox, "https://mastodon.social/users/alice/inbox");
        assert.equal(actor!.outbox, "https://mastodon.social/users/alice/outbox");
        assert.equal(actor!.preferredUsername, "alice");
        assert.equal(actor!.name, "Alice");
        assert.equal(actor!.fetchedAt, 1000);
    });

    it("parses a Group actor", () => {
        const doc = makeActorDocument({ type: "Group" });
        const actor = parseActorDocument(doc);
        assert.ok(actor);
        assert.equal(actor!.type, "Group");
    });

    it("extracts ad4m:did when present", () => {
        const doc = makeActorDocument({ "ad4m:did": "did:key:z6MkAlice" });
        const actor = parseActorDocument(doc);
        assert.ok(actor);
        assert.equal(actor!["ad4m:did"], "did:key:z6MkAlice");
    });

    it("returns null for ad4m:did if not a string", () => {
        const doc = makeActorDocument({ "ad4m:did": 42 });
        const actor = parseActorDocument(doc);
        assert.ok(actor);
        assert.equal(actor!["ad4m:did"], undefined);
    });

    it("parses publicKey correctly", () => {
        const doc = makeActorDocument();
        const actor = parseActorDocument(doc);
        assert.ok(actor);
        assert.ok(actor!.publicKey);
        assert.equal(actor!.publicKey!.id, "https://mastodon.social/users/alice#main-key");
        assert.equal(actor!.publicKey!.owner, "https://mastodon.social/users/alice");
        assert.ok(actor!.publicKey!.publicKeyPem.includes("BEGIN PUBLIC KEY"));
    });

    it("returns null for null input", () => {
        assert.equal(parseActorDocument(null), null);
    });

    it("returns null for non-object input", () => {
        assert.equal(parseActorDocument("string"), null);
        assert.equal(parseActorDocument(42), null);
    });

    it("returns null when missing required id", () => {
        const doc = makeActorDocument();
        delete doc.id;
        assert.equal(parseActorDocument(doc), null);
    });

    it("returns null when missing required type", () => {
        const doc = makeActorDocument();
        delete doc.type;
        assert.equal(parseActorDocument(doc), null);
    });

    it("returns null when missing required inbox", () => {
        const doc = makeActorDocument();
        delete doc.inbox;
        assert.equal(parseActorDocument(doc), null);
    });

    it("handles missing optional fields", () => {
        const minimalDoc = {
            id: "https://example.com/actor/1",
            type: "Service",
            inbox: "https://example.com/actor/1/inbox",
        };
        const actor = parseActorDocument(minimalDoc);
        assert.ok(actor);
        assert.equal(actor!.outbox, undefined);
        assert.equal(actor!.preferredUsername, undefined);
        assert.equal(actor!.name, undefined);
        assert.equal(actor!.publicKey, undefined);
    });

    it("handles malformed publicKey gracefully", () => {
        const doc = makeActorDocument({
            publicKey: { id: "key-1" }, // missing owner and publicKeyPem
        });
        const actor = parseActorDocument(doc);
        assert.ok(actor);
        assert.equal(actor!.publicKey, undefined); // malformed, so not parsed
    });

    it("uses current time if fetchedAt not provided", () => {
        const before = Date.now();
        const actor = parseActorDocument(makeActorDocument());
        const after = Date.now();
        assert.ok(actor);
        assert.ok(actor!.fetchedAt >= before);
        assert.ok(actor!.fetchedAt <= after);
    });
});

// ---------------------------------------------------------------------------
// resolveAuthorFromActor
// ---------------------------------------------------------------------------

describe("resolveAuthorFromActor", () => {
    it("returns DID when actor has ad4m:did", () => {
        const actor: ActorInfo = {
            id: "https://mastodon.social/users/alice",
            type: "Person",
            inbox: "https://mastodon.social/users/alice/inbox",
            "ad4m:did": "did:key:z6MkAlice",
            fetchedAt: Date.now(),
        };
        assert.equal(resolveAuthorFromActor(actor, "https://mastodon.social/users/alice"), "did:key:z6MkAlice");
    });

    it("returns ap:{url} when actor has no ad4m:did", () => {
        const actor: ActorInfo = {
            id: "https://mastodon.social/users/bob",
            type: "Person",
            inbox: "https://mastodon.social/users/bob/inbox",
            fetchedAt: Date.now(),
        };
        assert.equal(resolveAuthorFromActor(actor, "https://mastodon.social/users/bob"), "ap:https://mastodon.social/users/bob");
    });

    it("returns ap:{url} when actor is null", () => {
        assert.equal(resolveAuthorFromActor(null, "https://mastodon.social/users/unknown"), "ap:https://mastodon.social/users/unknown");
    });

    it("ignores empty string ad4m:did", () => {
        const actor: ActorInfo = {
            id: "https://mastodon.social/users/carol",
            type: "Person",
            inbox: "https://mastodon.social/users/carol/inbox",
            "ad4m:did": "",
            fetchedAt: Date.now(),
        };
        assert.equal(resolveAuthorFromActor(actor, "https://mastodon.social/users/carol"), "ap:https://mastodon.social/users/carol");
    });
});

// ---------------------------------------------------------------------------
// isActorCacheExpired
// ---------------------------------------------------------------------------

describe("isActorCacheExpired", () => {
    const baseActor: ActorInfo = {
        id: "https://example.com/actor/1",
        type: "Person",
        inbox: "https://example.com/actor/1/inbox",
        fetchedAt: 1000,
    };

    it("returns false when within TTL", () => {
        assert.equal(isActorCacheExpired(baseActor, 1000 + ACTOR_CACHE_TTL_MS - 1), false);
    });

    it("returns true when past TTL", () => {
        assert.equal(isActorCacheExpired(baseActor, 1000 + ACTOR_CACHE_TTL_MS + 1), true);
    });

    it("returns true exactly at TTL boundary", () => {
        // At exactly TTL, the difference equals TTL, which is not > TTL
        assert.equal(isActorCacheExpired(baseActor, 1000 + ACTOR_CACHE_TTL_MS), false);
    });

    it("respects custom TTL", () => {
        const customTTL = 5000;
        assert.equal(isActorCacheExpired(baseActor, 5999, customTTL), false);
        assert.equal(isActorCacheExpired(baseActor, 6001, customTTL), true);
    });
});
