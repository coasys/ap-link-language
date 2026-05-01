/**
 * Dual-language deduplication — pure module.
 *
 * When the AP Link Language operates alongside a primary link language
 * (e.g. Holochain), we need to:
 * - Deduplicate links that arrive via both AP and native sync
 * - Track which links originated from AP vs native
 * - Filter outbound federation for links that arrived via AP
 *   (to avoid echo/re-federation loops)
 *
 * Spec §3.4 + §13.
 *
 * Pure functions — no ad4m:host imports. Safe for unit testing.
 */

import type { LinkExpression } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkOrigin = "ap" | "native" | "dual";

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Compute a canonical hash key for a link, used for dedup comparison.
 *
 * Uses the caller-provided hash function (from ad4m:host at runtime,
 * or a simple implementation in tests).
 */
function canonicalLinkData(link: LinkExpression): string {
    return JSON.stringify({
        source: link.data.source || "",
        predicate: link.data.predicate || "",
        target: link.data.target || "",
    });
}

/**
 * Check if a link already exists in the store (dedup before applying).
 *
 * Computes a content-based hash of the link's triple (source, predicate,
 * target) — author/timestamp are intentionally excluded so that the
 * same logical link from different sync paths is detected as a duplicate.
 */
export function isDuplicate(
    link: LinkExpression,
    existingHashes: Set<string>,
    hashFn: (data: string) => string,
): boolean {
    const contentHash = hashFn(canonicalLinkData(link));
    return existingHashes.has(contentHash);
}

/**
 * Compute the content hash of a link for dedup tracking.
 */
export function linkContentHash(
    link: LinkExpression,
    hashFn: (data: string) => string,
): string {
    return hashFn(canonicalLinkData(link));
}

// ---------------------------------------------------------------------------
// Origin tracking
// ---------------------------------------------------------------------------

/**
 * Build the storage key for tracking a link's origin.
 *
 * Storage layout: `link-origin/{link-hash}` → "ap" | "native" | "dual"
 */
export function linkOriginKey(linkHash: string): string {
    return `link-origin/${linkHash}`;
}

// ---------------------------------------------------------------------------
// Federation filtering
// ---------------------------------------------------------------------------

/**
 * Determine if an outbound link should be federated.
 *
 * Links that originated from AP should NOT be re-federated to avoid
 * echo loops. Only "native" or "dual" origin links (or links with
 * no tracked origin, i.e. new local commits) should be federated.
 *
 * @param linkHash   The hash of the link to check
 * @param getOrigin  Lookup function that retrieves origin from storage
 * @returns true if the link should be federated outbound
 */
export function shouldFederate(
    linkHash: string,
    getOrigin: (key: string) => string | null,
): boolean {
    const origin = getOrigin(linkOriginKey(linkHash));
    // If no origin tracked, it's a new local commit — federate it
    if (origin === null) return true;
    // Only skip federation for links that came purely from AP
    return origin !== "ap";
}
