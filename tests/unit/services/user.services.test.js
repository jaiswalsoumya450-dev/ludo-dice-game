"use strict";

jest.mock("../../../models/user.model", () => require("../../helpers/fakeUserModel").createFakeUserModel());
jest.mock("../../../utils/redis/connections", () => {
    const { FakeRedis } = require("../../helpers/fakeRedis");
    return new FakeRedis();
});

const User = require("../../../models/user.model");
const redis = require("../../../utils/redis/connections");
const userService = require("../../../services/user.services");

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const cacheKey = (id) => `user:${id}`;

let user;
beforeEach(() => {
    User.reset();
    redis.reset();
    user = User.seed({ did: "d1", sName: "Alice", sImage: 4, chips: 1000 });
});

describe("fnGetUser", () => {
    test("returns the user", async () => {
        await expect(userService.fnGetUser(user._id)).resolves.toMatchObject({ sName: "Alice" });
    });

    test("returns null for an unknown id", async () => {
        await expect(userService.fnGetUser("64f000000000000000000000")).resolves.toBeNull();
    });

    test("rejects a malformed id", async () => {
        await expect(userService.fnGetUser("nope")).rejects.toMatchObject({ name: "CastError" });
    });
});

describe("fnUpdateUser", () => {
    test("only sends fields that were provided", async () => {
        const spy = jest.spyOn(User, "findByIdAndUpdate");
        await userService.fnUpdateUser(user._id, { sName: "Bob" });
        expect(spy).toHaveBeenCalledWith(user._id, { sName: "Bob" }, { returnDocument: "after", runValidators: true });
    });

    test("sends every provided field and returns the updated doc", async () => {
        const out = await userService.fnUpdateUser(user._id, { sName: "Bob", sImage: 9, chips: 7 });
        expect(out).toMatchObject({ sName: "Bob", sImage: 9, chips: 7 });
    });

    test("falsy-but-defined values (0, '') are sent", async () => {
        const spy = jest.spyOn(User, "findByIdAndUpdate");
        await userService.fnUpdateUser(user._id, { sImage: 0, chips: 0 }).catch(() => {});
        expect(spy.mock.calls[0][1]).toEqual({ sImage: 0, chips: 0 });
    });

    test("null is sent (not treated as 'not provided')", async () => {
        const spy = jest.spyOn(User, "findByIdAndUpdate");
        await userService.fnUpdateUser(user._id, { sName: null }).catch(() => {});
        expect(spy.mock.calls[0][1]).toEqual({ sName: null });
    });

    test("an empty update is a no-op that returns the current user", async () => {
        await expect(userService.fnUpdateUser(user._id, {})).resolves.toMatchObject({ sName: "Alice" });
    });

    test("runValidators rejects an empty name", async () => {
        await expect(userService.fnUpdateUser(user._id, { sName: "" })).rejects.toMatchObject({ name: "ValidationError" });
    });

    test("returns null for an unknown user", async () => {
        await expect(userService.fnUpdateUser("64f000000000000000000000", { sName: "x" })).resolves.toBeNull();
    });
});

describe("fnDeleteUser", () => {
    test("deletes and returns the user, then returns null on a second call", async () => {
        await expect(userService.fnDeleteUser(user._id)).resolves.toMatchObject({ _id: user._id });
        await expect(userService.fnDeleteUser(user._id)).resolves.toBeNull();
    });
});

