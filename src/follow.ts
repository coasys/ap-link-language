/**
 * Follow protocol — runtime wrapper.
 * Uses Transport for delivering Accept activities and StorageAdapter
 * for pending follows.
 *
 * Also includes: Pure follow protocol logic (was follow.pure.ts).
 * Spec §2.2.
 */

import { getRuntime, getStorage, getTransport } from "./adapters.js";

import type { APActivity, APObject } from "./activitypub.js";
import { apContext } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";
import { signedHeaders } from "./http-signatures.js";
import { resolveActor, getActorInbox } from "./actors.js";
import { registerFollower, removeFollower } from "./security.js";

// ---------------------------------------------------------------------------
// Pure follow types and functions (was follow.pure.ts)
// ---------------------------------------------------------------------------

export interface FollowerInfo {
    actorUrl: string;
    inboxUrl: string;
    did?: string;
    acceptedAt: number;
}

export interface FollowResult {
    accepted: boolean;
    acceptActivity?: APActivity;
    followerInfo?: FollowerInfo;
    pending: boolean;
}

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

    return { accepted: true, acceptActivity, followerInfo, pending: false };
}

export function processUndo(
    activity: APActivity,
): { type: "unfollow"; actorUrl: string } | null {
    const inner = activity.object;
    if (typeof inner === "string") {
        return { type: "unfollow", actorUrl: activity.actor };
    }
    const obj = inner as APObject;
    if (obj.type === "Follow") {
        return { type: "unfollow", actorUrl: activity.actor };
    }
    return null;
}

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
        object: { type: "Person", id: targetActorUrl },
    };
}

export function getStartPage(
    collection: { first?: string; last?: string },
    lastRevision: string | null,
): string | null {
    if (lastRevision) return lastRevision;
    return collection.first ?? null;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

function pendingFollowKey(actorUrl: string): string {
    return `pending-follows/${getRuntime().hash(actorUrl)}`;
}

// ---------------------------------------------------------------------------
// Follow handling
// ---------------------------------------------------------------------------

/**
 * Handle an inbound Follow activity.
 *
 * 1. Resolves the follower's actor to get their inbox URL
 * 2. Checks settings for auto-accept vs pending approval
 * 3. If auto-accept: delivers Accept activity, registers follower
 * 4. If pending: stores the follow for admin review
 */
export async function handleFollow(
    activity: APActivity,
    groupActorUrl: string,
    actorKeyId: string,
    settings: APLanguageSettings,
): Promise<FollowResult> {
    const followerActorUrl = activity.actor;

    // Resolve the follower's actor to get their inbox URL
    const actor = await resolveActor(followerActorUrl);
    const inboxUrl = actor?.inbox || "";
    const followerDid = actor?.["ad4m:did"];

    const result = processFollow(activity, groupActorUrl, inboxUrl, settings, followerDid);

    if (result.accepted && result.acceptActivity && result.followerInfo) {
        // Deliver Accept to the follower's inbox
        if (inboxUrl) {
            const body = JSON.stringify(result.acceptActivity);
            const headers = signedHeaders(actorKeyId, inboxUrl, body);

            try {
                await getTransport().fetch(inboxUrl, "POST", headers, body);
            } catch (err) {
                console.error(`[ap-link-language] Failed to deliver Accept to ${inboxUrl}:`, err);
            }
        }

        // Register the follower
        registerFollower(followerActorUrl, inboxUrl, followerDid);
    } else if (result.pending) {
        // Store as pending follow for admin review
        getStorage().put(pendingFollowKey(followerActorUrl), JSON.stringify(activity));
    }

    return result;
}

/**
 * Handle an inbound Undo activity.
 * If it's an Undo{Follow}, remove the follower.
 */
export async function handleUndo(activity: APActivity): Promise<void> {
    const result = processUndo(activity);
    if (result?.type === "unfollow") {
        removeFollower(result.actorUrl);
    }
}

/**
 * Send an outbound Follow request to a target actor.
 */
export async function sendFollowRequest(
    targetActorUrl: string,
    groupActorUrl: string,
    actorKeyId: string,
): Promise<void> {
    const targetInbox = await getActorInbox(targetActorUrl);
    if (!targetInbox) {
        console.error(`[ap-link-language] Cannot follow ${targetActorUrl}: no inbox URL found`);
        return;
    }

    const followActivity = buildFollowRequest(targetActorUrl, groupActorUrl);
    const body = JSON.stringify(followActivity);
    const headers = signedHeaders(actorKeyId, targetInbox, body);

    try {
        await getTransport().fetch(targetInbox, "POST", headers, body);
    } catch (err) {
        console.error(`[ap-link-language] Failed to send Follow to ${targetInbox}:`, err);
    }
}

/**
 * List pending follow requests awaiting admin approval.
 */
export function listPendingFollows(): APActivity[] {
    const storage = getStorage();
    const keys = storage.listKeys("pending-follows/");
    const activities: APActivity[] = [];
    for (const key of keys) {
        const raw = storage.get(key);
        if (raw) {
            try {
                activities.push(JSON.parse(raw) as APActivity);
            } catch {
                // skip bad entries
            }
        }
    }
    return activities;
}

/**
 * Approve a pending follow request.
 */
export async function approvePendingFollow(
    actorUrl: string,
    groupActorUrl: string,
    actorKeyId: string,
    settings: APLanguageSettings,
): Promise<void> {
    const storage = getStorage();
    const key = pendingFollowKey(actorUrl);
    const raw = storage.get(key);
    if (!raw) return;

    const activity = JSON.parse(raw) as APActivity;

    // Override settings to auto-accept this one
    const autoSettings = { ...settings, requireApproval: false };
    await handleFollow(activity, groupActorUrl, actorKeyId, autoSettings);

    // Remove from pending
    storage.delete(key);
}
