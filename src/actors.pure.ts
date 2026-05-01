/**
 * Pure actor resolution logic — no ad4m:host imports.
 * Testable without the executor runtime.
 *
 * Handles AP Actor document parsing, DID extraction, and cache TTL.
 * Spec §2.4 + §8.2.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActorPublicKey {
    id: string;
    owner: string;
    publicKeyPem: string;
}

export interface ActorInfo {
    /** Actor URI */
    id: string;
    /** AP Actor type (Person, Group, Service, etc.) */
    type: string;
    /** Inbox URL for delivering activities */
    inbox: string;
    /** Outbox URL for fetching published activities */
    outbox?: string;
    /** Preferred username (handle) */
    preferredUsername?: string;
    /** Display name */
    name?: string;
    /** AD4M DID if the actor is an AD4M agent */
    "ad4m:did"?: string;
    /** Public key for HTTP Signature verification */
    publicKey?: ActorPublicKey;
    /** Timestamp when this document was fetched */
    fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default cache TTL: 24 hours */
export const ACTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Parse a raw AP Actor JSON document into a typed ActorInfo.
 *
 * Returns null if the document is missing required fields (id, type, inbox).
 */
export function parseActorDocument(json: unknown, fetchedAt?: number): ActorInfo | null {
    if (!json || typeof json !== "object") return null;
    const doc = json as Record<string, unknown>;

    const id = doc.id;
    if (typeof id !== "string" || !id) return null;

    const type = doc.type;
    if (typeof type !== "string" || !type) return null;

    const inbox = doc.inbox;
    if (typeof inbox !== "string" || !inbox) return null;

    // Parse public key if present
    let publicKey: ActorPublicKey | undefined;
    if (doc.publicKey && typeof doc.publicKey === "object") {
        const pk = doc.publicKey as Record<string, unknown>;
        if (typeof pk.id === "string" && typeof pk.owner === "string" && typeof pk.publicKeyPem === "string") {
            publicKey = {
                id: pk.id,
                owner: pk.owner,
                publicKeyPem: pk.publicKeyPem,
            };
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

/**
 * Resolve the author identity from an actor document.
 *
 * If the actor has an `ad4m:did` field, returns the native DID.
 * Otherwise returns `ap:{actorUrl}` per Spec §8.2.
 */
export function resolveAuthorFromActor(actor: ActorInfo | null, actorUrl: string): string {
    if (actor?.["ad4m:did"]) {
        return actor["ad4m:did"];
    }
    return `ap:${actorUrl}`;
}

/**
 * Check if a cached actor document has expired past its TTL.
 */
export function isActorCacheExpired(
    actor: ActorInfo,
    now?: number,
    ttlMs?: number,
): boolean {
    const currentTime = now ?? Date.now();
    const ttl = ttlMs ?? ACTOR_CACHE_TTL_MS;
    return (currentTime - actor.fetchedAt) > ttl;
}
