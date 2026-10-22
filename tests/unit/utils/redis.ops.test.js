"use strict";

const ops = require("../../../utils/redis/redis.ops");

/** A client whose every command is a jest.fn returning `'<cmd>-result'`. */
function mockClient(overrides = {}) {
    const commands = [
        "exists", "expire", "keys", "ttl", "del", "incrby",
        "hset", "hmset", "hincrby", "hget", "hdel", "hgetall",
        "get", "set", "setex", "setnx", "send_command",
        "sadd", "smembers", "srandmember", "smove", "srem", "scard", "sismember", "spop",
        "zadd", "zincrby", "zrem", "zcard", "zcount", "zrank", "zrevrank", "zscore",
        "zrangebyscore", "zrevrangebyscore", "zrevrange", "zremrangebyrank", "zremrangebyscore", "zrange",
        "lpush", "rpush", "lrem", "lrange", "llen", "ltrim", "publish",
    ];
    const client = {};
    for (const c of commands) client[c] = jest.fn(() => `${c}-result`);
    return Object.assign(client, overrides);
}

/** A client whose multi().<cmd>()...exec(cb) calls cb(execErr, execResult). */
function multiClient(execErr, execResult) {
    const queued = [];
    const chain = new Proxy({}, {
        get: (_, prop) => {
            if (prop === "exec") return jest.fn((cb) => cb(execErr, execResult));
            return (...args) => {
                queued.push([prop, ...args]);
                return chain;
            };
        },
    });
    return { queued, multi: jest.fn(() => chain) };
}

