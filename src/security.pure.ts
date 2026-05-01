/**
 * Pure security logic — membership verification, rate limiting, block list.
 * No ad4m:host imports. Testable without the executor runtime.
 *
 * Spec §14.
 */

import type { MembershipMode, RateLimitSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitState {
    /** Number of requests in the current window */
    count: number;
    /** Epoch timestamp when the current window started */
    windowStart: number;
}

export interface MembershipResult {
    allowed: boolean;
    reason?: string;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * Check if an actor is allowed to post based on membership mode.
 *
 * Takes pre-resolved booleans for follower/member status — the
 * runtime layer resolves these from storage before calling.
 *
 * Per Spec §14.1:
 * - open:             Any AP actor can post
 * - followers-only:   Only accepted followers or members
 * - members-only:     Only AD4M agents in the Neighbourhood's peer set
 * - admin-approved:   Non-members need admin approval
 */
export function checkMembership(
    membership: MembershipMode,
    isFollower: boolean,
    isMember: boolean,
): MembershipResult {
    switch (membership) {
        case "open":
            return { allowed: true };

        case "followers-only":
            if (isFollower || isMember) {
                return { allowed: true };
            }
            return { allowed: false, reason: "Actor is not a follower of this group" };

        case "members-only":
            if (isMember) {
                return { allowed: true };
            }
            return { allowed: false, reason: "Actor is not a member of this neighbourhood" };

        case "admin-approved":
            if (isMember) {
                return { allowed: true };
            }
            return { allowed: false, reason: "Post requires admin approval" };

        default:
            return { allowed: false, reason: `Unknown membership mode: ${membership as string}` };
    }
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

/** Rate limit window duration: 1 minute */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Check rate limit for an actor. Pure function — takes and returns state.
 *
 * Returns whether the request is allowed and the updated state to persist.
 */
export function checkRateLimitPure(
    state: RateLimitState | null,
    settings: RateLimitSettings,
    now?: number,
): { allowed: boolean; newState: RateLimitState } {
    const currentTime = now ?? Date.now();

    // New window or expired window
    if (!state || (currentTime - state.windowStart) > RATE_LIMIT_WINDOW_MS) {
        return {
            allowed: true,
            newState: { count: 1, windowStart: currentTime },
        };
    }

    // Within current window — check limit
    if (state.count >= settings.maxPerMinute) {
        return {
            allowed: false,
            newState: state,
        };
    }

    // Within limits — increment
    return {
        allowed: true,
        newState: { count: state.count + 1, windowStart: state.windowStart },
    };
}
