/**
 * Tests for security module (pure logic).
 *
 * Tests membership checks, rate limiting, and blocking logic
 * from security.pure.ts without ad4m:host runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    checkMembership,
    checkRateLimitPure,
} from "../src/security.pure.js";

import type { RateLimitState } from "../src/security.pure.js";
import type { RateLimitSettings } from "../src/settings.js";

// ---------------------------------------------------------------------------
// checkMembership
// ---------------------------------------------------------------------------

describe("checkMembership", () => {
    describe("open mode", () => {
        it("allows anyone", () => {
            const result = checkMembership("open", false, false);
            assert.equal(result.allowed, true);
        });
    });

    describe("followers-only mode", () => {
        it("allows followers", () => {
            const result = checkMembership("followers-only", true, false);
            assert.equal(result.allowed, true);
        });

        it("allows members", () => {
            const result = checkMembership("followers-only", false, true);
            assert.equal(result.allowed, true);
        });

        it("rejects non-followers/non-members", () => {
            const result = checkMembership("followers-only", false, false);
            assert.equal(result.allowed, false);
            assert.ok(result.reason?.includes("not a follower"));
        });
    });

    describe("members-only mode", () => {
        it("allows members", () => {
            const result = checkMembership("members-only", false, true);
            assert.equal(result.allowed, true);
        });

        it("rejects followers who are not members", () => {
            const result = checkMembership("members-only", true, false);
            assert.equal(result.allowed, false);
            assert.ok(result.reason?.includes("not a member"));
        });

        it("rejects non-members", () => {
            const result = checkMembership("members-only", false, false);
            assert.equal(result.allowed, false);
        });
    });

    describe("admin-approved mode", () => {
        it("allows members", () => {
            const result = checkMembership("admin-approved", false, true);
            assert.equal(result.allowed, true);
        });

        it("rejects non-members with approval reason", () => {
            const result = checkMembership("admin-approved", true, false);
            assert.equal(result.allowed, false);
            assert.ok(result.reason?.includes("admin approval"));
        });
    });
});

// ---------------------------------------------------------------------------
// checkRateLimitPure
// ---------------------------------------------------------------------------

describe("checkRateLimitPure", () => {
    const settings: RateLimitSettings = { maxPerMinute: 5 };

    it("allows first request with null state", () => {
        const result = checkRateLimitPure(null, settings, 1000);
        assert.equal(result.allowed, true);
        assert.equal(result.newState.count, 1);
        assert.equal(result.newState.windowStart, 1000);
    });

    it("allows requests within limit", () => {
        const state: RateLimitState = { count: 3, windowStart: 1000 };
        const result = checkRateLimitPure(state, settings, 1500);
        assert.equal(result.allowed, true);
        assert.equal(result.newState.count, 4);
    });

    it("rejects when limit reached", () => {
        const state: RateLimitState = { count: 5, windowStart: 1000 };
        const result = checkRateLimitPure(state, settings, 1500);
        assert.equal(result.allowed, false);
        assert.equal(result.newState.count, 5); // count unchanged
    });

    it("resets window after 60 seconds", () => {
        const state: RateLimitState = { count: 5, windowStart: 1000 };
        const result = checkRateLimitPure(state, settings, 62_000); // 61 seconds later
        assert.equal(result.allowed, true);
        assert.equal(result.newState.count, 1);
        assert.equal(result.newState.windowStart, 62_000);
    });

    it("handles high rate limit", () => {
        const highSettings: RateLimitSettings = { maxPerMinute: 1000 };
        const state: RateLimitState = { count: 999, windowStart: 1000 };
        const result = checkRateLimitPure(state, highSettings, 1500);
        assert.equal(result.allowed, true);
        assert.equal(result.newState.count, 1000);
    });

    it("handles single request limit", () => {
        const strictSettings: RateLimitSettings = { maxPerMinute: 1 };
        const state: RateLimitState = { count: 1, windowStart: 1000 };
        const result = checkRateLimitPure(state, strictSettings, 1500);
        assert.equal(result.allowed, false);
    });
});
