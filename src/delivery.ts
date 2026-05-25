/**
 * AP HTTP delivery — outbound activity delivery via httpFetch.
 *
 * Delivers to known follower inboxes using HTTP POST with
 * HTTP Signatures. Delivery is fire-and-forget from the language's
 * perspective — the language also emits signals so the executor's
 * federation service can implement retry and shared-inbox optimization.
 */

import { getRuntime, getTransport } from "./adapters.js";
import { signedHeaders } from "./http-signatures.js";
import type { APActivity } from "./activitypub.js";

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface DeliveryResult {
    targetUrl: string;
    status: number;
    ok: boolean;
    error?: string;
}

/**
 * Deliver an AP activity to a single inbox URL.
 *
 * Uses `httpFetch` from ad4m:host for the actual HTTP request.
 * Signs the request with HTTP Signatures using the agent's keypair.
 *
 * @param activity    The AP activity to deliver
 * @param inboxUrl    Target inbox URL
 * @param actorKeyId  Signing key ID (e.g. "https://example.com/ap/v1/groups/abc#main-key")
 * @returns DeliveryResult with status
 */
export async function deliverToInbox(
    activity: APActivity,
    inboxUrl: string,
    actorKeyId: string,
): Promise<DeliveryResult> {
    const body = JSON.stringify(activity);
    const headers = signedHeaders(actorKeyId, inboxUrl, body);

    try {
        const response = await getTransport().fetch(
            inboxUrl,
            "POST",
            headers,
            body,
        );

        return {
            targetUrl: inboxUrl,
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
        };
    } catch (err) {
        return {
            targetUrl: inboxUrl,
            status: 0,
            ok: false,
            error: String(err),
        };
    }
}

/**
 * Emit an AP delivery request as a signal for the executor's
 * federation service. This is the primary delivery mechanism
 * per Spec §5.5 Option A — the language emits signals, the
 * executor handles retry and shared-inbox optimization.
 */
export function emitDeliveryRequest(
    activity: APActivity,
    neighbourhoodHash: string,
): void {
    getRuntime().emitSignal(JSON.stringify({
        type: "ap-delivery-request",
        activity,
        neighbourhood: neighbourhoodHash,
    }));
}

/**
 * Deliver an activity to all known follower inboxes.
 * Also emits a signal for the executor's federation service.
 *
 * @param activity          The activity to deliver
 * @param followerInboxes   Array of inbox URLs
 * @param actorKeyId        Signing key ID
 * @param neighbourhoodHash The neighbourhood hash for signal routing
 * @returns Array of delivery results
 */
export async function deliverToFollowers(
    activity: APActivity,
    followerInboxes: string[],
    actorKeyId: string,
    neighbourhoodHash: string,
): Promise<DeliveryResult[]> {
    // Emit signal for the executor's federation service (retry, shared inbox, etc.)
    emitDeliveryRequest(activity, neighbourhoodHash);

    // Also attempt direct delivery to each known inbox
    const results: DeliveryResult[] = [];
    for (const inboxUrl of followerInboxes) {
        const result = await deliverToInbox(activity, inboxUrl, actorKeyId);
        results.push(result);
    }
    return results;
}
