/**
 * Link ↔ Activity translation layer.
 *
 * Implements the bidirectional mapping described in Spec §3.3.
 *
 * Also includes:
 * - SDNA / Subject Class pattern detection (was sdna.ts)
 * - Dual-language deduplication and origin tracking (was dual-language.ts)
 *
 * Pure functions — no ad4m:host imports. Safe for unit testing.
 */

import type { LinkExpression, PerspectiveDiff } from "./types.js";
import type { APActivity, APObject, APLinkTag, APTag } from "./activitypub.js";
import { apContext } from "./activitypub.js";
import type { APLanguageSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// SDNA / Subject Class pattern detection (was sdna.ts)
// ---------------------------------------------------------------------------

export interface DetectedPattern {
    type: "chat-message" | "reply" | "content" | "mention" | "reaction" | "unknown";
    contentUri?: string;
    parentUri?: string;
    channelUri?: string;
    mentionedAgent?: string;
}

const REPLY_PREDICATES = new Set([
    "flux://has_reply",
    "sioc://reply_of",
]);

const REACTION_PREDICATES = new Set([
    "flux://has_reaction",
    "emoji://reaction",
]);

const CONTENT_PREDICATE = "sioc://content_of";

export function detectPattern(
    link: LinkExpression,
    chatPredicates: string[],
): DetectedPattern {
    const predicate = link.data.predicate || "";
    const source = link.data.source || "";
    const target = link.data.target || "";

    if (predicate && chatPredicates.includes(predicate)) {
        return { type: "chat-message", contentUri: target, channelUri: source };
    }
    if (REPLY_PREDICATES.has(predicate)) {
        return { type: "reply", contentUri: target, parentUri: source };
    }
    if (predicate && predicate.toLowerCase().includes("mention")) {
        return { type: "mention", mentionedAgent: target };
    }
    if (REACTION_PREDICATES.has(predicate)) {
        return { type: "reaction", contentUri: target };
    }
    if (predicate === CONTENT_PREDICATE) {
        return { type: "content", contentUri: target };
    }
    return { type: "unknown" };
}

// ---------------------------------------------------------------------------
// Dual-language deduplication and origin tracking (was dual-language.ts)
// ---------------------------------------------------------------------------

export type LinkOrigin = "ap" | "native" | "dual";

function canonicalLinkData(link: LinkExpression): string {
    return JSON.stringify({
        source: link.data.source || "",
        predicate: link.data.predicate || "",
        target: link.data.target || "",
    });
}

export function isDuplicate(
    link: LinkExpression,
    existingHashes: Set<string>,
    hashFn: (data: string) => string,
): boolean {
    const contentHash = hashFn(canonicalLinkData(link));
    return existingHashes.has(contentHash);
}

export function linkContentHash(
    link: LinkExpression,
    hashFn: (data: string) => string,
): string {
    return hashFn(canonicalLinkData(link));
}

export function linkOriginKey(linkHash: string): string {
    return `link-origin/${linkHash}`;
}

export function shouldFederate(
    linkHash: string,
    getOrigin: (key: string) => string | null,
): boolean {
    const origin = getOrigin(linkOriginKey(linkHash));
    if (origin === null) return true;
    return origin !== "ap";
}

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
 * Build an ad4m:Link tag from a LinkExpression.
 */
function buildAd4mTag(link: LinkExpression): APLinkTag {
    const tag: APLinkTag = {
        type: "ad4m:Link",
        "ad4m:source": link.data.source || "",
        "ad4m:predicate": link.data.predicate || "",
        "ad4m:target": link.data.target || "",
    };
    if (link.proof?.signature) {
        tag["ad4m:proof"] = link.proof.signature;
    }
    return tag;
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
    /** Optional hash function (needed by linkToRichActivity for reactions) */
    hashFn?: (data: string) => string;
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
    /** Optional map of parent URIs → AP object URLs (for reply threading) */
    parentApObjectUrls?: Map<string, string>;
    /** Optional map of mentioned agent URIs → { actorUrl, handle } */
    mentionActors?: Map<string, { actorUrl: string; handle: string }>;
    /** Optional filter: skip links that should not be federated */
    shouldFederate?: (linkHash: string) => boolean;
}

/**
 * Convert an entire PerspectiveDiff into AP activities.
 *
 * Uses SDNA pattern detection for rich rendering when patterns are
 * recognized, falling back to standard linkToActivity() for unknown
 * patterns.
 */
export function diffToActivities(
    diff: PerspectiveDiff,
    opts: DiffToActivitiesOptions,
): APActivity[] {
    const activities: APActivity[] = [];
    const chatPredicates = opts.settings.rendering.chatPredicates;

    for (const addition of diff.additions) {
        const linkHash = opts.hashFn(linkContentKey(addition));

        // Check federation filter
        if (opts.shouldFederate && !opts.shouldFederate(linkHash)) {
            continue;
        }

        const target = addition.data.target || "";
        const resolved = opts.resolvedContent?.get(target);

        // Detect SDNA pattern
        const pattern = detectPattern(addition, chatPredicates);

        if (pattern.type !== "unknown" && pattern.type !== "content") {
            // Use rich rendering for recognized patterns
            const parentApObjectUrl = addition.data.source
                ? opts.parentApObjectUrls?.get(addition.data.source)
                : undefined;

            const mentionInfo = pattern.type === "mention" && pattern.mentionedAgent
                ? opts.mentionActors?.get(pattern.mentionedAgent)
                : undefined;

            activities.push(
                linkToRichActivity(addition, pattern, {
                    groupActorUrl: opts.groupActorUrl,
                    actorUrl: opts.actorUrl,
                    linkHash,
                    settings: opts.settings,
                    resolvedContent: resolved,
                    parentApObjectUrl,
                    mentionActorUrl: mentionInfo?.actorUrl,
                    mentionHandle: mentionInfo?.handle,
                    hashFn: opts.hashFn,
                }),
            );
        } else {
            // Standard rendering for unknown/content patterns
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
    }

    for (const removal of diff.removals) {
        const linkHash = opts.hashFn(linkContentKey(removal));

        // Check federation filter for removals too
        if (opts.shouldFederate && !opts.shouldFederate(linkHash)) {
            continue;
        }

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
 * Generic inbound activity → LinkExpression(s) dispatcher.
 * Routes to the appropriate handler based on activity type.
 *
 * Returns an array of LinkExpressions — a single inbound activity
 * can produce multiple links (e.g. a Note with inReplyTo produces
 * both the content link and a reply link).
 */
export function inboundActivityToLinks(
    activity: APActivity,
    neighbourhoodUrl: string,
    groupActorUrl?: string,
): LinkExpression[] {
    const links: LinkExpression[] = [];

    switch (activity.type) {
        case "Create": {
            const primaryLink = activityToLink(activity, neighbourhoodUrl);
            if (primaryLink) links.push(primaryLink);

            const obj = activity.object;
            if (typeof obj !== "string" && (obj.type === "Note" || obj.type === "Article")) {
                const note = obj as APObject;
                const published = activity.published || new Date().toISOString();
                const author = `ap:${activity.actor}`;

                // inReplyTo → flux://has_reply link
                if (note.inReplyTo && typeof note.inReplyTo === "string") {
                    links.push({
                        author,
                        timestamp: published,
                        data: {
                            source: note.inReplyTo,
                            target: note.id,
                            predicate: "flux://has_reply",
                        },
                        proof: { signature: "", key: "" },
                    });
                }

                // Mention tags → mention links
                if (note.tag && Array.isArray(note.tag)) {
                    for (const tag of note.tag) {
                        if (tag.type === "Mention" && typeof tag.href === "string") {
                            links.push({
                                author,
                                timestamp: published,
                                data: {
                                    source: note.id,
                                    target: tag.href as string,
                                    predicate: "flux://has_mention",
                                },
                                proof: { signature: "", key: "" },
                            });
                        }
                    }
                }

                // Thread context → associate with channel
                if (groupActorUrl && note.context === groupActorUrl && primaryLink) {
                    // The primary link already has the neighbourhood as source
                    // when it's a synthetic link. For context-aware routing,
                    // we mark it via the existing source field.
                }
            }
            break;
        }

        case "Delete": {
            const removal = deleteActivityToRemoval(activity, neighbourhoodUrl);
            if (removal) links.push(removal);
            break;
        }

        case "Like": {
            const like = likeActivityToLink(activity);
            if (like) links.push(like);
            break;
        }

        case "Announce": {
            const announce = announceActivityToLink(activity);
            if (announce) links.push(announce);
            break;
        }
    }

    return links;
}

/**
 * Generic inbound activity → LinkExpression dispatcher.
 * Routes to the appropriate handler based on activity type.
 *
 * Returns the primary link only (for backward compatibility).
 * Use `inboundActivityToLinks()` for full multi-link translation.
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

// ---------------------------------------------------------------------------
// Rich Activity Translation (Outbound — Pattern-Aware)
// ---------------------------------------------------------------------------

/**
 * Translate a LinkExpression into an AP Activity using SDNA pattern
 * detection for smart rendering.
 *
 * For chat-message patterns:
 *   - Content = resolved Expression content (not the URI)
 *   - context = group actor URL (conversation context)
 *
 * For reply patterns:
 *   - Content = resolved Expression content
 *   - inReplyTo = translated parent URI → AP object URL
 *
 * For mention patterns:
 *   - Adds AP Mention tags with href and name
 *
 * For reaction patterns:
 *   - Uses AP Like activity type instead of Create{Note}
 *
 * Falls back to linkToActivity() for unknown/content patterns.
 */
export function linkToRichActivity(
    link: LinkExpression,
    pattern: DetectedPattern,
    opts: LinkToActivityOptions & {
        resolvedContent?: string;
        /** For replies: the AP object URL of the parent */
        parentApObjectUrl?: string;
        /** For mentions: resolved actor URL and handle */
        mentionActorUrl?: string;
        mentionHandle?: string;
    },
): APActivity {
    const { groupActorUrl, actorUrl, linkHash, settings } = opts;
    const published = toISO(link.timestamp);

    switch (pattern.type) {
        case "chat-message": {
            const content = opts.resolvedContent || escapeHtml(link.data.target || "");
            const tags: APTag[] = [];

            // Include ad4m:Link tag for round-trip fidelity
            if (settings.rendering.includeAd4mTags) {
                tags.push(buildAd4mTag(link));
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

        case "reply": {
            const content = opts.resolvedContent || escapeHtml(link.data.target || "");
            const tags: APTag[] = [];

            if (settings.rendering.includeAd4mTags) {
                tags.push(buildAd4mTag(link));
            }

            const noteObject: APObject = {
                type: "Note",
                id: objectId(groupActorUrl, linkHash),
                attributedTo: actorUrl,
                content,
                published,
                context: groupActorUrl,
                ...(opts.parentApObjectUrl
                    ? { inReplyTo: opts.parentApObjectUrl }
                    : {}),
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

        case "mention": {
            const content = opts.resolvedContent || escapeHtml(link.data.target || "");
            const tags: APTag[] = [];

            if (settings.rendering.includeAd4mTags) {
                tags.push(buildAd4mTag(link));
            }

            // Add Mention tag
            if (opts.mentionActorUrl) {
                tags.push({
                    type: "Mention",
                    href: opts.mentionActorUrl,
                    name: opts.mentionHandle || `@${opts.mentionActorUrl}`,
                });
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

        case "reaction": {
            // Reactions use AP Like activity type
            const objectUrl = pattern.contentUri
                ? objectId(groupActorUrl, opts.hashFn
                    ? opts.hashFn(pattern.contentUri)
                    : pattern.contentUri)
                : objectId(groupActorUrl, linkHash);

            return {
                "@context": apContext(),
                type: "Like",
                id: activityId(groupActorUrl, linkHash),
                actor: actorUrl,
                published,
                to: [`${groupActorUrl}/followers`],
                object: {
                    type: "Note",
                    id: objectUrl,
                },
            };
        }

        // "content" and "unknown" — fall through to standard rendering
        default:
            return linkToActivity(link, opts);
    }
}
