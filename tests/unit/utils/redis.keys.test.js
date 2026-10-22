"use strict";

const keys = require("../../../utils/redis/redis.keys");

describe("redis.keys", () => {
    test.each([
        ["fnRedisUserKey", ["u1"], "{u1}:user"],
        ["fnRedisGameKey", ["g1"], "{g1}:game"],
        ["fnRedisPlayerActiveGameKey", ["u1"], "{u1}:active_game"],
        ["fnRedisJoinLockKey", ["u1"], "{u1}:join_lock"],
        ["fnRedisOpenRoomsKey", ["Public", 2, 100], "open_rooms:Public:2:100"],
        ["fnRedisWaitingExpiryKey", [], "waiting_rooms_expiry"],
        ["fnRedisActiveGameActivityKey", [], "active_games_activity"],
    ])("%s(%j) -> %s", (fn, args, expected) => {
        expect(keys[fn](...args)).toBe(expected);
    });

    test.each(["fnRedisUserKey", "fnRedisGameKey", "fnRedisPlayerActiveGameKey", "fnRedisJoinLockKey"])(
        "%s defaults to an empty hash tag when called without an id",
        (fn) => {
            expect(keys[fn]()).toMatch(/^\{\}:/);
        },
    );

    test("explicit undefined also falls back to the default, but null does not", () => {
        expect(keys.fnRedisUserKey(undefined)).toBe("{}:user");
        expect(keys.fnRedisUserKey(null)).toBe("{null}:user");
    });

    test("per-user keys share the same cluster hash tag so they land on one slot", () => {
        const tag = (k) => k.match(/^\{([^}]*)\}/)[1];
        const id = "64f0c0ffee";
        expect(new Set([
            tag(keys.fnRedisUserKey(id)),
            tag(keys.fnRedisPlayerActiveGameKey(id)),
            tag(keys.fnRedisJoinLockKey(id)),
        ])).toEqual(new Set([id]));
    });

    test("open-room buckets are distinct per mode / size / stake", () => {
        const all = [
            keys.fnRedisOpenRoomsKey("Public", 2, 0),
            keys.fnRedisOpenRoomsKey("Public", 3, 0),
            keys.fnRedisOpenRoomsKey("Public", 2, 100),
            keys.fnRedisOpenRoomsKey("Private", 2, 0),
        ];
        expect(new Set(all).size).toBe(all.length);
    });

    test("ObjectId-like values are stringified into the key", () => {
        const fakeObjectId = { toString: () => "abc123" };
        expect(keys.fnRedisGameKey(fakeObjectId)).toBe("{abc123}:game");
    });
});
