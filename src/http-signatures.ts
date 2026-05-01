/**
 * HTTP Signature generation for outbound AP delivery.
 *
 * Implements a simplified version of draft-cavage-http-signatures using
 * the `agentSignStringHex()` function from the ALDK. The agent's DID
 * keypair is used as the signing key.
 *
 * Signature format:
 *   Signature: keyId="<actorUrl>#main-key",algorithm="hs2019",
 *              headers="(request-target) host date digest",
 *              signature="<hex-encoded-signature>"
 *
 * This is sufficient for AP interop — most AP servers verify the
 * signature against the actor's publicKey fetched via the actor URL.
 */

import { getSigning } from "./signing-interface.js";

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

/**
 * Compute a simple digest of a request body for the Digest header.
 * Uses a deterministic string hash since we don't have access to
 * native SHA-256 in the WASM sandbox. The executor-side HTTP
 * Signature verification accepts this as a placeholder; real AP
 * servers that require SHA-256 digests will need the executor to
 * re-sign with RSA (see Spec §5.5 — the executor handles final
 * HTTP signing in production).
 */
export function computeDigest(body: string): string {
    // Simple hash for the digest — in production the executor
    // re-computes a proper SHA-256 digest before sending.
    let h = 0;
    for (let i = 0; i < body.length; i++) {
        h = ((h << 5) - h + body.charCodeAt(i)) | 0;
    }
    return `ad4m-ldk=${Math.abs(h).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Signature construction
// ---------------------------------------------------------------------------

export interface SignatureComponents {
    method: string;
    path: string;
    host: string;
    date: string;
    digest?: string;
}

/**
 * Build the signing string per draft-cavage-http-signatures §2.3.
 */
export function buildSigningString(components: SignatureComponents): string {
    const lines: string[] = [
        `(request-target): ${components.method.toLowerCase()} ${components.path}`,
        `host: ${components.host}`,
        `date: ${components.date}`,
    ];
    if (components.digest) {
        lines.push(`digest: ${components.digest}`);
    }
    return lines.join("\n");
}

/**
 * Sign an outbound HTTP request and return the Signature header value.
 *
 * @param actorKeyId  The `keyId` to include in the signature header,
 *                    typically `"<actorUrl>#main-key"`.
 * @param components  The HTTP request components to sign.
 * @returns The full `Signature` header value.
 */
export function signRequest(
    actorKeyId: string,
    components: SignatureComponents,
): string {
    const signingString = buildSigningString(components);
    const signatureHex = getSigning().signStringHex(signingString);

    const headers = components.digest
        ? "(request-target) host date digest"
        : "(request-target) host date";

    return [
        `keyId="${actorKeyId}"`,
        `algorithm="hs2019"`,
        `headers="${headers}"`,
        `signature="${signatureHex}"`,
    ].join(",");
}

/**
 * Generate all HTTP headers needed for a signed AP delivery request.
 *
 * @param actorKeyId  Key ID (e.g. "https://example.com/ap/v1/groups/abc#main-key")
 * @param targetUrl   Full target inbox URL
 * @param body        JSON body to deliver
 * @returns Headers object ready for httpFetch
 */
export function signedHeaders(
    actorKeyId: string,
    targetUrl: string,
    body: string,
): Record<string, string> {
    const url = new URL(targetUrl);
    const date = new Date().toUTCString();
    const digest = computeDigest(body);

    const components: SignatureComponents = {
        method: "POST",
        path: url.pathname,
        host: url.host,
        date,
        digest,
    };

    return {
        "Content-Type": "application/activity+json",
        Accept: "application/activity+json",
        Date: date,
        Digest: digest,
        Host: url.host,
        Signature: signRequest(actorKeyId, components),
    };
}
