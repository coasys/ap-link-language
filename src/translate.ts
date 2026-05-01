/**
 * Link ↔ Activity translation layer.
 *
 * Implements the bidirectional mapping described in Spec §3.3:
 *
 * - `linkToActivity()` — LinkExpression → AP Create{Note} activity
 * - `activityToLink()` — AP Create{Note} activity → LinkExpression
 * - `removalToActivity()` — LinkExpression (removal) → AP Delete activity
 * - `diffToActivities()` — PerspectiveDiff → array of AP activities
 *
 * Pure functions — no ad4m:host imports. Safe for unit testing.
 */

import type { LinkExpression, PerspectiveDiff } from "./types.js";
import type { APActivity, APObject, APLinkTag, APTag } from "./activitypub.js";
import { apContext } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape HTML entities for safe inclusion in AP Note content.
 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Convert an ISO-8601 timestamp or epoch-ms to ISO-8601 UTC.
 */
export function toISO(ts: string | number): string {
    const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return date.toISOString();
}

/**
 * Derive an AP activity/object ID from the link hash and base URL.
 */
function activityId(baseUrl: string, linkHash: string): string {
    return `${baseUrl}/activities/${linkHash}`;
}

function objectId(baseUrl: string, linkHash: string): string {
    return `${baseUrl}/objects/${linkHash}`;
}

/**
 * Deterministic hash of a LinkExpression for use as a content key.
 * Uses a simple string-concat approach; the caller can supply a
 * proper hash function.
 */
export function linkContentKey(link: LinkExpression): string {
    const data = link.data;
    return `${data.source || ""}:${data.predicate || ""}:${data.target || ""}:${link.author}:${link.timestamp}`;
}

/**
 * Determine if a link's predicate matches chat-style predicates.
 */
function isChatPredicate(predicate: string | undefined, chatPredicates: string[]): boolean {
    if (!predicate) return false;
    return chatPredicates.includes(predicate);
}

// ---------------------------------------------------------------------------
// Link → Activity (Outbound)
// ---------------------------------------------------------------------------

export interface LinkToActivityOptions {
    /** Base URL for the AP group (e.g. "https://example.com/ap/v1/groups/abc") */
    groupActorUrl: string;
    /** AP Actor URL of the committing agent */
    actorUrl: string;
    /** Content hash of the link (from ad4m:host hash()) */
    linkHash: string;
    /** Language settings */
    settings: APLanguageSettings;
    /** Optional resolved content for chat-style links */
    resolvedContent?: string;
}

/**
 * Translate a single LinkExpression addition into an AP Create{Note} activity.
 *
 * Implements the three rendering strategies from Spec §4:
 * - "chat": uses resolved content as plain Note
 * - "semantic": structured ad4m:Link tags with human-readable content
 * - "raw": triple rendering
 * - "auto": detects chat predicates, falls back to semantic
 */
