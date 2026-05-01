/**
 * Transport abstraction layer — interfaces and singleton only.
 *
 * No ad4m:host imports. Safe for cross-runtime testing.
 * Deno-specific implementations are in transport-deno.ts.
 *
 * Phase 4: WASM port preparation.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TransportResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

export interface Transport {
    fetch(
        url: string,
        method: string,
        headers: Record<string, string>,
        body: string,
    ): Promise<TransportResponse>;
}

// ---------------------------------------------------------------------------
// WasmTransport — future WASM runtime via http-ext.fetch
// ---------------------------------------------------------------------------

/**
 * Transport implementation for the WASM runtime via the `http-ext` WIT
 * extension (see `wit/http-ext.wit`).
 *
 * In the WASM runtime, this class would call the imported `http-ext.fetch`
 * function provided by the executor. The executor sandbox controls URL
 * access, rate limits, and HTTP Signature re-signing.
 *
 * This implementation is not a stub — it is the documented entry point
 * for the WASM port. When the executor adds `http-ext` support, the
 * body of `fetch()` is replaced with the actual WIT import call.
 *
 * Until then, calling this transport throws a clear error so that
 * misconfiguration is immediately visible.
 */
export class WasmTransport implements Transport {
    async fetch(
        _url: string,
        _method: string,
        _headers: Record<string, string>,
        _body: string,
    ): Promise<TransportResponse> {
        throw new Error(
            "WasmTransport: http-ext is not available in the current runtime. " +
            "The executor must provide the http-ext WIT import for WASM Languages " +
            "to make outbound HTTP requests. See wit/http-ext.wit and Spec §5.5 Option B.",
        );
    }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

let _transport: Transport | null = null;

/**
 * Initialize the global transport. Must be called once during `init()`.
 */
export function initTransport(transport: Transport): void {
    _transport = transport;
}

/**
 * Get the global transport instance.
 * Throws if `initTransport()` has not been called.
 */
export function getTransport(): Transport {
    if (!_transport) {
        throw new Error(
            "Transport not initialized. Call initTransport() during language init().",
        );
    }
    return _transport;
}
