/**
 * Deno-specific transport implementation.
 * Wraps httpFetch from ad4m:host.
 *
 * Only imported by index.ts — never by core modules or tests.
 */

import { httpFetch } from "@coasys/ad4m-ldk";
import type { Transport, TransportResponse } from "./transport.js";

/**
 * Transport implementation for the Deno/JS executor runtime.
 *
 * Delegates to `httpFetch` from `ad4m:host`, which returns a JSON string
 * with `{ status, headers, body }`. This class parses that envelope and
 * returns a typed `TransportResponse`.
 */
export class DenoTransport implements Transport {
    async fetch(
        url: string,
        method: string,
        headers: Record<string, string>,
        body: string,
    ): Promise<TransportResponse> {
        const responseRaw = await httpFetch(
            url,
            method,
            JSON.stringify(headers),
            body,
        );

        const parsed = JSON.parse(responseRaw);
        const status: number = typeof parsed.status === "number" ? parsed.status : 0;

        // Normalise headers to Record<string, string>
        let responseHeaders: Record<string, string> = {};
        if (parsed.headers && typeof parsed.headers === "object") {
            responseHeaders = parsed.headers;
        }

        const responseBody: string = typeof parsed.body === "string"
            ? parsed.body
            : JSON.stringify(parsed.body ?? "");

        return { status, headers: responseHeaders, body: responseBody };
    }
}
