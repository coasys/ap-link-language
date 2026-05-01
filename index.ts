/**
 * # ActivityPub Link Language for AD4M
 *
 * Bridge language that syncs Perspectives via ActivityPub federation.
 * Implements perspective-commit, perspective-sync, perspective-query,
 * and peers capabilities.
 *
 * Phase 1: outbound-only MVP — publishes links as AP Create{Note}
 * activities, maintains a local link store, and provides query access.
 *
 * Spec: activitypub-link-language.md
 */

import {
    defineLanguage,
    agentDid,
    agentCreateSignedExpression,
    hash,
    languageSettings,
    emitPerspectiveDiff,
} from "@coasys/ad4m-ldk";

import type { PerspectiveDiff, LinkExpression } from "./src/types.js";
import { parseSettings } from "./src/settings.js";
import type { APLanguageSettings } from "./src/settings.js";
import { diffToActivities, linkContentKey } from "./src/translate.js";
import * as store from "./src/store.js";
import { deliverToFollowers } from "./src/delivery.js";
import { syncFromOutbox } from "./src/sync.js";
import { buildGroupActor } from "./src/activitypub.js";

// ---------------------------------------------------------------------------
// Template Variables (per Spec §6)
// ---------------------------------------------------------------------------

//!@ad4m-template-variable
const GROUP_ACTOR_URL = "<to-be-filled>";

//!@ad4m-template-variable
const GROUP_INBOX_URL = "<to-be-filled>";

//!@ad4m-template-variable
const GROUP_OUTBOX_URL = "<to-be-filled>";

//!@ad4m-template-variable
const FEDERATION_DOMAIN = "<to-be-filled>";

//!@ad4m-template-variable
const NEIGHBOURHOOD_META = "<to-be-filled>";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let myDid: string = "";
let settings: APLanguageSettings;
let actorKeyId: string = "";

/**
 * Derive the AP Actor URL for the current agent on this federation domain.
 */
function agentActorUrl(): string {
    return `https://${FEDERATION_DOMAIN}/ap/v1/users/${encodeURIComponent(myDid)}`;
}

/**
 * Get the neighbourhood URL from the language address.
 */
function neighbourhoodUrl(): string {
    // In production this would use languageAddress() but that's
    // only available at runtime. Template variable serves as fallback.
    return `neighbourhood://${GROUP_ACTOR_URL}`;
}

/**
 * Read follower inbox URLs from the peer store.
 * Phase 1: manually managed via peersSetLocal.
 */
function followerInboxes(): string[] {
    const peerDids = store.listPeers("peers/");
    const inboxes: string[] = [];
    for (const did of peerDids) {
        const meta = store.getPeerMetadata(did);
        if (meta?.inbox && typeof meta.inbox === "string") {
            inboxes.push(meta.inbox);
        }
    }
    return inboxes;
}

// ---------------------------------------------------------------------------
// Language definition
// ---------------------------------------------------------------------------

const language = defineLanguage({
    name: "@coasys/ap-link-language",
    version: "0.1.0",

    isPublic: true,

    async init() {
        myDid = agentDid();
        settings = parseSettings(languageSettings());
        actorKeyId = `${GROUP_ACTOR_URL}#main-key`;

        console.log(`[ap-link-language] init: did=${myDid}, domain=${FEDERATION_DOMAIN}`);
        console.log(`[ap-link-language] group actor: ${GROUP_ACTOR_URL}`);
        console.log(`[ap-link-language] sync mode: ${settings.syncMode}`);
    },

    async teardown() {
        myDid = "";
        console.log("[ap-link-language] teardown");
    },

    interactions() {
        return [];
    },

    // -----------------------------------------------------------------------
    // perspective-commit
    // -----------------------------------------------------------------------
    commit: {
        async commit(diff: PerspectiveDiff) {
            // 1. Store links locally
            store.applyDiff(diff);

            // 2. Translate to AP activities
            const activities = diffToActivities(diff, {
                groupActorUrl: GROUP_ACTOR_URL,
                actorUrl: agentActorUrl(),
                settings,
                hashFn: hash,
            });

            // 3. Deliver to followers (fire-and-forget + signal emission)
            const inboxes = followerInboxes();
            if (inboxes.length > 0 && activities.length > 0) {
                for (const activity of activities) {
                    await deliverToFollowers(
                        activity,
                        inboxes,
                        actorKeyId,
                        GROUP_ACTOR_URL,
                    );
                }
            } else if (activities.length > 0) {
                // No known inboxes — still emit signals for the executor
                const { emitDeliveryRequest } = await import("./src/delivery.js");
                for (const activity of activities) {
                    emitDeliveryRequest(activity, GROUP_ACTOR_URL);
                }
            }

            // 4. Emit the perspective diff for local subscribers
            emitPerspectiveDiff(diff);

            return "";
        },
    },

    // -----------------------------------------------------------------------
    // perspective-sync
    // -----------------------------------------------------------------------
    sync: {
        async sync() {
            // Phase 1: outbound-only — sync is a no-op for remote fetching.
            // The infrastructure for Phase 2 outbox polling is in sync.ts.
            return await syncFromOutbox(GROUP_OUTBOX_URL, neighbourhoodUrl());
        },

        async render() {
            return store.allLinks();
        },

        async currentRevision() {
            return store.getRevision() || "";
        },
    },

    // -----------------------------------------------------------------------
    // perspective-query
    // -----------------------------------------------------------------------
    query: {
        supportedKinds() {
            return ["link-pattern"];
        },

        async run(req: { kind: string; payload: unknown }) {
            if (req.kind !== "link-pattern") {
                return { kind: "error", payload: `Unsupported query kind: ${req.kind}` };
            }
            const pattern = req.payload as { source?: string; target?: string; predicate?: string };
            const links = store.queryLinks(pattern);
            return { kind: "links", payload: links };
        },
    },

    // -----------------------------------------------------------------------
    // peers
    // -----------------------------------------------------------------------
    peers: {
        setLocal(agents: string[]) {
            // Store local agent set as peers
            for (const did of agents) {
                store.setPeer(did, { local: true });
            }
        },

        async remote() {
            // Remote peers are AP followers with DIDs
            return store.listPeers("peers/");
        },
    },
});

// ---------------------------------------------------------------------------
// Flat exports (required by the AD4M runtime dispatcher)
// ---------------------------------------------------------------------------

export const {
    name,
    version,
    isPublic,
    init,
    teardown,
    interactions,
    perspectiveCommit,
    perspectiveSyncSync,
    perspectiveSyncRender,
    perspectiveSyncCurrentRevision,
    perspectiveQuerySupportedKinds,
    perspectiveQueryRun,
    peersSetLocal,
    peersRemote,
} = language;

export default language;

// ---------------------------------------------------------------------------
// Phase 0 transitional: callback registration
// Mirrors centralized-p-diff-sync for runtime compatibility.
// ---------------------------------------------------------------------------

let linkCallback: ((diff: PerspectiveDiff) => void) | null = null;
let syncStateChangeCallback: ((state: string) => void) | null = null;

export function linkSyncAddCallback(callback: (diff: PerspectiveDiff) => void): number {
    linkCallback = callback;
    return 1;
}

export function linkSyncRemoveCallback(callback: (diff: PerspectiveDiff) => void): number {
    if (linkCallback === callback) linkCallback = null;
    return 1;
}

export function linkSyncAddSyncStateChangeCallback(callback: (state: string) => void): number {
    syncStateChangeCallback = callback;
    return 1;
}
