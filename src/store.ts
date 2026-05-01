/**
 * Local link store — wraps the ad4m:host storage KV API to maintain
 * a link store with indexes per Spec §5.6.
 *
 * Key scheme:
 *   links/{link-hash}                → serialized LinkExpression
 *   links-by-source/{source}/{hash}  → link-hash
 *   links-by-target/{target}/{hash}  → link-hash
 *   links-by-pred/{predicate}/{hash} → link-hash
 *   revision                         → last known AP outbox page URL
 *   ap-objects/{ap-id-hash}          → serialized AP object JSON
 *   peers/{did}                      → peer metadata JSON
 */

import {
    storageGet,
    storagePut,
    storageDelete,
    storageListKeys,
    hash,
} from "@coasys/ad4m-ldk";

import type { LinkExpression, PerspectiveDiff, Perspective } from "./types.js";

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function linkKey(linkHash: string): string {
    return `links/${linkHash}`;
}

function sourceIndexKey(source: string, linkHash: string): string {
    return `links-by-source/${source}/${linkHash}`;
}

function targetIndexKey(target: string, linkHash: string): string {
    return `links-by-target/${target}/${linkHash}`;
}

function predIndexKey(predicate: string, linkHash: string): string {
    return `links-by-pred/${predicate}/${linkHash}`;
}

function peerKey(did: string): string {
    return `peers/${did}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash for a LinkExpression.
 */
export function hashLink(link: LinkExpression): string {
    const content = JSON.stringify({
        source: link.data.source,
        predicate: link.data.predicate,
        target: link.data.target,
        author: link.author,
        timestamp: link.timestamp,
    });
    return hash(content);
}

/**
 * Store a single LinkExpression and update all indexes.
 */
export function putLink(link: LinkExpression): string {
    const h = hashLink(link);
    storagePut(linkKey(h), JSON.stringify(link));

    const source = link.data.source || "";
    const target = link.data.target || "";
    const predicate = link.data.predicate || "";

    if (source) storagePut(sourceIndexKey(source, h), h);
    if (target) storagePut(targetIndexKey(target, h), h);
    if (predicate) storagePut(predIndexKey(predicate, h), h);

    return h;
}

/**
 * Remove a LinkExpression and its index entries.
 */
export function removeLink(link: LinkExpression): void {
    const h = hashLink(link);
    storageDelete(linkKey(h));

    const source = link.data.source || "";
    const target = link.data.target || "";
    const predicate = link.data.predicate || "";

    if (source) storageDelete(sourceIndexKey(source, h));
    if (target) storageDelete(targetIndexKey(target, h));
    if (predicate) storageDelete(predIndexKey(predicate, h));
}

/**
 * Retrieve a link by its hash.
 */
export function getLink(linkHash: string): LinkExpression | null {
    const raw = storageGet(linkKey(linkHash));
    if (!raw) return null;
    return JSON.parse(raw) as LinkExpression;
}

/**
 * Apply a full PerspectiveDiff to the store.
 */
export function applyDiff(diff: PerspectiveDiff): void {
    for (const addition of diff.additions) {
        putLink(addition);
    }
    for (const removal of diff.removals) {
        removeLink(removal);
    }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface LinkQuery {
    source?: string;
    target?: string;
    predicate?: string;
}

/**
 * Query links by pattern. Supports filtering by source, target,
 * and/or predicate. Returns all links when no filter is given.
 */
export function queryLinks(query: LinkQuery): LinkExpression[] {
    const { source, target, predicate } = query;

    // Determine which index to use for the primary scan
    let candidateHashes: string[];

    if (source) {
        const keys = storageListKeys(`links-by-source/${source}/`);
        candidateHashes = keys.map((k) => {
            const raw = storageGet(k);
            return raw || "";
        }).filter(Boolean);
    } else if (target) {
        const keys = storageListKeys(`links-by-target/${target}/`);
        candidateHashes = keys.map((k) => {
            const raw = storageGet(k);
            return raw || "";
        }).filter(Boolean);
    } else if (predicate) {
        const keys = storageListKeys(`links-by-pred/${predicate}/`);
        candidateHashes = keys.map((k) => {
            const raw = storageGet(k);
            return raw || "";
        }).filter(Boolean);
    } else {
        // Full scan
        const keys = storageListKeys("links/");
        candidateHashes = keys.map((k) => k.replace("links/", ""));
    }

    // Fetch and filter
    const results: LinkExpression[] = [];
    const seen = new Set<string>();

    for (const h of candidateHashes) {
        if (seen.has(h)) continue;
        seen.add(h);

        const link = getLink(h);
        if (!link) continue;

        // Apply remaining filters
        if (source && link.data.source !== source) continue;
        if (target && link.data.target !== target) continue;
        if (predicate && link.data.predicate !== predicate) continue;

        results.push(link);
    }

    return results;
}

/**
 * Return all links in the store as a Perspective.
 */
export function allLinks(): Perspective {
    const keys = storageListKeys("links/");
    const links: LinkExpression[] = [];

    for (const key of keys) {
        const raw = storageGet(key);
        if (raw) {
            links.push(JSON.parse(raw) as LinkExpression);
        }
    }

    return { links };
}

// ---------------------------------------------------------------------------
// Revision tracking
// ---------------------------------------------------------------------------

const REVISION_KEY = "revision";

export function getRevision(): string | null {
    return storageGet(REVISION_KEY);
}

export function setRevision(rev: string): void {
    storagePut(REVISION_KEY, rev);
}

// ---------------------------------------------------------------------------
// AP objects cache
// ---------------------------------------------------------------------------

export function putAPObject(apId: string, json: string): void {
    const key = `ap-objects/${hash(apId)}`;
    storagePut(key, json);
}

export function getAPObject(apId: string): string | null {
    const key = `ap-objects/${hash(apId)}`;
    return storageGet(key);
}

// ---------------------------------------------------------------------------
// Peer management
// ---------------------------------------------------------------------------

export function setPeer(did: string, metadata: Record<string, unknown> = {}): void {
    storagePut(peerKey(did), JSON.stringify(metadata));
}

export function removePeer(did: string): void {
    storageDelete(peerKey(did));
}

export function listPeers(prefix: string = "peers/"): string[] {
    const keys = storageListKeys(prefix);
    return keys.map((k) => k.replace(prefix, ""));
}

export function getPeerMetadata(did: string): Record<string, unknown> | null {
    const raw = storageGet(peerKey(did));
    if (!raw) return null;
    return JSON.parse(raw);
}
