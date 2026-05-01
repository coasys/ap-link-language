/**
 * SDNA / Subject Class pattern detection — pure module.
 *
 * Detects known Subject Class patterns in LinkExpressions for smart
 * content rendering. Enables chat messages, threaded replies, mentions,
 * and reactions to be translated into appropriate AP activity types
 * instead of generic Create{Note} with triple rendering.
 *
 * Spec §3.1 + §4.2.
 *
 * Pure functions — no ad4m:host imports. Safe for unit testing.
 */

import type { LinkExpression } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedPattern {
    type: "chat-message" | "reply" | "content" | "mention" | "reaction" | "unknown";
    /** Expression URI to resolve for content (e.g. the message expression) */
    contentUri?: string;
    /** For replies: the parent message URI */
    parentUri?: string;
    /** For chat: the channel/conversation URI */
    channelUri?: string;
    /** For mentions: the mentioned agent DID or URI */
    mentionedAgent?: string;
}

// ---------------------------------------------------------------------------
// Well-known predicates
// ---------------------------------------------------------------------------

const REPLY_PREDICATES = new Set([
    "flux://has_reply",
    "sioc://reply_of",
]);

const REACTION_PREDICATES = new Set([
    "flux://has_reaction",
    "emoji://reaction",
]);

const CONTENT_PREDICATE = "sioc://content_of";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the Subject Class pattern of a link based on its predicate.
 *
 * Priority (first match wins):
 * 1. Predicate in `chatPredicates` → chat-message
 * 2. Reply predicates → reply
 * 3. Predicate contains "mention" → mention
 * 4. Reaction predicates → reaction
 * 5. sioc://content_of → content
 * 6. Default → unknown
 */
export function detectPattern(
    link: LinkExpression,
    chatPredicates: string[],
): DetectedPattern {
    const predicate = link.data.predicate || "";
    const source = link.data.source || "";
    const target = link.data.target || "";

    // 1. Chat message — predicate matches configured chat predicates
    if (predicate && chatPredicates.includes(predicate)) {
        return {
            type: "chat-message",
            contentUri: target,
            channelUri: source,
        };
    }

    // 2. Reply — threaded reply predicates
    if (REPLY_PREDICATES.has(predicate)) {
        return {
            type: "reply",
            contentUri: target,
            parentUri: source,
        };
    }

    // 3. Mention — predicate contains "mention" (case-insensitive)
    if (predicate && predicate.toLowerCase().includes("mention")) {
        return {
            type: "mention",
            mentionedAgent: target,
        };
    }

    // 4. Reaction — emoji/like predicates
    if (REACTION_PREDICATES.has(predicate)) {
        return {
            type: "reaction",
            contentUri: target,
        };
    }

    // 5. Content — generic content posting
    if (predicate === CONTENT_PREDICATE) {
        return {
            type: "content",
            contentUri: target,
        };
    }

    // 6. Unknown — no recognized pattern
    return { type: "unknown" };
}
