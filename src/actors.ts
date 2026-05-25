/**
 * Actor resolution and cache — runtime wrapper.
 *
 * Uses injected StorageAdapter for caching and Transport for retrieval.
 *
 * Also includes: Pure actor resolution logic (was actors.pure.ts).
 *
 * Spec §2.4.
 */

import { getRuntime } from "./adapters.js";
import { getStorage } from "./adapters.js";
import { getTransport } from "./adapters.js";

// ---------------------------------------------------------------------------
// Pure actor types and functions (was actors.pure.ts)
// ---------------------------------------------------------------------------

export interface ActorPublicKey {
    id: string;
    owner: string;
    publicKeyPem: string;
}

export interface ActorInfo {
    id: string;
    type: string;
    inbox: string;
    outbox?: string;
    preferredUsername?: string;
    name?: string;
    "ad4m:did"?: string;
    publicKey?: ActorPublicKey;
    fetchedAt: number;
}

export const ACTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function parseActorDocument(json: unknown, fetchedAt?: number): ActorInfo | null {
    if (!json || typeof json !== "object") return null;
    const doc = json as Record<string, unknown>;

    const id = doc.id;
    if (typeof id !== "string" || !id) return null;
    const type = doc.type;
    if (typeof type !== "string" || !type) return null;
    const inbox = doc.inbox;
    if (typeof inbox !== "string" || !inbox) return null;

    let publicKey: ActorPublicKey | undefined;
    if (doc.publicKey && typeof doc.publicKey === "object") {
        const pk = doc.publicKey as Record<string, unknown>;
        if (typeof pk.id === "string" && typeof pk.owner === "string" && typeof pk.publicKeyPem === "string") {
            publicKey = { id: pk.id, owner: pk.owner, publicKeyPem: pk.publicKeyPem };
        }
    }

    return {
        id,
        type,
        inbox,
        outbox: typeof doc.outbox === "string" ? doc.outbox : undefined,
        preferredUsername: typeof doc.preferredUsername === "string" ? doc.preferredUsername : undefined,
        name: typeof doc.name === "string" ? doc.name : undefined,
        "ad4m:did": typeof doc["ad4m:did"] === "string" ? doc["ad4m:did"] : undefined,
        publicKey,
        fetchedAt: fetchedAt ?? Date.now(),
    };
}

export function resolveAuthorFromActor(actor: ActorInfo | null, actorUrl: string): string {
    if (actor?.["ad4m:did"]) return actor["ad4m:did"];
    return `ap:${actorUrl}`;
}

export function isActorCacheExpired(
    actor: ActorInfo,
    now?: number,
    ttlMs?: number,
): boolean {
    const currentTime = now ?? Date.now();
    const ttl = ttlMs ?? ACTOR_CACHE_TTL_MS;
    return (currentTime - actor.fetchedAt) > ttl;
}

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
