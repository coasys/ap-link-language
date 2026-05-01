/**
 * Pure inbox processing logic — no ad4m:host imports.
 * Testable without the executor runtime.
 *
 * Processes inbound AP activities received as signals from the executor.
 * Spec §2.1.
 */

import type { APActivity, APObject } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";
import type { LinkExpression, PerspectiveDiff } from "./types.js";
import { inboundActivityToLink } from "./translate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxSignal {
    type: "ap-inbox-activity";
    activity: APActivity;
    verified: boolean;
}

export type InboxProcessResult =
    | { kind: "link-diff"; diff: PerspectiveDiff }
    | { kind: "follow"; activity: APActivity }
    | { kind: "undo"; activity: APActivity }
    | { kind: "accept"; activity: APActivity }
    | { kind: "rejected"; reason: string }
    | { kind: "ignored"; reason: string };

// ---------------------------------------------------------------------------
// Signal parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate an inbox signal payload.
 * Returns null if the payload is not a valid inbox signal.
 */
export function parseInboxSignal(signal: unknown): InboxSignal | null {
    if (!signal || typeof signal !== "object") return null;
    const s = signal as Record<string, unknown>;

    if (s.type !== "ap-inbox-activity") return null;
    if (!s.activity || typeof s.activity !== "object") return null;

    const activity = s.activity as APActivity;
    if (!activity.type || !activity.actor || !activity.id) return null;

    return {
        type: "ap-inbox-activity",
        activity,
        verified: typeof s.verified === "boolean" ? s.verified : false,
    };
}

// ---------------------------------------------------------------------------
// Activity routing
// ---------------------------------------------------------------------------

/**
 * Route an inbound activity to the appropriate handler.
 *
 * Returns a processing result that the runtime layer uses to:
 * - Store resulting links and emit perspective diffs
 * - Forward follow/undo to the follow handler
 * - Reject activities that don't match syncMode
 *
 * Pure function — no side effects, no storage access.
 */
export function routeInboundActivity(
    activity: APActivity,
    neighbourhoodUrl: string,
    settings: APLanguageSettings,
    verified: boolean,
    authorDid?: string,
): InboxProcessResult {
    // Check syncMode: publish-only rejects all inbound content
    if (settings.syncMode === "publish-only") {
        // Still allow Follow/Undo/Accept even in publish-only mode
        if (activity.type !== "Follow" && activity.type !== "Undo" && activity.type !== "Accept") {
            return { kind: "rejected", reason: "syncMode is publish-only; inbound content rejected" };
        }
    }

    // Route based on activity type
    switch (activity.type) {
        case "Follow":
            return { kind: "follow", activity };

        case "Undo":
            return { kind: "undo", activity };

        case "Accept":
            return { kind: "accept", activity };

        case "Create":
        case "Delete":
        case "Like":
        case "Announce": {
            const link = inboundActivityToLink(activity, neighbourhoodUrl);
            if (!link) {
                return { kind: "ignored", reason: `Could not translate ${activity.type} activity to link` };
            }

            // Override author with resolved DID if available
            if (authorDid) {
                link.author = authorDid;
            }

            // Mark non-AD4M or unverified links
            if (!verified || !authorDid?.startsWith("did:")) {
                link.status = "unverified";
            }

            const diff: PerspectiveDiff = activity.type === "Delete"
                ? { additions: [], removals: [link] }
                : { additions: [link], removals: [] };

            return { kind: "link-diff", diff };
        }

        default:
            return { kind: "ignored", reason: `Unsupported activity type: ${activity.type}` };
    }
}
