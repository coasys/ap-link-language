/**
 * Actor resolution and cache — runtime wrapper.
 *
 * Uses injected StorageAdapter for caching and Transport for retrieval.
 * Delegates pure logic to actors.pure.ts.
 *
 * Spec §2.4.
 */

import { getRuntime } from "./runtime-interface.js";
import { getStorage } from "./storage-interface.js";
import { getTransport } from "./transport.js";

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
    return `actors/${getRuntime().hash(actorUrl)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an AP Actor document by URL.
 *
 * Checks local cache first; fetches via Transport if not cached or expired.
 * Caches the result on success.
 */
export async function resolveActor(actorUrl: string): Promise<ActorInfo | null> {
    const storage = getStorage();

    // Check cache
    const cached = storage.get(actorCacheKey(actorUrl));
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

    // Fetch the actor document via transport
    try {
        const response = await getTransport().fetch(
            actorUrl,
            "GET",
            { Accept: "application/activity+json, application/ld+json" },
            "",
        );

        if (response.status >= 200 && response.status < 300) {
            const body = JSON.parse(response.body);
            const actor = parseActorDocument(body);
            if (actor) {
                // Cache the result
                storage.put(actorCacheKey(actorUrl), JSON.stringify(actor));
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
    getStorage().delete(actorCacheKey(actorUrl));
}