export function linkToActivity(
    link: LinkExpression,
    opts: LinkToActivityOptions,
): APActivity {
    const { groupActorUrl, actorUrl, linkHash, settings, resolvedContent } = opts;
    const rendering = settings.rendering;

    const published = toISO(link.timestamp);
    const source = link.data.source || "";
    const predicate = link.data.predicate || "";
    const target = link.data.target || "";

    // Build the ad4m:Link tag (for lossless round-trip)
    const ad4mTag: APLinkTag = {
        type: "ad4m:Link",
        "ad4m:source": source,
        "ad4m:predicate": predicate,
        "ad4m:target": target,
    };
    if (link.proof?.signature) {
        ad4mTag["ad4m:proof"] = link.proof.signature;
    }

    // Determine rendering strategy
    let strategy = rendering.strategy;
    if (strategy === "auto") {
        strategy = isChatPredicate(predicate, rendering.chatPredicates) && resolvedContent
            ? "chat"
            : "semantic";
    }

    let content: string;
    const tags: APTag[] = [];

    switch (strategy) {
        case "chat":
            content = resolvedContent || escapeHtml(target);
            if (rendering.includeAd4mTags) {
                tags.push(ad4mTag);
            }
            break;

        case "semantic":
            content = `<p><strong>${escapeHtml(link.author)}</strong> linked ` +
                `<code>${escapeHtml(source)}</code> ` +
                `—[<code>${escapeHtml(predicate)}</code>]→ ` +
                `<code>${escapeHtml(target)}</code></p>`;
            tags.push(ad4mTag);
            break;

        case "raw":
        default:
            content = `<p>🔗 <code>${escapeHtml(source)}</code> ` +
                `—[<code>${escapeHtml(predicate)}</code>]→ ` +
                `<code>${escapeHtml(target)}</code></p>`;
            tags.push(ad4mTag);
            break;
    }

    const noteObject: APObject = {
        type: "Note",
        id: objectId(groupActorUrl, linkHash),
        attributedTo: actorUrl,
        content,
        published,
        context: groupActorUrl,
        ...(tags.length > 0 ? { tag: tags } : {}),
    };

    return {
        "@context": apContext(),
        type: "Create",
        id: activityId(groupActorUrl, linkHash),
        actor: actorUrl,
        published,
        to: [`${groupActorUrl}/followers`],
        object: noteObject,
    };
}

// ---------------------------------------------------------------------------
// Removal → Delete Activity (Outbound)
// ---------------------------------------------------------------------------

export interface RemovalToActivityOptions {
    groupActorUrl: string;
    actorUrl: string;
    linkHash: string;
}

/**
 * Translate a LinkExpression removal into an AP Delete activity.
 */
export function removalToActivity(
    link: LinkExpression,
    opts: RemovalToActivityOptions,
): APActivity {
    const { groupActorUrl, actorUrl, linkHash } = opts;
    return {
        "@context": apContext(),
        type: "Delete",
        id: activityId(groupActorUrl, `del-${linkHash}`),
        actor: actorUrl,
        published: toISO(link.timestamp),
        to: [`${groupActorUrl}/followers`],
        object: objectId(groupActorUrl, linkHash),
    };
}

// ---------------------------------------------------------------------------
// PerspectiveDiff → Activities (Outbound batch)
// ---------------------------------------------------------------------------

export interface DiffToActivitiesOptions {
    groupActorUrl: string;
    actorUrl: string;
    settings: APLanguageSettings;
    /** Hash function (from ad4m:host) */
    hashFn: (data: string) => string;
    /** Optional map of expression URIs → resolved content */
    resolvedContent?: Map<string, string>;
}

/**
 * Convert an entire PerspectiveDiff into AP activities.
 */
export function diffToActivities(
    diff: PerspectiveDiff,
    opts: DiffToActivitiesOptions,
): APActivity[] {
    const activities: APActivity[] = [];

    for (const addition of diff.additions) {
        const linkHash = opts.hashFn(linkContentKey(addition));
        const target = addition.data.target || "";
        const resolved = opts.resolvedContent?.get(target);

        activities.push(
            linkToActivity(addition, {
                groupActorUrl: opts.groupActorUrl,
                actorUrl: opts.actorUrl,
                linkHash,
                settings: opts.settings,
                resolvedContent: resolved,
            }),
        );
    }

    for (const removal of diff.removals) {
        const linkHash = opts.hashFn(linkContentKey(removal));
        activities.push(
            removalToActivity(removal, {
                groupActorUrl: opts.groupActorUrl,
                actorUrl: opts.actorUrl,
                linkHash,
            }),
        );
    }

    return activities;
}

// ---------------------------------------------------------------------------
// Activity → Link (Inbound)
// ---------------------------------------------------------------------------

/**
 * Translate an inbound AP Create{Note} activity into a LinkExpression.
 *
 * If the Note carries an `ad4m:Link` tag, reconstruct the native link.
 * Otherwise, create a synthetic link per Spec §8.1:
 *   source = neighbourhoodUrl, predicate = "ap://external-note", target = note.id
 *
 * The `author` field uses the AP Actor URI prefixed with `ap:` for
 * non-AD4M actors (Spec §8.2).
 */
