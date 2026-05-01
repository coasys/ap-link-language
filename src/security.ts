/**
 * Security — membership verification, rate limiting, block list.
 * Runtime wrapper: uses injected StorageAdapter.
 * Delegates pure logic to security.pure.ts.
 *
 * Spec §14.
 */

import { getRuntime } from "./runtime-interface.js";
import { getStorage } from "./storage-interface.js";

import type { APLanguageSettings } from "./settings.js";
import type { RateLimitState, MembershipResult } from "./security.pure.js";
import { checkMembership, checkRateLimitPure } from "./security.pure.js";

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

function rateLimitKey(actorUrl: string): string {
    return `rate-limit/${getRuntime().hash(actorUrl)}`;
}

function blockedKey(actorUrl: string): string {
    return `blocked/${getRuntime().hash(actorUrl)}`;
}

function followerKey(actorUrl: string): string {
    return `followers/${getRuntime().hash(actorUrl)}`;
}

function memberKey(did: string): string {
    return `peers/${did}`;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * Check if an actor is allowed to post, considering membership mode,
 * follower status, and member status.
 */
export function isAllowedToPost(
    actorUrl: string,
    settings: APLanguageSettings,
    authorDid?: string,
): MembershipResult {
    const storage = getStorage();

    // Check if blocked first
    if (isBlocked(actorUrl)) {
        return { allowed: false, reason: "Actor is blocked" };
    }

    // Resolve follower and member status from storage
    const isFollower = storage.get(followerKey(actorUrl)) !== null;

    // A member is someone in the peers store with a DID
    const isMember = authorDid
        ? storage.get(memberKey(authorDid)) !== null
        : false;

    return checkMembership(settings.membership, isFollower, isMember);
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

/**
 * Check and update the rate limit for an actor.
 * Returns true if the request is within limits.
 */
export function checkRateLimit(
    actorUrl: string,
    settings: APLanguageSettings,
): boolean {
    const storage = getStorage();
    const key = rateLimitKey(actorUrl);
    const rawState = storage.get(key);
    let state: RateLimitState | null = null;

    if (rawState) {
        try {
            state = JSON.parse(rawState) as RateLimitState;
        } catch {
            state = null;
        }
    }

    const result = checkRateLimitPure(state, settings.rateLimit);

    // Persist updated state
    storage.put(key, JSON.stringify(result.newState));

    return result.allowed;
}

// ---------------------------------------------------------------------------
// Block List
// ---------------------------------------------------------------------------

/**
 * Check if an actor is blocked.
 */
export function isBlocked(actorUrl: string): boolean {
    return getStorage().get(blockedKey(actorUrl)) !== null;
}

/**
 * Block an actor.
 */
export function blockActor(actorUrl: string): void {
    getStorage().put(blockedKey(actorUrl), String(Date.now()));
}

/**
 * Unblock an actor.
 */
export function unblockActor(actorUrl: string): void {
    getStorage().delete(blockedKey(actorUrl));
}

// ---------------------------------------------------------------------------
// Follower management (used by follow.ts)
// ---------------------------------------------------------------------------

/**
 * Register a follower with their inbox URL.
 */
export function registerFollower(
    actorUrl: string,
    inboxUrl: string,
    did?: string,
): void {
    const storage = getStorage();
    storage.put(followerKey(actorUrl), JSON.stringify({
        actorUrl,
        inboxUrl,
        did,
        acceptedAt: Date.now(),
    }));

    // Also register in peers store if they have a DID
    if (did) {
        storage.put(memberKey(did), JSON.stringify({
            inbox: inboxUrl,
            actorUrl,
            local: false,
        }));
    }
}

/**
 * Remove a follower.
 */
export function removeFollower(actorUrl: string): void {
    const storage = getStorage();
    // Read follower info to get DID before removing
    const raw = storage.get(followerKey(actorUrl));
    if (raw) {
        try {
            const info = JSON.parse(raw);
            if (info.did) {
                storage.delete(memberKey(info.did));
            }
        } catch {
            // ignore parse errors
        }
    }
    storage.delete(followerKey(actorUrl));
}

/**
 * Get all follower inbox URLs.
 */
export function getFollowerInboxes(): string[] {
    const storage = getStorage();
    const keys = storage.listKeys("followers/");
    const inboxes: string[] = [];
    for (const key of keys) {
        const raw = storage.get(key);
        if (raw) {
            try {
                const info = JSON.parse(raw);
                if (typeof info.inboxUrl === "string") {
                    inboxes.push(info.inboxUrl);
                }
            } catch {
                // skip bad entries
            }
        }
    }
    return inboxes;
}
