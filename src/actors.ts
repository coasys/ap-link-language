/**
 * Actor resolution and cache — runtime wrapper.
 *
 * Uses ad4m:host storage for caching and httpFetch for retrieval.
 * Delegates pure logic to actors.pure.ts.
 *
 * Spec §2.4.
 */

import {
    httpFetch,
    hash,
    storageGet,
    storagePut,
    storageDelete,
} from "@coasys/ad4m-ldk";

import type { ActorInfo } from "./actors.pure.js";
import {
    parseActorDocument,
    resolveAuthorFromActor,
    isActorCacheExpired,
} from "./actors.pure.js";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

function actorCacheKey(actorUrl: string): string {
    return `actors/${hash(actorUrl)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an AP Actor document by URL.
 *
 * Checks local cache first; fetches via httpFetch if not cached or expired.
 * Caches the result on success.
 */
export async function resolveActor(actorUrl: string): Promise<ActorInfo | null> {
    // Check cache
    const cached = storageGet(actorCacheKey(actorUrl));
    if (cached) {
        try {
            const actor = JSON.parse(cached) as ActorInfo;
            if (!isActorCacheExpired(actor)) {
                return actor;
            }
        } catch {
            // Invalid cache entry — re-fetch
        }
    }

    // Fetch the actor document
    try {
        const headers = JSON.stringify({
            Accept: "application/activity+json, application/ld+json",
        });
        const responseRaw = await httpFetch(actorUrl, "GET", headers, "");
        const parsed = JSON.parse(responseRaw);

        if (parsed.status >= 200 && parsed.status < 300) {
            const body = JSON.parse(parsed.body);
            const actor = parseActorDocument(body);
            if (actor) {
                // Cache the result
                storagePut(actorCacheKey(actorUrl), JSON.stringify(actor));
                return actor;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Resolve the author identity for an AP Actor URL.
 *
 * Returns a DID (if the actor is an AD4M agent) or `ap:{url}`.
 */
export async function resolveAuthor(actorUrl: string): Promise<string> {
    const actor = await resolveActor(actorUrl);
    return resolveAuthorFromActor(actor, actorUrl);
}

/**
 * Get the inbox URL for an AP Actor.
 */
export async function getActorInbox(actorUrl: string): Promise<string | null> {
    const actor = await resolveActor(actorUrl);
    return actor?.inbox ?? null;
}

/**
 * Invalidate a cached actor document.
 */
export function invalidateActorCache(actorUrl: string): void {
    storageDelete(actorCacheKey(actorUrl));
}