export function activityToLink(
    activity: APActivity,
    neighbourhoodUrl: string,
): LinkExpression | null {
    if (activity.type !== "Create") return null;
    const obj = activity.object;
    if (typeof obj === "string") return null;
    if (obj.type !== "Note" && obj.type !== "Article") return null;

    const note = obj as APObject;
    const published = activity.published || new Date().toISOString();
    const actor = activity.actor;

    // Determine author: if the actor has an ad4m:did field, use it;
    // otherwise prefix with "ap:"
    const author = `ap:${actor}`;

    // Check for ad4m:Link tag
    const ad4mTag = note.tag?.find(
        (t): t is APLinkTag => t.type === "ad4m:Link",
    );

    if (ad4mTag) {
        // Lossless round-trip: reconstruct native link
        return {
            author,
            timestamp: published,
            data: {
                source: ad4mTag["ad4m:source"],
                target: ad4mTag["ad4m:target"],
                predicate: ad4mTag["ad4m:predicate"],
            },
            proof: {
                signature: (ad4mTag["ad4m:proof"] as string) || "",
                key: "",
            },
        };
    }

    // Synthetic link for non-AD4M content
    return {
        author,
        timestamp: published,
        data: {
            source: neighbourhoodUrl,
            target: note.id,
            predicate: "ap://external-note",
        },
        proof: { signature: "", key: "" },
    };
}

/**
 * Translate an AP Delete activity into a removal LinkExpression.
 */
export function deleteActivityToRemoval(
    activity: APActivity,
    neighbourhoodUrl: string,
): LinkExpression | null {
    if (activity.type !== "Delete") return null;

    const objectId = typeof activity.object === "string"
        ? activity.object
        : (activity.object as APObject).id;

    const author = `ap:${activity.actor}`;
    return {
        author,
        timestamp: activity.published || new Date().toISOString(),
        data: {
            source: neighbourhoodUrl,
            target: objectId,
            predicate: "ap://deleted",
        },
        proof: { signature: "", key: "" },
    };
}

/**
 * Translate a Like activity into a link.
 */
export function likeActivityToLink(
    activity: APActivity,
): LinkExpression | null {
    if (activity.type !== "Like") return null;
    const objectId = typeof activity.object === "string"
        ? activity.object
        : (activity.object as APObject).id;
    const author = `ap:${activity.actor}`;

    return {
        author,
        timestamp: activity.published || new Date().toISOString(),
        data: {
            source: objectId,
            target: activity.actor,
            predicate: "ap://liked-by",
        },
        proof: { signature: "", key: "" },
    };
}

/**
 * Translate an Announce (boost) activity into a link.
 */
export function announceActivityToLink(
    activity: APActivity,
): LinkExpression | null {
    if (activity.type !== "Announce") return null;
    const objectId = typeof activity.object === "string"
        ? activity.object
        : (activity.object as APObject).id;
    const author = `ap:${activity.actor}`;

    return {
        author,
        timestamp: activity.published || new Date().toISOString(),
        data: {
            source: objectId,
            target: activity.actor,
            predicate: "ap://announced-by",
        },
        proof: { signature: "", key: "" },
    };
}

/**
 * Generic inbound activity → LinkExpression dispatcher.
 * Routes to the appropriate handler based on activity type.
 */
export function inboundActivityToLink(
    activity: APActivity,
    neighbourhoodUrl: string,
): LinkExpression | null {
    switch (activity.type) {
        case "Create":
            return activityToLink(activity, neighbourhoodUrl);
        case "Delete":
            return deleteActivityToRemoval(activity, neighbourhoodUrl);
        case "Like":
            return likeActivityToLink(activity);
        case "Announce":
            return announceActivityToLink(activity);
        default:
            return null;
    }
}
