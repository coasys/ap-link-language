/**
 * Pure follow protocol logic — Follow/Accept/Undo handshake.
 * No ad4m:host imports. Testable without the executor runtime.
 *
 * Spec §2.2.
 */

import type { APActivity, APObject } from "./activitypub.js";
import { apContext } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FollowerInfo {
    /** Actor URL of the follower */
    actorUrl: string;
    /** Inbox URL for delivering activities to this follower */
    inboxUrl: string;
    /** AD4M DID if the follower is an AD4M agent */
    did?: string;
    /** Timestamp when follow was accepted */
    acceptedAt: number;
}

export interface FollowResult {
    /** Whether the follow was accepted immediately */
    accepted: boolean;
    /** Accept activity to deliver back to the follower (if accepted) */
    acceptActivity?: APActivity;
    /** Follower info to register (if accepted) */
    followerInfo?: FollowerInfo;
    /** Whether the follow is pending admin approval */
    pending: boolean;
}

// ---------------------------------------------------------------------------
// Follow handling
// ---------------------------------------------------------------------------

/**
 * Process an inbound Follow activity.
 *
 * Determines whether to auto-accept based on settings (requireApproval).
 * If auto-accept: builds an Accept{Follow} activity and follower info.
 * If approval required: returns pending=true.
 *
 * The caller (runtime layer) is responsible for:
 * - Delivering the Accept activity to the follower's inbox
 * - Storing the follower info in the peers store
 * - Storing pending follows for admin review
 */
export function processFollow(
    activity: APActivity,
    groupActorUrl: string,
    followerInboxUrl: string,
    settings: APLanguageSettings,
    followerDid?: string,
): FollowResult {
    const followerActorUrl = activity.actor;

    if (settings.requireApproval) {
        return { accepted: false, pending: true };
    }

    // Auto-accept: build Accept{Follow} activity
    const now = new Date().toISOString();
    const acceptActivity: APActivity = {
        "@context": apContext(),
        type: "Accept",
        id: `${groupActorUrl}/activities/accept-follow-${encodeURIComponent(followerActorUrl)}`,
        actor: groupActorUrl,
        published: now,
        to: [followerActorUrl],
        object: activity as unknown as APObject,
    };

    const followerInfo: FollowerInfo = {
        actorUrl: followerActorUrl,
        inboxUrl: followerInboxUrl,
        did: followerDid,
        acceptedAt: Date.now(),
    };

    return {
        accepted: true,
        acceptActivity,
        followerInfo,
        pending: false,
    };
}

/**
 * Process an inbound Undo activity.
 *
 * If the inner object is a Follow activity, returns the actor URL
 * to remove from followers.
 */
export function processUndo(
    activity: APActivity,
): { type: "unfollow"; actorUrl: string } | null {
    const inner = activity.object;

    // Object can be a string ID or an inline object
    if (typeof inner === "string") {
        // Can't determine the type — assume unfollow if from the same actor
        return { type: "unfollow", actorUrl: activity.actor };
    }

    const obj = inner as APObject;
    if (obj.type === "Follow") {
        return { type: "unfollow", actorUrl: activity.actor };
    }

    return null;
}

/**
 * Build a Follow activity for outbound follow requests.
 */
export function buildFollowRequest(
    targetActorUrl: string,
    groupActorUrl: string,
): APActivity {
    const now = new Date().toISOString();
    return {
        "@context": apContext(),
        type: "Follow",
        id: `${groupActorUrl}/activities/follow-${encodeURIComponent(targetActorUrl)}`,
        actor: groupActorUrl,
        published: now,
        to: [targetActorUrl],
        object: {
            type: "Person",
            id: targetActorUrl,
        },
    };
}

// ---------------------------------------------------------------------------
// Outbox sync helpers
// ---------------------------------------------------------------------------

/**
 * Extract the page URL from an AP collection to start paginating from.
 *
 * If lastRevision is set, we'd ideally paginate from there.
 * For now, start from the `first` page.
 */
export function getStartPage(
    collection: { first?: string; last?: string },
    lastRevision: string | null,
): string | null {
    // If we have a last revision, it's the URL of the last page we processed.
    // Start from there to pick up new items.
    if (lastRevision) return lastRevision;

    // First sync: start from the first page
    return collection.first ?? null;
}
