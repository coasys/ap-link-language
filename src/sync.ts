/**
 * Sync logic — outbox fetching and remote state reconciliation.
 *
 * Phase 1 is outbound-only, so sync is limited to:
 * - Tracking the last known outbox revision
 * - Providing a render() of all local links
 *
 * Phase 2 will add inbound inbox processing and full outbox polling.
 */

import { httpFetch } from "@coasys/ad4m-ldk";
import type { PerspectiveDiff, LinkExpression } from "./types.js";
import type { APActivity, APCollection, APCollectionPage } from "./activitypub.js";
import { inboundActivityToLink } from "./translate.js";
import * as store from "./store.js";

// ---------------------------------------------------------------------------
// Outbox fetching (Phase 2 prep — stubbed for type-correctness)
// ---------------------------------------------------------------------------

/**
 * Fetch a single AP collection page via httpFetch.
 */
export async function fetchCollectionPage(url: string): Promise<APCollectionPage | null> {
    try {
        const headers = JSON.stringify({
            Accept: "application/activity+json",
        });
        const responseRaw = await httpFetch(url, "GET", headers, "");
        const parsed = JSON.parse(responseRaw);

        if (parsed.status >= 200 && parsed.status < 300) {
            return JSON.parse(parsed.body) as APCollectionPage;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Fetch the outbox collection metadata (total items, first/last page).
 */
export async function fetchOutboxMeta(outboxUrl: string): Promise<APCollection | null> {
    try {
        const headers = JSON.stringify({
            Accept: "application/activity+json",
        });
        const responseRaw = await httpFetch(outboxUrl, "GET", headers, "");
        const parsed = JSON.parse(responseRaw);

        if (parsed.status >= 200 && parsed.status < 300) {
            return JSON.parse(parsed.body) as APCollection;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Fetch new activities from the outbox since the last known revision.
 * Returns the activities and updates the stored revision.
 *
 * Phase 1: This is a no-op that returns an empty diff since we're
 * outbound-only. The infrastructure is here for Phase 2.
 */
export async function syncFromOutbox(
    outboxUrl: string,
    neighbourhoodUrl: string,
): Promise<PerspectiveDiff> {
    const lastRevision = store.getRevision();

    // Phase 1: outbound-only — skip remote fetch
    // In Phase 2, this would:
    // 1. Fetch outbox pages starting from lastRevision
    // 2. Translate activities to links
    // 3. Apply to local store
    // 4. Update revision

    const diff: PerspectiveDiff = { additions: [], removals: [] };
    return diff;
}

/**
 * Process a batch of inbound activities (for Phase 2 inbox handling).
 * Translates each activity to a LinkExpression and applies to the store.
 */
export function processInboundActivities(
    activities: APActivity[],
    neighbourhoodUrl: string,
): PerspectiveDiff {
    const additions: LinkExpression[] = [];
    const removals: LinkExpression[] = [];

    for (const activity of activities) {
        const link = inboundActivityToLink(activity, neighbourhoodUrl);
        if (!link) continue;

        if (activity.type === "Delete") {
            removals.push(link);
        } else {
            additions.push(link);
        }
    }

    const diff = { additions, removals };
    store.applyDiff(diff);
    return diff;
}