describe("redis.ops — thin command forwarders", () => {
    const cases = [
        ["fnRedisKeyExists", ["k"], "exists", ["k"]],
        ["fnRedisKeyExpire", ["k"], "expire", ["k", 3600]],
        ["fnRedisKeyExpire", ["k", 5], "expire", ["k", 5]],
        ["fnRedisKEYS", ["pat*"], "keys", ["pat*"]],
        ["fnRedisTTL", ["k"], "ttl", ["k"]],
        ["fnRedisKeyDEL", ["k"], "del", ["k"]],
        ["fnRedisINCRBY", ["k"], "incrby", ["k", 1]],
        ["fnRedisINCRBY", ["k", -3], "incrby", ["k", -3]],
        ["fnRedisHSET", ["k", "f", "v"], "hset", ["k", "f", "v"]],
        ["fnRedisHMSET", ["k", { a: 1 }], "hmset", ["k", { a: 1 }]],
        ["fnRedisHINCRBY", ["k", "f", 2], "hincrby", ["k", "f", 2]],
        ["fnRedisHGET", ["k", "f"], "hget", ["k", "f"]],
        ["fnRedisHDEL", ["k", "f"], "hdel", ["k", "f"]],
        ["fnRedisJSONSET", ["k", undefined, "{}"], "send_command", ["JSON.SET", "k", "$", "{}"]],
        ["fnRedisJSONSET", ["k", "$.a", "1"], "send_command", ["JSON.SET", "k", "$.a", "1"]],
        ["fnRedisGET", ["k"], "get", ["k"]],
        ["fnRedisSET", ["k", "v"], "set", ["k", "v"]],
        ["fnRedisSETEX", ["k", undefined, "v"], "setex", ["k", 600, "v"]],
        ["fnRedisSETEX", ["k", 10, "v"], "setex", ["k", 10, "v"]],
        ["fnRedisSETNX", ["k", "v"], "setnx", ["k", "v"]],
        ["fnRedisSETEXNX", ["k", "v"], "set", ["k", "v", "NX", "EX", 60]],
        ["fnRedisSETEXNX", ["k", "v", 5], "set", ["k", "v", "NX", "EX", 5]],
        ["fnRedisSADD", ["k", "m"], "sadd", ["k", "m"]],
        ["fnRedisSMEMBERS", ["k"], "smembers", ["k"]],
        ["fnRedisSRANDMEMBER", ["k"], "srandmember", ["k"]],
        ["fnRedisSMOVE", ["a", "b", "m"], "smove", ["a", "b", "m"]],
        ["fnRedisSREM", ["k", "m"], "srem", ["k", "m"]],
        ["fnRedisSCARD", ["k"], "scard", ["k"]],
        ["fnRedisSISMEMBER", ["k", "m"], "sismember", ["k", "m"]],
        ["fnRedisSPOP", ["k"], "spop", ["k", 1]],
        ["fnRedisSPOP", ["k", 3], "spop", ["k", 3]],
        ["fnRedisZADD", ["k", 5, 123], "zadd", ["k", 5, "123"]],
        ["fnRedisZADDXX", ["k", 5, 123], "zadd", ["k", "XX", 5, "123"]],
        ["fnRedisZADDMulti", ["k"], "zadd", ["k", []]],
        ["fnRedisZADDMulti", ["k", [1, "a", 2, "b"]], "zadd", ["k", [1, "a", 2, "b"]]],
        ["fnRedisZINCRBY", ["k", 2, "m"], "zincrby", ["k", 2, "m"]],
        ["fnRedisZREM", ["k", 42], "zrem", ["k", "42"]],
        ["fnRedisZREMMulti", ["k", ["a", "b"]], "zrem", ["k", ["a", "b"]]],
        ["fnRedisZCARD", ["k"], "zcard", ["k"]],
        ["fnRedisZCOUNT", ["k", 0, 10], "zcount", ["k", 0, 10]],
        ["fnRedisZRANK", ["k", "m"], "zrank", ["k", "m"]],
        ["fnRedisZREVRANK", ["k", "m"], "zrevrank", ["k", "m"]],
        ["fnRedisZSCORE", ["k", "m"], "zscore", ["k", "m"]],
        ["fnRedisZRANGEBYSCORE", ["k", 0, 10], "zrangebyscore", ["k", 0, 10, "WITHSCORES", "LIMIT", 0, -1]],
        ["fnRedisZRANGEBYSCORE", ["k", 0, 10, 2, 5, false], "zrangebyscore", ["k", 0, 10, "LIMIT", 2, 5]],
        ["fnRedisZREVRANGEBYSCORE", ["k", 10, 0], "zrevrangebyscore", ["k", 10, 0, "WITHSCORES", "LIMIT", 0, -1]],
        ["fnRedisZREVRANGEBYSCORE", ["k", 10, 0, 1, 2, false], "zrevrangebyscore", ["k", 10, 0, "LIMIT", 1, 2]],
        ["fnRedisZREVRANGE", ["k", 0, -1], "zrevrange", ["k", 0, -1, "WITHSCORES"]],
        ["fnRedisZREVRANGE", ["k", 0, -1, false], "zrevrange", ["k", 0, -1]],
        ["fnRedisZRANGE", ["k", 0, -1], "zrange", ["k", 0, -1, "WITHSCORES"]],
        ["fnRedisZRANGE", ["k", 0, -1, false], "zrange", ["k", 0, -1]],
        ["fnRedisZREMRANGEBYRANK", ["k", 0, 1], "zremrangebyrank", ["k", 0, 1]],
        ["fnRedisZREMRANGEBYSCORE", ["k", 0, 1], "zremrangebyscore", ["k", 0, 1]],
        ["fnRedisLPUSH", ["k", "v"], "lpush", ["k", "v"]],
        ["fnRedisRPUSH", ["k", "v"], "rpush", ["k", "v"]],
        ["fnRedisLREM", ["k", 0, "v"], "lrem", ["k", 0, "v"]],
        ["fnRedisLRANGE", ["k", 0, -1], "lrange", ["k", 0, -1]],
        ["fnRedisLLEN", ["k"], "llen", ["k"]],
        ["fnRedisLTRIM", ["k", 0, 9], "ltrim", ["k", 0, 9]],
    ];

    test.each(cases)("%s(%j) -> client.%s(%j)", (fn, args, cmd, expectedArgs) => {
        const client = mockClient();
        const result = ops[fn](client, ...args);
        expect(client[cmd]).toHaveBeenCalledTimes(1);
        expect(client[cmd]).toHaveBeenCalledWith(...expectedArgs);
        expect(result).toBe(`${cmd}-result`);
    });

    test("fnRedisZADD / fnRedisZREM throw synchronously on an undefined member", () => {
        const client = mockClient();
        expect(() => ops.fnRedisZADD(client, "k", 1, undefined)).toThrow(TypeError);
        expect(() => ops.fnRedisZREM(client, "k", undefined)).toThrow(TypeError);
        expect(client.zadd).not.toHaveBeenCalled();
    });
});

