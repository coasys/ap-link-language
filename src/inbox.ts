/**
 * Inbox processing — runtime wrapper.
 * Connects inbox signal processing to the storage layer and
 * perspective diff emission.
 *
 * Delegates pure logic to inbox.pure.ts.
 * Spec §2.1.
 */

import { emitPerspectiveDiff, storageGet, storagePut } from "@coasys/ad4m-ldk";

import type { APActivity } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";
import type { PerspectiveDiff } from "./types.js";
import type { InboxProcessResult } from "./inbox.pure.js";
import { parseInboxSignal, routeInboundActivity } from "./inbox.pure.js";
import { linkOriginKey } from "./dual-language.js";
import type { LinkOrigin } from "./dual-language.js";
import { resolveAuthor } from "./actors.js";
import { isAllowedToPost, checkRateLimit } from "./security.js";
import { handleFollow, handleUndo } from "./follow.js";
import * as store from "./store.js";

// ---------------------------------------------------------------------------
// Storage helpers (thin wrappers for dual-language origin tracking)
// ---------------------------------------------------------------------------

function storageGetForInbox(key: string): string | null {
    return storageGet(key);
}

function storagePutForInbox(key: string, value: string): void {
    storagePut(key, value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process an inbound inbox signal from the executor.
 *
 * Full pipeline:
 * 1. Parse and validate the signal
 * 2. Resolve the actor's identity (DID or ap: prefix)
 * 3. Check security (membership, rate limit, block list)
 * 4. Route to appropriate handler
 * 5. Store resulting links and emit perspective diffs
 *
 * Returns the processing result for logging/debugging.
 */
export async function processInboxSignal(
    signal: unknown,
    neighbourhoodUrl: string,
    groupActorUrl: string,
    actorKeyId: string,
    settings: APLanguageSettings,
): Promise<InboxProcessResult> {
    // 1. Parse signal
    const parsed = parseInboxSignal(signal);
    if (!parsed) {
        return { kind: "ignored", reason: "Not a valid inbox signal" };
    }

    const { activity, verified } = parsed;

    // 2. Resolve actor identity
    const authorDid = await resolveAuthor(activity.actor);

    // 3. Security checks (skip for Follow/Undo/Accept)
    if (activity.type !== "Follow" && activity.type !== "Undo" && activity.type !== "Accept") {
        // Check block list and membership
        const membershipResult = isAllowedToPost(activity.actor, settings, authorDid);
        if (!membershipResult.allowed) {
            return { kind: "rejected", reason: membershipResult.reason || "Not allowed to post" };
        }

        // Check rate limit
        if (!checkRateLimit(activity.actor, settings)) {
            return { kind: "rejected", reason: "Rate limit exceeded" };
        }
    }

    // 4. Route the activity (with group actor URL for enhanced inbound)
    const result = routeInboundActivity(activity, neighbourhoodUrl, settings, verified, authorDid, groupActorUrl);

    // 5. Handle results
    switch (result.kind) {
        case "link-diff":
            // Store links and emit perspective diff
            store.applyDiff(result.diff);

            // Track link origins as "ap" for dual-language dedup
            for (const link of [...result.diff.additions, ...result.diff.removals]) {
                const h = store.hashLink(link);
                const originKey = linkOriginKey(h);
                const existing = storageGetForInbox(originKey);
                if (existing === "native") {
                    // Already exists from native sync — mark as dual
                    storagePutForInbox(originKey, "dual");
                } else if (!existing) {
                    storagePutForInbox(originKey, "ap");
                }
            }

            emitPerspectiveDiff(result.diff);
            break;

        case "follow":
            await handleFollow(activity, groupActorUrl, actorKeyId, settings);
            break;

        case "undo":
            await handleUndo(activity);
            break;

        case "accept":
            // Accept confirmation — no action needed, the follow is confirmed
            console.log(`[ap-link-language] Follow accepted by ${activity.actor}`);
            break;

        // "rejected" and "ignored" — no action needed
    }

    return result;
}
