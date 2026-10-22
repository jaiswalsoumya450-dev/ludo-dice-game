"use strict";

/**
 * Minimal in-memory stand-in for an ioredis client. It implements only the
 * commands this codebase actually issues, with the same return shapes as
 * ioredis (null for missing strings, {} for missing hashes, counts for
 * SADD/SREM/ZADD/ZREM/DEL, 'OK'/null for SET [NX]).
 *
 * Every command yields to the microtask queue before touching state, so two
 * concurrent async flows genuinely interleave — that's what lets the tests
 * exercise the CAS retry loop and the join lock. It deliberately does NOT use
 * setImmediate/setTimeout, so it keeps working under jest fake timers.
 *
 * Methods are plain functions (not jest.fn) so tests can jest.spyOn them to
 * inject failures and have restoreMocks put the real behaviour back.
 */
class FakeRedis {
    constructor() {
        this.reset();
    }

    reset() {
        this.strings = new Map();
        this.hashes = new Map();
        this.sets = new Map();
        this.zsets = new Map();
        this.ttls = new Map();
        this.published = [];
    }

    async _tick() {
        await Promise.resolve();
    }

    _exists(key) {
        return this.strings.has(key) || this.hashes.has(key) || this.sets.has(key) || this.zsets.has(key);
    }

    _delete(key) {
        const existed = this._exists(key);
        this.strings.delete(key);
        this.hashes.delete(key);
        this.sets.delete(key);
        this.zsets.delete(key);
        this.ttls.delete(key);
        return existed;
    }

    // ---- connection-ish ----
    on() {
        return this;
    }

    defineCommand(name) {
        // casSet is implemented natively below; just record that it was defined.
        this.definedCommands = this.definedCommands || [];
        this.definedCommands.push(name);
    }

    // ---- keys ----
    async exists(key) {
        await this._tick();
        return this._exists(key) ? 1 : 0;
    }

    async del(...keys) {
        await this._tick();
        return keys.flat().reduce((n, k) => n + (this._delete(k) ? 1 : 0), 0);
    }

    async expire(key, ttl) {
        await this._tick();
        if (!this._exists(key)) return 0;
        this.ttls.set(key, Number(ttl));
        return 1;
    }

    async ttl(key) {
        await this._tick();
        if (!this._exists(key)) return -2;
        return this.ttls.has(key) ? this.ttls.get(key) : -1;
    }

    async keys(pattern) {
        await this._tick();
        const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        const all = [...this.strings.keys(), ...this.hashes.keys(), ...this.sets.keys(), ...this.zsets.keys()];
        return [...new Set(all)].filter((k) => re.test(k));
    }

    // ---- strings ----
    async get(key) {
        await this._tick();
        return this.strings.has(key) ? this.strings.get(key) : null;
    }

    async set(key, value, ...args) {
        await this._tick();
        const flags = args.map((a) => (typeof a === "string" ? a.toUpperCase() : a));
        if (flags.includes("NX") && this._exists(key)) return null;
        this.strings.set(key, String(value));
        this.ttls.delete(key);
        const exIdx = flags.indexOf("EX");
        if (exIdx !== -1) this.ttls.set(key, Number(flags[exIdx + 1]));
        return "OK";
    }

    /** Native implementation of the Lua script registered by redis.ops' fnRedisCasSet. */
    async casSet(key, expectedOld, newValue, ttlSeconds) {
        await this._tick();
        const current = this.strings.has(key) ? this.strings.get(key) : null;
        if (current !== String(expectedOld)) return 0;
        this.strings.set(key, String(newValue));
        if (Number(ttlSeconds) > 0) this.ttls.set(key, Number(ttlSeconds));
        else this.ttls.delete(key);
        return 1;
    }

    // ---- hashes ----
    async hgetall(key) {
        await this._tick();
        return { ...(this.hashes.get(key) || {}) };
    }

    async hmset(key, data) {
        await this._tick();
        const h = this.hashes.get(key) || {};
        for (const [k, v] of Object.entries(data)) h[k] = String(v);
        this.hashes.set(key, h);
        return "OK";
    }

