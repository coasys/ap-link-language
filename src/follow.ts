/**
 * Follow protocol — runtime wrapper.
 * Uses ad4m:host httpFetch for delivering Accept activities
 * and storage for pending follows.
 *
 * Delegates pure logic to follow.pure.ts.
 * Spec §2.2.
 */

import {
    httpFetch,
    hash,
    storageGet,
    storagePut,
    storageDelete,
    storageListKeys,
} from "@coasys/ad4m-ldk";

import type { APActivity } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";
import type { FollowResult, FollowerInfo } from "./follow.pure.js";
import { processFollow, processUndo, buildFollowRequest } from "./follow.pure.js";
import { signedHeaders } from "./http-signatures.js";
import { resolveActor, getActorInbox } from "./actors.js";
import { registerFollower, removeFollower } from "./security.js";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

function pendingFollowKey(actorUrl: string): string {
    return `pending-follows/${hash(actorUrl)}`;
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
                await httpFetch(inboxUrl, "POST", JSON.stringify(headers), body);
            } catch (err) {
                console.error(`[ap-link-language] Failed to deliver Accept to ${inboxUrl}:`, err);
            }
        }

        // Register the follower
        registerFollower(followerActorUrl, inboxUrl, followerDid);
    } else if (result.pending) {
        // Store as pending follow for admin review
        storagePut(pendingFollowKey(followerActorUrl), JSON.stringify(activity));
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
        await httpFetch(targetInbox, "POST", JSON.stringify(headers), body);
    } catch (err) {
        console.error(`[ap-link-language] Failed to send Follow to ${targetInbox}:`, err);
    }
}

/**
 * List pending follow requests awaiting admin approval.
 */
export function listPendingFollows(): APActivity[] {
    const keys = storageListKeys("pending-follows/");
    const activities: APActivity[] = [];
    for (const key of keys) {
        const raw = storageGet(key);
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
    const key = pendingFollowKey(actorUrl);
    const raw = storageGet(key);
    if (!raw) return;

    const activity = JSON.parse(raw) as APActivity;

    // Override settings to auto-accept this one
    const autoSettings = { ...settings, requireApproval: false };
    await handleFollow(activity, groupActorUrl, actorKeyId, autoSettings);

    // Remove from pending
    storageDelete(key);
}
