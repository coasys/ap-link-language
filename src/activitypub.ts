/**
 * ActivityPub type definitions and JSON-LD context constants.
 *
 * Covers the AS2 vocabulary subset used by the AP Link Language:
 * Actor (Group), Activity (Create, Delete, Like, Announce),
 * Object (Note), and Collection types.
 */

// ---------------------------------------------------------------------------
// JSON-LD Contexts
// ---------------------------------------------------------------------------

export const AP_CONTEXT = "https://www.w3.org/ns/activitystreams";
export const SECURITY_CONTEXT = "https://w3id.org/security/v1";

/**
 * AD4M extension namespace, carried as a JSON-LD context entry.
 * Non-AD4M servers ignore it; AD4M nodes use it for lossless round-trip.
 */
export const AD4M_NS = "https://ad4m.dev/ns#";

export const AD4M_CONTEXT_ENTRY = {
    ad4m: AD4M_NS,
    "ad4m:Link": { "@type": "@id" },
    "ad4m:source": "ad4m:source",
    "ad4m:predicate": "ad4m:predicate",
    "ad4m:target": "ad4m:target",
    "ad4m:proof": "ad4m:proof",
    "ad4m:did": "ad4m:did",
    "ad4m:neighbourhoodUrl": "ad4m:neighbourhoodUrl",
};

export function apContext(): (string | Record<string, unknown>)[] {
    return [AP_CONTEXT, SECURITY_CONTEXT, AD4M_CONTEXT_ENTRY];
}

// ---------------------------------------------------------------------------
// AP Object Types
// ---------------------------------------------------------------------------

export type APActivityType = "Create" | "Delete" | "Like" | "Announce" | "Follow" | "Accept" | "Reject" | "Undo";
export type APObjectType = "Note" | "Article" | "Group" | "Person" | "OrderedCollection" | "OrderedCollectionPage";

// ---------------------------------------------------------------------------
// AP Interfaces
// ---------------------------------------------------------------------------

export interface APTag {
    type: string;
    [key: string]: unknown;
}

export interface APLinkTag extends APTag {
    type: "ad4m:Link";
    "ad4m:source": string;
    "ad4m:predicate": string;
    "ad4m:target": string;
    "ad4m:proof"?: string;
}

export interface APObject {
    "@context"?: (string | Record<string, unknown>)[];
    type: APObjectType | string;
    id: string;
    attributedTo?: string;
    content?: string;
    published?: string;
    context?: string;
    inReplyTo?: string;
    tag?: APTag[];
    [key: string]: unknown;
}

export interface APActivity {
    "@context": (string | Record<string, unknown>)[];
    type: APActivityType;
    id: string;
    actor: string;
    published: string;
    to?: string[];
    cc?: string[];
    object: APObject | string;
}

export interface APGroupActor {
    "@context": (string | Record<string, unknown>)[];
    type: "Group";
    id: string;
    name: string;
    summary: string;
    inbox: string;
    outbox: string;
    followers: string;
    publicKey: {
        id: string;
        owner: string;
        publicKeyPem: string;
    };
    "ad4m:neighbourhoodUrl"?: string;
    "ad4m:meta"?: Record<string, unknown>;
}

export interface APCollection {
    "@context": (string | Record<string, unknown>)[];
    type: "OrderedCollection";
    id: string;
    totalItems: number;
    first?: string;
    last?: string;
    orderedItems?: APActivity[];
}

export interface APCollectionPage {
    "@context": (string | Record<string, unknown>)[];
    type: "OrderedCollectionPage";
    id: string;
    partOf: string;
    next?: string;
    prev?: string;
    orderedItems: APActivity[];
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Build the Group Actor document for the neighbourhood.
 */
export function buildGroupActor(opts: {
    groupActorUrl: string;
    groupInboxUrl: string;
    groupOutboxUrl: string;
    name: string;
    summary: string;
    publicKeyPem: string;
    neighbourhoodUrl?: string;
    meta?: Record<string, unknown>;
}): APGroupActor {
    return {
        "@context": apContext(),
        type: "Group",
        id: opts.groupActorUrl,
        name: opts.name,
        summary: opts.summary,
        inbox: opts.groupInboxUrl,
        outbox: opts.groupOutboxUrl,
        followers: `${opts.groupActorUrl}/followers`,
        publicKey: {
            id: `${opts.groupActorUrl}#main-key`,
            owner: opts.groupActorUrl,
            publicKeyPem: opts.publicKeyPem,
        },
        ...(opts.neighbourhoodUrl
            ? { "ad4m:neighbourhoodUrl": opts.neighbourhoodUrl }
            : {}),
        ...(opts.meta ? { "ad4m:meta": opts.meta } : {}),
    };
}
