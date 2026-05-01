/**
 * Tests for Follow/Accept/Undo protocol (pure logic).
 *
 * Tests the pure functions from follow.pure.ts without ad4m:host runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    processFollow,
    processUndo,
    buildFollowRequest,
    getStartPage,
} from "../src/follow.pure.js";

import type { APActivity, APObject } from "../src/activitypub.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import type { APLanguageSettings } from "../src/settings.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ACTOR_URL = "https://example.com/ap/v1/groups/test-group";
const FOLLOWER_ACTOR_URL = "https://mastodon.social/users/alice";
const FOLLOWER_INBOX_URL = "https://mastodon.social/users/alice/inbox";

function makeFollowActivity(actor?: string): APActivity {
    return {
        "@context": ["https://www.w3.org/ns/activitystreams"],
        type: "Follow",
        id: "https://mastodon.social/activities/follow-1",
        actor: actor || FOLLOWER_ACTOR_URL,
        published: "2026-05-02T00:00:00Z",
        object: {
            type: "Group",
            id: GROUP_ACTOR_URL,
        },
    };
}

// ---------------------------------------------------------------------------
// processFollow
// ---------------------------------------------------------------------------

describe("processFollow", () => {
    it("auto-accepts when requireApproval is false", () => {
        const result = processFollow(
            makeFollowActivity(),
            GROUP_ACTOR_URL,
            FOLLOWER_INBOX_URL,
            DEFAULT_SETTINGS,
        );

        assert.equal(result.accepted, true);
        assert.equal(result.pending, false);
        assert.ok(result.acceptActivity);
        assert.ok(result.followerInfo);
    });

    it("sets pending when requireApproval is true", () => {
        const approvalSettings: APLanguageSettings = {
            ...DEFAULT_SETTINGS,
            requireApproval: true,
        };
        const result = processFollow(
            makeFollowActivity(),
            GROUP_ACTOR_URL,
            FOLLOWER_INBOX_URL,
            approvalSettings,
        );

        assert.equal(result.accepted, false);
        assert.equal(result.pending, true);
        assert.equal(result.acceptActivity, undefined);
        assert.equal(result.followerInfo, undefined);
    });

    it("builds correct Accept activity", () => {
        const result = processFollow(
            makeFollowActivity(),
            GROUP_ACTOR_URL,
            FOLLOWER_INBOX_URL,
            DEFAULT_SETTINGS,
        );

        assert.ok(result.acceptActivity);
        const accept = result.acceptActivity!;
        assert.equal(accept.type, "Accept");
        assert.equal(accept.actor, GROUP_ACTOR_URL);
        assert.ok(accept.to?.includes(FOLLOWER_ACTOR_URL));
        assert.ok(accept.id.includes("accept-follow"));
    });

    it("includes follower info with inbox URL", () => {
        const result = processFollow(
            makeFollowActivity(),
            GROUP_ACTOR_URL,
            FOLLOWER_INBOX_URL,
            DEFAULT_SETTINGS,
        );

        assert.ok(result.followerInfo);
        assert.equal(result.followerInfo!.actorUrl, FOLLOWER_ACTOR_URL);
        assert.equal(result.followerInfo!.inboxUrl, FOLLOWER_INBOX_URL);
        assert.ok(result.followerInfo!.acceptedAt > 0);
    });

    it("includes DID in follower info when provided", () => {
        const result = processFollow(
            makeFollowActivity(),
            GROUP_ACTOR_URL,
            FOLLOWER_INBOX_URL,
            DEFAULT_SETTINGS,
            "did:key:z6MkAlice",
        );

        assert.ok(result.followerInfo);
        assert.equal(result.followerInfo!.did, "did:key:z6MkAlice");
    });
});

// ---------------------------------------------------------------------------
// processUndo
// ---------------------------------------------------------------------------

describe("processUndo", () => {
    it("detects Undo{Follow} with inline object", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Undo",
            id: "https://mastodon.social/activities/undo-1",
            actor: FOLLOWER_ACTOR_URL,
            published: "2026-05-02T01:00:00Z",
            object: {
                type: "Follow",
                id: "https://mastodon.social/activities/follow-1",
            },
        };

        const result = processUndo(activity);
        assert.ok(result);
        assert.equal(result!.type, "unfollow");
        assert.equal(result!.actorUrl, FOLLOWER_ACTOR_URL);
    });

    it("detects Undo with string object (assumes unfollow)", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Undo",
            id: "https://mastodon.social/activities/undo-2",
            actor: FOLLOWER_ACTOR_URL,
            published: "2026-05-02T02:00:00Z",
            object: "https://mastodon.social/activities/follow-1",
        };

        const result = processUndo(activity);
        assert.ok(result);
        assert.equal(result!.type, "unfollow");
    });

    it("returns null for Undo with non-Follow inline object", () => {
        const activity: APActivity = {
            "@context": ["https://www.w3.org/ns/activitystreams"],
            type: "Undo",
            id: "https://mastodon.social/activities/undo-3",
            actor: FOLLOWER_ACTOR_URL,
            published: "2026-05-02T03:00:00Z",
            object: {
                type: "Like",
                id: "https://mastodon.social/activities/like-1",
            },
        };

        const result = processUndo(activity);
        assert.equal(result, null);
    });
});

// ---------------------------------------------------------------------------
// buildFollowRequest
// ---------------------------------------------------------------------------

describe("buildFollowRequest", () => {
    it("builds a valid Follow activity", () => {
        const targetActor = "https://other.server/users/bob";
        const activity = buildFollowRequest(targetActor, GROUP_ACTOR_URL);

        assert.equal(activity.type, "Follow");
        assert.equal(activity.actor, GROUP_ACTOR_URL);
        assert.ok(activity.to?.includes(targetActor));
        assert.ok(activity.id.includes("follow-"));

        const obj = activity.object as APObject;
        assert.equal(obj.id, targetActor);
        assert.equal(obj.type, "Person");
    });
});

// ---------------------------------------------------------------------------
// getStartPage
// ---------------------------------------------------------------------------

describe("getStartPage", () => {
    it("returns lastRevision when set", () => {
        const collection = { first: "https://example.com/outbox?page=1" };
        const result = getStartPage(collection, "https://example.com/outbox?page=3");
        assert.equal(result, "https://example.com/outbox?page=3");
    });

    it("returns first page when no last revision", () => {
        const collection = { first: "https://example.com/outbox?page=1" };
        const result = getStartPage(collection, null);
        assert.equal(result, "https://example.com/outbox?page=1");
    });

    it("returns null when no first page and no revision", () => {
        const result = getStartPage({}, null);
        assert.equal(result, null);
    });
});