describe("fnRedisHGETALL", () => {
    test("returns the hash when it has fields", async () => {
        const client = mockClient({ hgetall: jest.fn().mockResolvedValue({ a: "1" }) });
        await expect(ops.fnRedisHGETALL(client, "k")).resolves.toEqual({ a: "1" });
    });

    test("returns undefined for a missing key (ioredis returns {})", async () => {
        const client = mockClient({ hgetall: jest.fn().mockResolvedValue({}) });
        await expect(ops.fnRedisHGETALL(client, "k")).resolves.toBeUndefined();
    });

    test("passes a null reply straight through", async () => {
        const client = mockClient({ hgetall: jest.fn().mockResolvedValue(null) });
        await expect(ops.fnRedisHGETALL(client, "k")).resolves.toBeNull();
    });

    test("swallows connection errors and returns undefined", async () => {
        const client = mockClient({ hgetall: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
        await expect(ops.fnRedisHGETALL(client, "k")).resolves.toBeUndefined();
    });
});

describe("fnRedisHMGET", () => {
    const withReply = (err, result) => mockClient({ hmget: jest.fn((key, fields, cb) => cb(err, result)) });

    test("zips fields with values", async () => {
        const client = withReply(null, ["Alice", "10"]);
        await expect(ops.fnRedisHMGET(client, "k", ["name", "chips"])).resolves.toEqual({ name: "Alice", chips: "10" });
    });

    test("fills missing fields from defaultValue, else empty string", async () => {
        const client = withReply(null, ["Alice", null, ""]);
        await expect(ops.fnRedisHMGET(client, "k", ["name", "chips", "img"], { chips: 99 }))
            .resolves.toEqual({ name: "Alice", chips: 99, img: "" });
    });

    test("resolves false when the FIRST field is missing, even if later fields exist", async () => {
        const client = withReply(null, [null, "10"]);
        await expect(ops.fnRedisHMGET(client, "k", ["name", "chips"])).resolves.toBe(false);
    });

    test("rejects on a redis error", async () => {
        const client = withReply(new Error("boom"));
        await expect(ops.fnRedisHMGET(client, "k", ["a"])).rejects.toThrow("boom");
    });

    test("rejects if the reply is not an array", async () => {
        const client = withReply(null, undefined);
        await expect(ops.fnRedisHMGET(client, "k", ["a"])).rejects.toThrow(TypeError);
    });
});

describe("MULTI-based helpers", () => {
    const ok = [[null, "OK"], [null, 1]];

    test.each([
        ["fnRedisINCRBYAtomic", ["k"], [["incrby", "k", 1]]],
        ["fnRedisHMSETEX", ["k", { a: 1 }], [["hmset", "k", { a: 1 }], ["expire", "k", 600]]],
        ["fnRedisHMSETEX", ["k", { a: 1 }, 5], [["hmset", "k", { a: 1 }], ["expire", "k", 5]]],
        ["fnRedisHSETEX", ["k", "f", "v"], [["hset", "k", "f", "v"], ["expire", "k", 600]]],
        ["fnRedisSADDEX", ["k", "m"], [["sadd", "k", "m"], ["expire", "k", 30]]],
        ["fnRedisZADDEX", ["k", 1, 7], [["zadd", "k", 1, "7"], ["expire", "k", 600]]],
        ["fnRedisZMOVE", ["a", "b", "m"], [["zrem", "a", "m"], ["zadd", "b", 0, "m"]]],
    ])("%s queues the right commands and resolves with unwrapped results", async (fn, args, expectedQueue) => {
        const client = multiClient(null, ok);
        await expect(ops[fn](client, ...args)).resolves.toEqual(["OK", 1]);
        expect(client.queued).toEqual(expectedQueue);
    });

    test.each(["fnRedisINCRBYAtomic", "fnRedisHMSETEX", "fnRedisHSETEX", "fnRedisSADDEX", "fnRedisZADDEX", "fnRedisZMOVE"])(
        "%s rejects when exec itself errors",
        async (fn) => {
            const client = multiClient(new Error("exec failed"), null);
            await expect(ops[fn](client, "k", "a", "b", "c")).rejects.toThrow("exec failed");
        },
    );

    test.each(["fnRedisINCRBYAtomic", "fnRedisHMSETEX", "fnRedisHSETEX", "fnRedisSADDEX", "fnRedisZADDEX", "fnRedisZMOVE"])(
        "%s rejects with the joined per-command error",
        async (fn) => {
            const client = multiClient(null, [[null, "OK"], [new Error("WRONGTYPE"), null]]);
            await expect(ops[fn](client, "k", "a", "b", "c")).rejects.toMatch(/WRONGTYPE/);
        },
    );

    test("an aborted transaction (null exec result) resolves null for plain helpers", async () => {
        const client = multiClient(null, null);
        await expect(ops.fnRedisHMSETEX(client, "k", {})).resolves.toBeNull();
    });

    describe("fnRedisHINCRBYAtomic", () => {
        test("resolves with the new counter", async () => {
            const client = multiClient(null, [[null, 5]]);
            await expect(ops.fnRedisHINCRBYAtomic(client, "k", "f")).resolves.toEqual([5]);
            expect(client.queued).toEqual([["hincrby", "k", "f", 1]]);
        });

        test("rejects 'race_condition' when the transaction is aborted", async () => {
            const client = multiClient(null, null);
            await expect(ops.fnRedisHINCRBYAtomic(client, "k", "f", 2)).rejects.toBe("race_condition");
        });

        test("rejects 'counter_failled' when the reply is not numeric", async () => {
            const client = multiClient(null, [[null, "not-a-number"]]);
            await expect(ops.fnRedisHINCRBYAtomic(client, "k", "f")).rejects.toBe("counter_failled");
        });
    });
});

describe("fnRedisCasSet", () => {
    const casClient = (reply) => ({
        defineCommand: jest.fn(),
        casSet: jest.fn().mockResolvedValue(reply),
    });

    test("returns true only when the script reports a swap", async () => {
        await expect(ops.fnRedisCasSet(casClient(1), "k", "old", "new")).resolves.toBe(true);
        await expect(ops.fnRedisCasSet(casClient(0), "k", "old", "new")).resolves.toBe(false);
        await expect(ops.fnRedisCasSet(casClient(null), "k", "old", "new")).resolves.toBe(false);
        await expect(ops.fnRedisCasSet(casClient("1"), "k", "old", "new")).resolves.toBe(false);
    });

    test("defines the Lua command once per client and passes ttl (default 0)", async () => {
        const client = casClient(1);
        await ops.fnRedisCasSet(client, "k", "a", "b");
        await ops.fnRedisCasSet(client, "k", "b", "c", 30);
        expect(client.defineCommand).toHaveBeenCalledTimes(1);
        expect(client.defineCommand).toHaveBeenCalledWith("casSet", expect.objectContaining({ numberOfKeys: 1 }));
        expect(client.casSet).toHaveBeenNthCalledWith(1, "k", "a", "b", 0);
        expect(client.casSet).toHaveBeenNthCalledWith(2, "k", "b", "c", 30);
    });

    test("the Lua script compares with GET and only SETs (with EX when ttl > 0) on match", async () => {
        const client = casClient(1);
        await ops.fnRedisCasSet(client, "k", "a", "b");
        const { lua } = client.defineCommand.mock.calls[0][1];
        expect(lua).toMatch(/redis\.call\('GET', KEYS\[1\]\)/);
        expect(lua).toMatch(/if current == ARGV\[1\]/);
        expect(lua).toMatch(/'EX', ARGV\[3\]/);
        expect(lua).toMatch(/return 0/);
    });

    test("separate clients each get their own command definition", async () => {
        const a = casClient(1);
        const b = casClient(1);
        await ops.fnRedisCasSet(a, "k", "x", "y");
        await ops.fnRedisCasSet(b, "k", "x", "y");
        expect(a.defineCommand).toHaveBeenCalledTimes(1);
        expect(b.defineCommand).toHaveBeenCalledTimes(1);
    });

    test("propagates script errors", async () => {
        const client = { defineCommand: jest.fn(), casSet: jest.fn().mockRejectedValue(new Error("NOSCRIPT")) };
        await expect(ops.fnRedisCasSet(client, "k", "a", "b")).rejects.toThrow("NOSCRIPT");
    });
});

describe("locks", () => {
    test("fnLockAcquire uses SET NX EX and returns the reply", async () => {
        const client = mockClient({ set: jest.fn().mockResolvedValue("OK") });
        await expect(ops.fnLockAcquire(client, "lock")).resolves.toBe("OK");
        expect(client.set).toHaveBeenCalledWith("lock", 1, "NX", "EX", 1);
    });

    test("fnLockAcquire returns null when the lock is already held", async () => {
        const client = mockClient({ set: jest.fn().mockResolvedValue(null) });
        await expect(ops.fnLockAcquire(client, "lock", 5)).resolves.toBeNull();
        expect(client.set).toHaveBeenCalledWith("lock", 1, "NX", "EX", 5);
    });

    test("fnLockAcquire swallows errors, logs, and returns undefined (treated as not acquired)", async () => {
        const client = mockClient({ set: jest.fn().mockRejectedValue(new Error("down")) });
        await expect(ops.fnLockAcquire(client, "lock")).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), "lock");
    });

    test("fnLockRelease deletes the key and resolves undefined", async () => {
        const client = mockClient({ del: jest.fn().mockResolvedValue(1) });
        await expect(ops.fnLockRelease(client, "lock")).resolves.toBeUndefined();
        expect(client.del).toHaveBeenCalledWith("lock");
    });

    test("fnLockRelease never rejects when DEL rejects; it logs asynchronously", async () => {
        const client = mockClient({ del: jest.fn().mockRejectedValue(new Error("down")) });
        await expect(ops.fnLockRelease(client, "lock")).resolves.toBeUndefined();
        await new Promise((r) => setImmediate(r));
        expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), "lock");
    });

    test("fnLockRelease never throws when DEL throws synchronously", async () => {
        const client = mockClient({ del: jest.fn(() => { throw new Error("sync"); }) });
        await expect(ops.fnLockRelease(client, "lock")).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), "lock");
    });
});

