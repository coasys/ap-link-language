/**
 * Sync logic — outbox fetching and remote state reconciliation.
 *
 * Phase 2: full bidirectional sync.
 * - Fetches outbox collection pages via httpFetch
 * - Paginates through new activities since last revision
 * - Translates activities to links and applies to store
 * - Respects syncMode (publish-only skips sync)
 */

import { httpFetch } from "@coasys/ad4m-ldk";
import type { PerspectiveDiff, LinkExpression } from "./types.js";
import type { APActivity, APCollection, APCollectionPage } from "./activitypub.js";
import { inboundActivityToLink } from "./translate.js";
import * as store from "./store.js";

// ---------------------------------------------------------------------------
// Outbox fetching
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
 *
 * Strategy:
 * 1. Fetch the outbox collection metadata
 * 2. If inline orderedItems exist, process those directly
 * 3. Otherwise paginate through pages from first → next
 * 4. Skip activities until we pass our last known revision ID
 * 5. Translate new activities to links and apply to store
 * 6. Update the stored revision to the last activity ID
 *
 * Returns the resulting PerspectiveDiff.
 */
export async function syncFromOutbox(
    outboxUrl: string,
    neighbourhoodUrl: string,
): Promise<PerspectiveDiff> {
    const lastRevision = store.getRevision();
    const allActivities: APActivity[] = [];

    // Fetch the outbox collection
    const collection = await fetchOutboxMeta(outboxUrl);
    if (!collection) {
        return { additions: [], removals: [] };
    }

    // If inline items exist (small collection), use those
    if (collection.orderedItems && collection.orderedItems.length > 0) {
        allActivities.push(...collection.orderedItems);
    } else if (collection.first) {
        // Paginate through pages
        let pageUrl: string | undefined = collection.first;
        const maxPages = 50; // Safety limit
        let pageCount = 0;

        while (pageUrl && pageCount < maxPages) {
            const page = await fetchCollectionPage(pageUrl);
            if (!page || !page.orderedItems || page.orderedItems.length === 0) {
                break;
            }
            allActivities.push(...page.orderedItems);
            pageUrl = page.next;
            pageCount++;
        }
    }

    if (allActivities.length === 0) {
        return { additions: [], removals: [] };
    }

    // Filter activities: skip everything up to and including the last revision
    let foundRevision = !lastRevision; // If no revision, process everything
    const newActivities: APActivity[] = [];

    for (const activity of allActivities) {
        if (!foundRevision) {
            if (activity.id === lastRevision) {
                foundRevision = true;
            }
            continue; // Skip this activity (already processed)
        }
        newActivities.push(activity);
    }

    if (newActivities.length === 0) {
        return { additions: [], removals: [] };
    }

    // Translate activities to links
    const diff = processInboundActivities(newActivities, neighbourhoodUrl);

    // Update revision to the last activity ID
    const lastActivity = newActivities[newActivities.length - 1];
    if (lastActivity?.id) {
        store.setRevision(lastActivity.id);
    }

    return diff;
}

/**
 * Process a batch of inbound activities.
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