    // ---- sets ----
    _set(key) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        return this.sets.get(key);
    }

    async sadd(key, ...members) {
        await this._tick();
        const s = this._set(key);
        let added = 0;
        for (const m of members.flat()) {
            if (!s.has(String(m))) {
                s.add(String(m));
                added++;
            }
        }
        return added;
    }

    async srem(key, ...members) {
        await this._tick();
        const s = this.sets.get(key);
        if (!s) return 0;
        let removed = 0;
        for (const m of members.flat()) if (s.delete(String(m))) removed++;
        if (s.size === 0) this.sets.delete(key);
        return removed;
    }

    async smembers(key) {
        await this._tick();
        return [...(this.sets.get(key) || [])];
    }

    async sismember(key, member) {
        await this._tick();
        return this.sets.has(key) && this.sets.get(key).has(String(member)) ? 1 : 0;
    }

    async srandmember(key) {
        await this._tick();
        const members = [...(this.sets.get(key) || [])];
        if (!members.length) return null;
        return members[Math.floor(Math.random() * members.length)];
    }

    // ---- sorted sets ----
    async zadd(key, ...args) {
        await this._tick();
        let flat = args.flat();
        const xx = flat[0] === "XX";
        if (xx) flat = flat.slice(1);
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        const z = this.zsets.get(key);
        let added = 0;
        for (let i = 0; i < flat.length; i += 2) {
            const score = Number(flat[i]);
            const member = String(flat[i + 1]);
            if (xx && !z.has(member)) continue;
            if (!z.has(member)) added++;
            z.set(member, score);
        }
        if (z.size === 0) this.zsets.delete(key);
        return added;
    }

    async zrem(key, ...members) {
        await this._tick();
        const z = this.zsets.get(key);
        if (!z) return 0;
        let removed = 0;
        for (const m of members.flat()) if (z.delete(String(m))) removed++;
        if (z.size === 0) this.zsets.delete(key);
        return removed;
    }

    async zscore(key, member) {
        await this._tick();
        const z = this.zsets.get(key);
        return z && z.has(String(member)) ? String(z.get(String(member))) : null;
    }

    async zrangebyscore(key, min, max, ...opts) {
        await this._tick();
        const z = this.zsets.get(key);
        if (!z) return [];
        const lo = min === "-inf" ? -Infinity : Number(min);
        const hi = max === "+inf" ? Infinity : Number(max);
        let entries = [...z.entries()].filter(([, s]) => s >= lo && s <= hi).sort((a, b) => a[1] - b[1]);
        const limitIdx = opts.indexOf("LIMIT");
        if (limitIdx !== -1) {
            const offset = Number(opts[limitIdx + 1]);
            const count = Number(opts[limitIdx + 2]);
            entries = entries.slice(offset, count < 0 ? undefined : offset + count);
        }
        if (opts.includes("WITHSCORES")) return entries.flatMap(([m, s]) => [m, String(s)]);
        return entries.map(([m]) => m);
    }

    // ---- pub/sub ----
    async publish(channel, message) {
        await this._tick();
        this.published.push({ channel, message });
        return 0;
    }

    // ---- transactions ----
    multi() {
        const queued = [];
        const chain = new Proxy(
            {},
            {
                get: (_, prop) => {
                    if (prop === "exec") {
                        return (cb) => {
                            const run = (async () => {
                                const results = [];
                                for (const [cmd, args] of queued) {
                                    try {
                                        results.push([null, await this[cmd](...args)]);
                                    } catch (err) {
                                        results.push([err, null]);
                                    }
                                }
                                return results;
                            })();
                            if (typeof cb === "function") run.then((r) => cb(null, r), (e) => cb(e));
                            return run;
                        };
                    }
                    return (...args) => {
                        queued.push([prop, args]);
                        return chain;
                    };
                },
            },
        );
        return chain;
    }
}

module.exports = { FakeRedis };