describe("multi / pipeline result helpers", () => {
    describe.each(["fnMultiHandle", "fnPipelineHandle"])("%s", (fn) => {
        test("passes through an exec-level error or empty result untouched", () => {
            const err = new Error("x");
            expect(ops[fn](err, "anything")).toEqual([err, "anything"]);
            expect(ops[fn](null, null)).toEqual([null, null]);
            expect(ops[fn](null, undefined)).toEqual([null, undefined]);
        });

        test("returns an empty (falsy) error string and unwrapped values when all succeed", () => {
            const [err, result] = ops[fn](null, [[null, "OK"], [null, 0]]);
            expect(err).toBe("");
            expect(err).toBeFalsy();
            expect(result).toEqual(["OK", 0]);
        });

        test("joins per-command errors and nulls out their values", () => {
            const [err, result] = ops[fn](null, [["E1", null], [null, 2], ["E2", null]]);
            expect(err).toBe("E1,E2");
            expect(result).toEqual([null, 2, null]);
        });
    });

    describe.each(["fnMultiResultReduce", "fnPipelineResultReduce"])("%s", (fn) => {
        test("maps [err, data] tuples to data (or null on error)", () => {
            expect(ops[fn]([[null, "a"], [new Error("x"), "b"], [null, null]])).toEqual(["a", null, null]);
        });

        test.each([null, undefined, "str", {}, 5])("returns [] for non-array input %p", (input) => {
            expect(ops[fn](input)).toEqual([]);
        });

        test("returns [] and logs if an element is not destructurable", () => {
            expect(ops[fn]([null])).toEqual([]);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe("fnMultiErrorReduce", () => {
        test("passes through an exec-level error", () => {
            expect(ops.fnMultiErrorReduce("E", [[null, 1]])).toBe("E");
        });

        test("returns the exec error (null) when there is no result", () => {
            expect(ops.fnMultiErrorReduce(null, null)).toBeNull();
        });

        test("returns undefined when every command succeeded", () => {
            expect(ops.fnMultiErrorReduce(null, [[null, 1], [null, 2]])).toBeUndefined();
        });

        test("returns joined per-command errors", () => {
            expect(ops.fnMultiErrorReduce(null, [["A", null], [null, 1], ["B", null]])).toBe("A,B");
        });
    });

    describe("fnPipelineErrorReduce", () => {
        test("returns undefined when nothing failed (including empty pipelines)", () => {
            expect(ops.fnPipelineErrorReduce([[null, 1]])).toBeUndefined();
            expect(ops.fnPipelineErrorReduce([])).toBeUndefined();
        });

        test("reports the index and message of the first failure", () => {
            const err = ops.fnPipelineErrorReduce([[null, 1], [new Error("bad"), null], [new Error("later"), null]]);
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe("Redis pipeline error at index 1: bad");
        });

        test("handles non-Error failure values", () => {
            expect(ops.fnPipelineErrorReduce([["plain string", null]]).message)
                .toBe("Redis pipeline error at index 0: plain string");
        });

        test.each([null, undefined, {}, "x"])("returns an Error for non-array input %p", (input) => {
            expect(ops.fnPipelineErrorReduce(input).message).toBe("Invalid pipeline result format.");
        });
    });
});

describe("fnGetAllShardKeys", () => {
    test("falls back to KEYS on a non-cluster client", async () => {
        const client = {
            cluster: jest.fn().mockRejectedValue(new Error("not a cluster")),
            keys: jest.fn().mockResolvedValue(["a", "b"]),
        };
        await expect(ops.fnGetAllShardKeys(client)).resolves.toEqual(["a", "b"]);
        expect(client.keys).toHaveBeenCalledWith("*");
    });

    const shard = (host, keys) => ({ options: { host, port: 6379 }, keys: jest.fn().mockResolvedValue(keys) });

    test("concatenates KEYS from every master in cluster mode", async () => {
        const s1 = shard("10.0.0.1", ["a"]);
        const s2 = shard("10.0.0.2", ["b", "c"]);
        const client = { cluster: jest.fn().mockResolvedValue("ok"), nodes: jest.fn(() => [s1, s2]) };
        await expect(ops.fnGetAllShardKeys(client, "user:*")).resolves.toEqual(["a", "b", "c"]);
        expect(client.nodes).toHaveBeenCalledWith("master");
        expect(s1.keys).toHaveBeenCalledWith("user:*");
    });

    test("only queries the matching shard when exactShard is given", async () => {
        const s1 = shard("10.0.0.1", ["a"]);
        const s2 = shard("10.0.0.2", ["b"]);
        const client = { cluster: jest.fn().mockResolvedValue("ok"), nodes: jest.fn(() => [s1, s2]) };
        await expect(ops.fnGetAllShardKeys(client, "*", "10.0.0.2")).resolves.toEqual(["b"]);
        expect(s1.keys).not.toHaveBeenCalled();
    });

    test("skips (and logs) a failing shard but keeps the others", async () => {
        const bad = { options: { host: "x" }, keys: jest.fn().mockRejectedValue(new Error("shard down")) };
        const good = shard("y", ["k"]);
        const client = { cluster: jest.fn().mockResolvedValue("ok"), nodes: jest.fn(() => [bad, good]) };
        await expect(ops.fnGetAllShardKeys(client)).resolves.toEqual(["k"]);
        expect(logger.warn).toHaveBeenCalled();
    });

    test("returns [] and logs on an unexpected error", async () => {
        const client = { cluster: jest.fn().mockResolvedValue("ok"), nodes: jest.fn(() => { throw new Error("x"); }) };
        await expect(ops.fnGetAllShardKeys(client)).resolves.toEqual([]);
        expect(logger.warn).toHaveBeenCalled();
    });
});

describe("fnScanAcrossShards", () => {
    test("returns undefined for an empty pattern without touching the client", async () => {
        const client = { nodes: jest.fn() };
        await expect(ops.fnScanAcrossShards(client, "")).resolves.toBeUndefined();
        expect(client.nodes).not.toHaveBeenCalled();
    });

    test("follows SCAN cursors to completion on every node", async () => {
        const n1 = { scan: jest.fn().mockResolvedValueOnce(["7", ["a"]]).mockResolvedValueOnce(["0", ["b"]]) };
        const n2 = { scan: jest.fn().mockResolvedValueOnce(["0", []]) };
        const client = { nodes: jest.fn(() => [n1, n2]) };
        await expect(ops.fnScanAcrossShards(client, "user:*")).resolves.toEqual(["a", "b"]);
        expect(n1.scan).toHaveBeenNthCalledWith(1, "0", "MATCH", "user:*", "COUNT", 100);
        expect(n1.scan).toHaveBeenNthCalledWith(2, "7", "MATCH", "user:*", "COUNT", 100);
        expect(n2.scan).toHaveBeenCalledTimes(1);
    });

    test("returns [] when scanning fails (e.g. non-cluster client without nodes())", async () => {
        await expect(ops.fnScanAcrossShards({}, "x*")).resolves.toEqual([]);
        expect(logger.warn).toHaveBeenCalled();
    });
});

describe("fnRedisPublish", () => {
    const client = () => ({ publish: jest.fn().mockResolvedValue(1) });

    test("JSON-encodes objects", async () => {
        const c = client();
        await expect(ops.fnRedisPublish("ch", { a: 1 }, c)).resolves.toBe(true);
        expect(c.publish).toHaveBeenCalledWith("ch", '{"a":1}');
    });

    test("passes strings through and stringifies other primitives", async () => {
        const c = client();
        await ops.fnRedisPublish("ch", "hi", c);
        await ops.fnRedisPublish("ch", 42, c);
        await ops.fnRedisPublish("ch", true, c);
        expect(c.publish.mock.calls).toEqual([["ch", "hi"], ["ch", "42"], ["ch", "true"]]);
    });

    test.each([
        ["", "msg"],
        [null, "msg"],
        ["ch", ""],
        ["ch", null],
        ["ch", 0],
        ["ch", false],
    ])("is a successful no-op when channel=%p message=%p", async (channel, message) => {
        const c = client();
        await expect(ops.fnRedisPublish(channel, message, c)).resolves.toBe(true);
        expect(c.publish).not.toHaveBeenCalled();
    });

    test("returns false when PUBLISH fails", async () => {
        const c = { publish: jest.fn().mockRejectedValue(new Error("down")) };
        await expect(ops.fnRedisPublish("ch", "m", c)).resolves.toBe(false);
    });

    test("returns false when no client is supplied", async () => {
        await expect(ops.fnRedisPublish("ch", "m")).resolves.toBe(false);
    });
});

describe("game pub/sub server list", () => {
    afterEach(() => {
        delete global.peers;
    });

    test("fnInitializeGamePubSubServerList never throws when config is missing; it logs", () => {
        expect(() => ops.fnInitializeGamePubSubServerList()).not.toThrow();
        expect(logger.warn).toHaveBeenCalled();
    });

    test("fnInitializeGamePubSubServerList fails even with config, because `Peers` is never imported", () => {
        const saved = global.constants;
        global.constants = { ...saved, R_PUBSUB_GAME: { hosts: ["h1"], port: 6379, mode: "x" } };
        try {
            ops.fnInitializeGamePubSubServerList();
        } finally {
            global.constants = saved;
        }
        expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ name: "ReferenceError" }));
    });

    test("fnGetRedisGamePubsubServer reads the server from global.peers", () => {
        global.peers = { get: () => ({ server: 3 }) };
        expect(ops.fnGetRedisGamePubsubServer()).toBe(3);
    });

    test("fnGetRedisGamePubsubServer throws if peers were never initialised", () => {
        expect(() => ops.fnGetRedisGamePubsubServer()).toThrow();
    });
});
