"use strict";

const { fnGetGameSchema, fnSetGameSchema } = require("../../../utils/redis/schema/game");
const { fnGetPlayerSchema } = require("../../../utils/redis/schema/player");

const objectIdLike = (hex) => ({ toString: () => hex });

describe("fnGetGameSchema", () => {
    test("defaults every field when called with nothing", () => {
        expect(fnGetGameSchema()).toEqual({ _id: null, sName: null, sImage: null, status: "waiting" });
    });

    test("stringifies _id and keeps known fields", () => {
        expect(fnGetGameSchema({ _id: objectIdLike("abc"), sName: "Room", sImage: 3, status: "playing" }))
            .toEqual({ _id: "abc", sName: "Room", sImage: 3, status: "playing" });
    });

    test("drops unknown fields", () => {
        const out = fnGetGameSchema({ _id: "x", secret: "nope", players: [] });
        expect(Object.keys(out).sort()).toEqual(["_id", "sImage", "sName", "status"]);
    });

    test("treats falsy values as missing (0 / '' become null, '' status becomes 'waiting')", () => {
        expect(fnGetGameSchema({ _id: 0, sName: "", sImage: 0, status: "" }))
            .toEqual({ _id: null, sName: null, sImage: null, status: "waiting" });
    });

    test("returns a plain object (with a prototype) even though it builds on Object.create(null)", () => {
        expect(Object.getPrototypeOf(fnGetGameSchema())).toBe(Object.prototype);
    });

    test("throws on null input (default parameter only covers undefined)", () => {
        expect(() => fnGetGameSchema(null)).toThrow(TypeError);
    });
});

describe("fnSetGameSchema", () => {
    test("patches only provided, non-null fields and mutates/returns the target", () => {
        const game = { _id: "a", sName: "Old", sImage: 1, status: "waiting" };
        const out = fnSetGameSchema(game, { sName: "New", status: null, sImage: undefined });
        expect(out).toBe(game);
        expect(game).toEqual({ _id: "a", sName: "New", sImage: 1, status: "waiting" });
    });

    test("patches status", () => {
        const game = { status: "waiting" };
        fnSetGameSchema(game, { status: "playing" });
        expect(game.status).toBe("playing");
    });

    test("stringifies a patched _id", () => {
        const game = {};
        fnSetGameSchema(game, { _id: objectIdLike("zzz") });
        expect(game._id).toBe("zzz");
    });

    test("allows falsy-but-not-null values (0, '') through", () => {
        const game = { sImage: 5, sName: "x" };
        fnSetGameSchema(game, { sImage: 0, sName: "" });
        expect(game).toEqual({ sImage: 0, sName: "" });
    });

    test("ignores fields outside the schema", () => {
        const game = {};
        fnSetGameSchema(game, { hacked: true, players: [1] });
        expect(game).toEqual({});
    });

    test("is a no-op without a patch", () => {
        const game = { status: "playing" };
        expect(fnSetGameSchema(game)).toEqual({ status: "playing" });
    });
});

describe("fnGetPlayerSchema", () => {
    test("keeps only _id, sName, sImage, chips", () => {
        expect(fnGetPlayerSchema({ _id: "u1", sName: "A", sImage: 4, chips: 50, did: "secret", token: "t" }))
            .toEqual({ _id: "u1", sName: "A", sImage: 4, chips: "50" });
    });

    test("omits _id and chips entirely when absent, but nulls sName/sImage", () => {
        expect(fnGetPlayerSchema()).toEqual({ sName: null, sImage: null });
    });

    test("stringifies ObjectId _id and numeric chips", () => {
        const out = fnGetPlayerSchema({ _id: objectIdLike("abc"), chips: 1234 });
        expect(out._id).toBe("abc");
        expect(out.chips).toBe("1234");
    });

    test("keeps zero chips (null-check, not truthiness)", () => {
        expect(fnGetPlayerSchema({ chips: 0 }).chips).toBe("0");
    });

    test("drops null chips", () => {
        expect(fnGetPlayerSchema({ chips: null })).not.toHaveProperty("chips");
    });

    test("an sImage of 0 is coerced to null (truthiness check)", () => {
        expect(fnGetPlayerSchema({ sImage: 0 }).sImage).toBeNull();
    });

    test("an _id of 0 / '' is omitted", () => {
        expect(fnGetPlayerSchema({ _id: 0 })).not.toHaveProperty("_id");
        expect(fnGetPlayerSchema({ _id: "" })).not.toHaveProperty("_id");
    });

    test("throws on null input", () => {
        expect(() => fnGetPlayerSchema(null)).toThrow(TypeError);
    });
});
