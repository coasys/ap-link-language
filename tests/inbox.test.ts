/**
 * Tests for inbox signal processing (pure logic).
 *
 * Tests the pure functions from inbox.pure.ts without ad4m:host runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    parseInboxSignal,
    routeInboundActivity,
} from "../src/inbox.js";

import type { APActivity, APObject, APLinkTag } from "../src/activitypub.js";
import type { APLanguageSettings } from "../src/settings.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NEIGHBOURHOOD = "neighbourhood://test-group";

function makeCreateActivity(overrides?: Partial<APActivity>): APActivity {
    return {
        "@context": ["https://www.w3.org/ns/activitystreams"],
        type: "Create",
        id: "https://example.com/activities/1",
        actor: "https://mastodon.social/users/alice",
        published: "2026-05-02T00:00:00Z",
        object: {
            type: "Note",
            id: "https://example.com/objects/1",
            content: "Hello from the Fediverse!",
        },
        ...overrides,
    };
}

function makeFollowActivity(): APActivity {
    return {
        "@context": ["https://www.w3.org/ns/activitystreams"],
        type: "Follow",
        id: "https://mastodon.social/activities/follow-1",
        actor: "https://mastodon.social/users/bob",
        published: "2026-05-02T01:00:00Z",
        object: {
            type: "Group",
            id: "https://example.com/ap/v1/groups/test-group",
        },
    };
}

function makeUndoFollowActivity(): APActivity {
    return {
        "@context": ["https://www.w3.org/ns/activitystreams"],
        type: "Undo",
        id: "https://mastodon.social/activities/undo-1",
        actor: "https://mastodon.social/users/bob",
        published: "2026-05-02T02:00:00Z",
        object: {
            type: "Follow",
            id: "https://mastodon.social/activities/follow-1",
        },
    };
}

// ---------------------------------------------------------------------------
// parseInboxSignal
// ---------------------------------------------------------------------------

describe("parseInboxSignal", () => {
    it("parses a valid inbox signal", () => {
        const signal = {
            type: "ap-inbox-activity",
            activity: makeCreateActivity(),
            verified: true,
        };
        const result = parseInboxSignal(signal);
        assert.ok(result);
        assert.equal(result!.type, "ap-inbox-activity");
        assert.equal(result!.verified, true);
        assert.equal(result!.activity.type, "Create");
    });

    it("returns null for non-object input", () => {
        assert.equal(parseInboxSignal(null), null);
        assert.equal(parseInboxSignal("string"), null);
        assert.equal(parseInboxSignal(42), null);
    });

    it("returns null for wrong signal type", () => {
        assert.equal(parseInboxSignal({ type: "other-signal" }), null);
    });

    it("returns null for missing activity", () => {
        assert.equal(parseInboxSignal({ type: "ap-inbox-activity" }), null);
    });

    it("returns null for activity missing required fields", () => {
        assert.equal(parseInboxSignal({
            type: "ap-inbox-activity",
            activity: { type: "Create" }, // missing actor and id
        }), null);
    });

    it("defaults verified to false if not boolean", () => {
        const signal = {
            type: "ap-inbox-activity",
            activity: makeCreateActivity(),
            // no verified field
        };
        const result = parseInboxSignal(signal);
        assert.ok(result);
        assert.equal(result!.verified, false);
    });
});

// ---------------------------------------------------------------------------
// routeInboundActivity
// ---------------------------------------------------------------------------

describe("routeInboundActivity", () => {
    it("routes Create to link-diff with additions", () => {
        const activity = makeCreateActivity();
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions.length, 1);
            assert.equal(result.diff.removals.length, 0);
            assert.equal(result.diff.additions[0].data.predicate, "ap://external-note");
        }
    });

    it("routes Create with ad4m:Link tag to native link", () => {
        const activity = makeCreateActivity({
            object: {
                type: "Note",
                id: "https://example.com/objects/1",
                content: "With tags",
                tag: [{
                    type: "ad4m:Link",
                    "ad4m:source": "literal://hello",
                    "ad4m:predicate": "sioc://content_of",
                    "ad4m:target": "literal://world",
                } as APLinkTag],
            },
        });
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].data.source, "literal://hello");
            assert.equal(result.diff.additions[0].data.predicate, "sioc://content_of");
            assert.equal(result.diff.additions[0].data.target, "literal://world");
        }
    });

    it("routes Delete to link-diff with removals", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Delete",
            id: "https://example.com/activities/del-1",
            actor: "https://mastodon.social/users/alice",
            published: "2026-05-02T01:00:00Z",
            object: "https://example.com/objects/1",
        };
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions.length, 0);
            assert.equal(result.diff.removals.length, 1);
        }
    });

    it("routes Like to link-diff", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Like",
            id: "https://example.com/activities/like-1",
            actor: "https://mastodon.social/users/carol",
            published: "2026-05-02T03:00:00Z",
            object: "https://example.com/objects/1",
        };
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].data.predicate, "ap://liked-by");
        }
    });

    it("routes Announce to link-diff", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Announce",
            id: "https://example.com/activities/boost-1",
            actor: "https://mastodon.social/users/dave",
            published: "2026-05-02T04:00:00Z",
            object: "https://example.com/objects/1",
        };
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].data.predicate, "ap://announced-by");
        }
    });

    it("routes Follow to follow result", () => {
        const result = routeInboundActivity(makeFollowActivity(), NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "follow");
    });

    it("routes Undo to undo result", () => {
        const result = routeInboundActivity(makeUndoFollowActivity(), NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "undo");
    });

    it("routes Accept to accept result", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Accept",
            id: "https://example.com/activities/accept-1",
            actor: "https://example.com/users/server",
            published: "2026-05-02T05:00:00Z",
            object: { type: "Follow", id: "https://example.com/activities/follow-1" },
        };
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "accept");
    });

    // syncMode filtering
    it("rejects content in publish-only mode", () => {
        const publishOnlySettings: APLanguageSettings = {
            ...DEFAULT_SETTINGS,
            syncMode: "publish-only",
        };
        const result = routeInboundActivity(makeCreateActivity(), NEIGHBOURHOOD, publishOnlySettings, true);
        assert.equal(result.kind, "rejected");
        if (result.kind === "rejected") {
            assert.ok(result.reason.includes("publish-only"));
        }
    });

    it("allows Follow even in publish-only mode", () => {
        const publishOnlySettings: APLanguageSettings = {
            ...DEFAULT_SETTINGS,
            syncMode: "publish-only",
        };
        const result = routeInboundActivity(makeFollowActivity(), NEIGHBOURHOOD, publishOnlySettings, true);
        assert.equal(result.kind, "follow");
    });

    it("allows Undo even in publish-only mode", () => {
        const publishOnlySettings: APLanguageSettings = {
            ...DEFAULT_SETTINGS,
            syncMode: "publish-only",
        };
        const result = routeInboundActivity(makeUndoFollowActivity(), NEIGHBOURHOOD, publishOnlySettings, true);
        assert.equal(result.kind, "undo");
    });

    // Author override
    it("overrides author with resolved DID when provided", () => {
        const activity = makeCreateActivity();
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true, "did:key:z6MkTest");
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].author, "did:key:z6MkTest");
        }
    });

    // Unverified marking
    it("marks unverified links when verified=false", () => {
        const activity = makeCreateActivity();
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, false);
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].status, "unverified");
        }
    });

    it("marks links as unverified when author is ap: prefixed (non-AD4M)", () => {
        const activity = makeCreateActivity();
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true, "ap:https://mastodon.social/users/alice");
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].status, "unverified");
        }
    });

    it("does NOT mark as unverified when verified=true and author is a DID", () => {
        const activity = makeCreateActivity();
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true, "did:key:z6MkSomeKey");
        assert.equal(result.kind, "link-diff");
        if (result.kind === "link-diff") {
            assert.equal(result.diff.additions[0].status, undefined);
        }
    });

    // Unsupported types
    it("ignores unsupported activity types", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Reject" as any,
            id: "https://example.com/activities/reject-1",
            actor: "https://example.com/users/server",
            published: "2026-05-02T00:00:00Z",
            object: "https://example.com/objects/1",
        };
        const result = routeInboundActivity(activity, NEIGHBOURHOOD, DEFAULT_SETTINGS, true);
        assert.equal(result.kind, "ignored");
    });
});