describe("fnRedisGetUser (read-through cache)", () => {
    test("on a miss, loads from the DB and caches a stringified hash for 7 days", async () => {
        const out = await userService.fnRedisGetUser(user._id);
        expect(out).toMatchObject({ _id: user._id, chips: 1000 });

        const cached = redis.hashes.get(cacheKey(user._id));
        expect(cached).toMatchObject({ _id: user._id, did: "d1", sName: "Alice", sImage: "4", chips: "1000" });
        expect(redis.ttls.get(cacheKey(user._id))).toBe(SEVEN_DAYS);
    });

    test("on a hit, returns the cached hash without touching the DB (values come back as strings)", async () => {
        await userService.fnRedisGetUser(user._id);
        const findById = jest.spyOn(User, "findById");
        const out = await userService.fnRedisGetUser(user._id);
        expect(findById).not.toHaveBeenCalled();
        expect(out.chips).toBe("1000");
    });

    test("uses the document's toObject() when available and drops null/undefined fields", async () => {
        jest.spyOn(User, "findById").mockResolvedValueOnce({
            _id: "abc",
            toObject: () => ({ _id: "abc", sName: "X", sImage: null, chips: undefined, nested: { a: 1 } }),
        });
        await userService.fnRedisGetUser("abc");
        expect(redis.hashes.get(cacheKey("abc"))).toEqual({ _id: "abc", sName: "X", nested: "[object Object]" });
    });

    test("an unknown user returns null and caches nothing", async () => {
        await expect(userService.fnRedisGetUser("64f000000000000000000000")).resolves.toBeNull();
        expect(redis.hashes.size).toBe(0);
    });

    test("a redis read failure falls back to the DB (fnRedisHGETALL swallows the error)", async () => {
        jest.spyOn(redis, "hgetall").mockRejectedValueOnce(new Error("redis down"));
        await expect(userService.fnRedisGetUser(user._id)).resolves.toMatchObject({ sName: "Alice" });
    });

    test("a redis write failure rejects (so login fails if the cache is unavailable)", async () => {
        jest.spyOn(redis, "hmset").mockRejectedValueOnce(new Error("redis down"));
        await expect(userService.fnRedisGetUser(user._id)).rejects.toBeTruthy();
    });

    test("the cache is NOT refreshed by fnUpdateUser (stale reads until TTL)", async () => {
        await userService.fnRedisGetUser(user._id);
        await userService.fnUpdateUser(user._id, { sName: "Bob" });
        await expect(userService.fnRedisGetUser(user._id)).resolves.toMatchObject({ sName: "Alice" });
    });
});

describe("fnRedisUpdateUser", () => {
    test("updates the DB and refreshes the cache", async () => {
        await userService.fnRedisGetUser(user._id);
        const out = await userService.fnRedisUpdateUser(user._id, { sName: "Bob", chips: 5 });
        expect(out).toMatchObject({ sName: "Bob", chips: 5 });
        expect(redis.hashes.get(cacheKey(user._id))).toMatchObject({ sName: "Bob", chips: "5" });
        expect(redis.ttls.get(cacheKey(user._id))).toBe(SEVEN_DAYS);
    });

    test("only sends provided fields", async () => {
        const spy = jest.spyOn(User, "findByIdAndUpdate");
        await userService.fnRedisUpdateUser(user._id, { sImage: 2 });
        expect(spy.mock.calls[0][1]).toEqual({ sImage: 2 });
    });

    test("an unknown user returns null and doesn't create a cache entry", async () => {
        await expect(userService.fnRedisUpdateUser("64f000000000000000000000", { sName: "x" })).resolves.toBeNull();
        expect(redis.hashes.size).toBe(0);
    });

    test("validation errors leave the cache untouched", async () => {
        await userService.fnRedisGetUser(user._id);
        await expect(userService.fnRedisUpdateUser(user._id, { sName: "" })).rejects.toBeTruthy();
        expect(redis.hashes.get(cacheKey(user._id)).sName).toBe("Alice");
    });
});

describe("fnRedisDeleteUser", () => {
    test("deletes from the DB and evicts the cache", async () => {
        await userService.fnRedisGetUser(user._id);
        await expect(userService.fnRedisDeleteUser(user._id)).resolves.toMatchObject({ _id: user._id });
        expect(redis.hashes.has(cacheKey(user._id))).toBe(false);
        expect(User._users.size).toBe(0);
    });

    test("an unknown user returns null without touching redis", async () => {
        const del = jest.spyOn(redis, "del");
        await expect(userService.fnRedisDeleteUser("64f000000000000000000000")).resolves.toBeNull();
        expect(del).not.toHaveBeenCalled();
    });
});
