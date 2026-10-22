"use strict";

jest.mock("../../../utils/redis/connections", () => {
    const { FakeRedis } = require("../../helpers/fakeRedis");
    return new FakeRedis();
});
jest.mock("../../../services/wallet.services");

const redis = require("../../../utils/redis/connections");
const wallet = require("../../../services/wallet.services");
const keys = require("../../../utils/redis/redis.keys");
const game = require("../../../services/game.services");

const openKey = (maxPlayers = 2, lobbyChips = 100) => keys.fnRedisOpenRoomsKey("Public", maxPlayers, lobbyChips);
const join = (userId, opts = {}) =>
    game.fnJoinPublicGame({ userId, sName: `name-${userId}`, sImage: 37, maxPlayers: 2, lobbyChips: 100, ...opts });
const joinPrivate = (userId, opts = {}) =>
    game.fnJoinPrivateGame({ userId, sName: `name-${userId}`, sImage: 37, maxPlayers: 2, lobbyChips: 100, ...opts });

const storedRoom = (gameId) => {
    const raw = redis.strings.get(keys.fnRedisGameKey(gameId));
    return raw ? JSON.parse(raw) : null;
};
const putRoom = (room) => redis.strings.set(keys.fnRedisGameKey(room.gameId), JSON.stringify(room));
const activeGame = (userId) => redis.strings.get(keys.fnRedisPlayerActiveGameKey(userId)) ?? null;
const inSet = (key, member) => !!redis.sets.get(key)?.has(member);
const zscore = (key, member) => redis.zsets.get(key)?.get(member);

const playingRoom = (gameId = "g-play", userIds = ["a", "b"], extra = {}) => ({
    ...game.fnStartGamePure({
        ...game.fnCreateRoomState({ gameId, eRoomMode: "Public", maxPlayers: userIds.length, lobbyChips: 100, now: 0 }),
        players: userIds.map((userId) => ({ userId, sName: userId, sImage: 37 })),
    }),
    ...extra,
});

beforeEach(() => {
    redis.reset();
    wallet.fnDebitChips.mockResolvedValue(4900);
    wallet.fnCreditChips.mockResolvedValue(5000);
});

describe("fnGetRoom", () => {
    test.each([undefined, null, ""])("returns null for gameId %p without hitting redis", async (id) => {
        const get = jest.spyOn(redis, "get");
        await expect(game.fnGetRoom(id)).resolves.toBeNull();
        expect(get).not.toHaveBeenCalled();
    });

    test("returns null for an unknown room", async () => {
        await expect(game.fnGetRoom("nope")).resolves.toBeNull();
    });

    test("parses the stored room", async () => {
        putRoom(playingRoom("g1"));
        await expect(game.fnGetRoom("g1")).resolves.toMatchObject({ gameId: "g1", status: "playing" });
    });

    test("throws on corrupt JSON", async () => {
        redis.strings.set(keys.fnRedisGameKey("bad"), "{not json");
        await expect(game.fnGetRoom("bad")).rejects.toThrow(SyntaxError);
    });
});

describe("fnJoinPublicGame", () => {
    test("creates a new waiting room when nothing is open, charges the stake, and indexes it", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        const room = await join("a");

        expect(room).toMatchObject({ eRoomMode: "Public", status: "waiting", maxPlayers: 2, lobbyChips: 100 });
        expect(room.gameId).toMatch(/^g_[0-9a-z]+_[0-9a-z]+$/);
        expect(room.players).toEqual([{ userId: "a", sName: "name-a", sImage: 37 }]);
        expect(room.expiresAt).toBe(1_000_000 + game.WAITING_MS);

        expect(wallet.fnDebitChips).toHaveBeenCalledWith("a", 100);
        expect(storedRoom(room.gameId)).toEqual(room);
        expect(inSet(openKey(), room.gameId)).toBe(true);
        expect(zscore(keys.fnRedisWaitingExpiryKey(), room.gameId)).toBe(room.expiresAt);
        expect(activeGame("a")).toBe(room.gameId);
    });

    test("a free (0 chip) lobby never touches the wallet", async () => {
        await join("a", { lobbyChips: 0 });
        expect(wallet.fnDebitChips).not.toHaveBeenCalled();
    });

    test("normalises the player (ObjectId-like ids are stringified, missing sImage -> null)", async () => {
        const room = await join({ toString: () => "oid123" }, { sImage: undefined, lobbyChips: 0 });
        expect(room.players[0]).toEqual({ userId: "oid123", sName: "name-oid123", sImage: null });
    });

    test("the second player fills a 2-seat room and the game starts", async () => {
        const first = await join("a");
        jest.spyOn(Date, "now").mockReturnValue(2_000_000);
        const second = await join("b");

        expect(second.gameId).toBe(first.gameId);
        expect(second).toMatchObject({ status: "playing", playerOrder: ["a", "b"], turnIndex: 0 });
        expect(inSet(openKey(), first.gameId)).toBe(false);
        expect(zscore(keys.fnRedisActiveGameActivityKey(), first.gameId)).toBe(2_000_000);
        expect(activeGame("a")).toBe(first.gameId);
        expect(activeGame("b")).toBe(first.gameId);
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(2);
    });

    test("a partially filled larger room stays open and waiting", async () => {
        const first = await join("a", { maxPlayers: 3 });
        const second = await join("b", { maxPlayers: 3 });
        expect(second.gameId).toBe(first.gameId);
        expect(second.status).toBe("waiting");
        expect(inSet(openKey(3), first.gameId)).toBe(true);
        expect(redis.zsets.get(keys.fnRedisActiveGameActivityKey())).toBeUndefined();
    });

    test.each([
        ["a different table size", { maxPlayers: 3 }],
        ["a different stake", { lobbyChips: 200 }],
    ])("never matches players looking for %s", async (_, opts) => {
        const first = await join("a");
        const second = await join("b", opts);
        expect(second.gameId).not.toBe(first.gameId);
        expect(second.status).toBe("waiting");
    });

    test("re-joining while already waiting in a public room returns that room without charging again", async () => {
        const first = await join("a");
        const again = await join("a", { maxPlayers: 4, lobbyChips: 999 });
        expect(again).toEqual(first);
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(1);
    });

    test("waiting in a PRIVATE room doesn't count — the player is charged again and re-pointed", async () => {
        const priv = await joinPrivate("a");
        const pub = await join("a");
        expect(pub.gameId).not.toBe(priv.gameId);
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(2);
        expect(activeGame("a")).toBe(pub.gameId);
    });

    test("an active-game pointer to a deleted room is ignored", async () => {
        redis.strings.set(keys.fnRedisPlayerActiveGameKey("a"), "ghost");
        const room = await join("a");
        expect(room.gameId).not.toBe("ghost");
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(1);
    });

    test("an active-game pointer to a game already being played is ignored", async () => {
        putRoom(playingRoom("g-play", ["a", "z"]));
        redis.strings.set(keys.fnRedisPlayerActiveGameKey("a"), "g-play");
        const room = await join("a");
        expect(room.gameId).not.toBe("g-play");
        expect(room.status).toBe("waiting");
    });

    test("stale open-set entries (room key gone) are pruned and a fresh room is created", async () => {
        redis.sets.set(openKey(), new Set(["ghost-1", "ghost-2"]));
        const room = await join("a");
        expect(room.gameId).not.toMatch(/ghost/);
        expect([...redis.sets.get(openKey())]).toEqual([room.gameId]);
    });

    test("an open-set entry that already started is pruned instead of joined", async () => {
        putRoom(playingRoom("g-play", ["x", "y"]));
        redis.sets.set(openKey(), new Set(["g-play"]));
        const room = await join("a");
        expect(room.gameId).not.toBe("g-play");
        expect(inSet(openKey(), "g-play")).toBe(false);
        expect(storedRoom("g-play").players).toHaveLength(2);
    });

    test("gives up on candidates after 5 attempts and creates a new room", async () => {
        const srand = jest.spyOn(redis, "srandmember").mockResolvedValue("ghost");
        const room = await join("a");
        expect(srand).toHaveBeenCalledTimes(5);
        expect(room.players).toHaveLength(1);
    });

    test("insufficient chips -> 400, nothing persisted, lock released", async () => {
        wallet.fnDebitChips.mockResolvedValueOnce(null);
        await expect(join("a")).rejects.toMatchObject({ message: "Not enough chips.", status: 400 });
        expect(redis.strings.size).toBe(0);
        expect(redis.sets.size).toBe(0);
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        await expect(join("a")).resolves.toMatchObject({ status: "waiting" });
    });

    test("a wallet error propagates without a refund (nothing was debited)", async () => {
        wallet.fnDebitChips.mockRejectedValueOnce(new Error("mongo down"));
        await expect(join("a")).rejects.toThrow("mongo down");
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test("a redis failure after debiting refunds the stake and rethrows", async () => {
        jest.spyOn(redis, "sadd").mockRejectedValueOnce(new Error("redis down"));
        await expect(join("a")).rejects.toThrow("redis down");
        expect(wallet.fnCreditChips).toHaveBeenCalledWith("a", 100);
    });

    test("a redis failure in a free lobby rethrows without touching the wallet", async () => {
        jest.spyOn(redis, "sadd").mockRejectedValueOnce(new Error("redis down"));
        await expect(join("a", { lobbyChips: 0 })).rejects.toThrow("redis down");
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test("returns 429 when the user's join lock is already held, without charging", async () => {
        redis.strings.set(keys.fnRedisJoinLockKey("a"), "1");
        await expect(join("a")).rejects.toMatchObject({ status: 429 });
        expect(wallet.fnDebitChips).not.toHaveBeenCalled();
        expect(activeGame("a")).toBeNull();
    });

    test("returns 429 when the lock can't be acquired because redis errors", async () => {
        jest.spyOn(redis, "set").mockRejectedValueOnce(new Error("down"));
        await expect(join("a")).rejects.toMatchObject({ status: 429 });
    });

    test("the join lock is taken with a 5s TTL and released afterwards", async () => {
        const set = jest.spyOn(redis, "set");
        await join("a");
        expect(set).toHaveBeenCalledWith(keys.fnRedisJoinLockKey("a"), 1, "NX", "EX", 5);
        await Promise.resolve();
        expect(redis.strings.has(keys.fnRedisJoinLockKey("a"))).toBe(false);
    });

    test("a double-click (two concurrent joins by one user) only charges once", async () => {
        const results = await Promise.allSettled([join("a"), join("a")]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected[0].reason.status).toBe(429);
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(1);
    });

    test("many concurrent joiners: no room is over-filled and every player is seated exactly once", async () => {
        const users = Array.from({ length: 9 }, (_, i) => `u${i}`);
        const rooms = await Promise.all(users.map((u) => join(u, { maxPlayers: 3 })));

        const stored = new Map();
        for (const r of rooms) stored.set(r.gameId, storedRoom(r.gameId));
        const seatings = [...stored.values()].flatMap((r) => r.players.map((p) => p.userId));

        expect(seatings.sort()).toEqual([...users].sort());
        for (const r of stored.values()) {
            expect(r.players.length).toBeLessThanOrEqual(3);
            if (r.players.length === 3) {
                expect(r.status).toBe("playing");
                expect(inSet(openKey(3), r.gameId)).toBe(false);
            }
        }
        for (const u of users) {
            const gid = activeGame(u);
            expect(stored.get(gid).players.some((p) => p.userId === u)).toBe(true);
        }
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(users.length);
    });

    // KNOWN BUG — a transient CAS conflict (409) on a perfectly good room is
    // treated like "room vanished" and the room is SREM'd from the open set,
    // so nobody else can ever be matched into it before it expires.
    test.failing("a room hit by write contention stays listed as open", async () => {
        const first = await join("a", { maxPlayers: 3 });
        jest.spyOn(redis, "casSet").mockResolvedValue(0);
        await join("b", { maxPlayers: 3 });
        expect(inSet(openKey(3), first.gameId)).toBe(true);
    });

    // KNOWN BUG — ROOM_TTL_SECONDS is documented as a safety net "so a room key
    // can never live forever", but a freshly created room is written with a
    // plain SET (no TTL); it only gets one after its first CAS update.
    test.failing("a newly created room key has a TTL safety net", async () => {
        const room = await join("a");
        expect(redis.ttls.get(keys.fnRedisGameKey(room.gameId))).toBeGreaterThan(0);
    });
});

describe("fnJoinPrivateGame", () => {
    test("always creates a new private room that is never publicly listed", async () => {
        const room = await joinPrivate("a");
        expect(room).toMatchObject({ eRoomMode: "Private", status: "waiting" });
        expect(wallet.fnDebitChips).toHaveBeenCalledWith("a", 100);
        expect(storedRoom(room.gameId)).toEqual(room);
        expect(zscore(keys.fnRedisWaitingExpiryKey(), room.gameId)).toBe(room.expiresAt);
        expect(activeGame("a")).toBe(room.gameId);
        expect(redis.sets.size).toBe(0);
    });

    test("two different players get two different private rooms", async () => {
        const a = await joinPrivate("a");
        const b = await joinPrivate("b");
        expect(a.gameId).not.toBe(b.gameId);
    });

    test("re-requesting while already waiting in a private room returns it without charging", async () => {
        const first = await joinPrivate("a");
        await expect(joinPrivate("a")).resolves.toEqual(first);
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(1);
    });

    test("waiting in a PUBLIC room doesn't count for private", async () => {
        const pub = await join("a");
        const priv = await joinPrivate("a");
        expect(priv.gameId).not.toBe(pub.gameId);
        expect(wallet.fnDebitChips).toHaveBeenCalledTimes(2);
    });

    test("a single-seat private room starts immediately", async () => {
        await expect(joinPrivate("a", { maxPlayers: 1 })).resolves.toMatchObject({ status: "playing" });
    });

    test("insufficient chips -> 400 and nothing stored", async () => {
        wallet.fnDebitChips.mockResolvedValueOnce(null);
        await expect(joinPrivate("a")).rejects.toMatchObject({ message: "Not enough chips.", status: 400 });
        expect(redis.strings.size).toBe(0);
    });

    test("free private rooms don't touch the wallet", async () => {
        await joinPrivate("a", { lobbyChips: 0 });
        expect(wallet.fnDebitChips).not.toHaveBeenCalled();
    });

    test("redis failure refunds the stake", async () => {
        jest.spyOn(redis, "zadd").mockRejectedValueOnce(new Error("down"));
        await expect(joinPrivate("a")).rejects.toThrow("down");
        expect(wallet.fnCreditChips).toHaveBeenCalledWith("a", 100);
    });

    test("redis failure in a free private room rethrows without touching the wallet", async () => {
        jest.spyOn(redis, "zadd").mockRejectedValueOnce(new Error("down"));
        await expect(joinPrivate("a", { lobbyChips: 0 })).rejects.toThrow("down");
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test("is serialised by the same per-user lock as public joins", async () => {
        redis.strings.set(keys.fnRedisJoinLockKey("a"), "1");
        await expect(joinPrivate("a")).rejects.toMatchObject({ status: 429 });
    });
});

describe("fnRemovePlayer", () => {
    test.each([undefined, null, ""])("returns null for gameId %p", async (id) => {
        await expect(game.fnRemovePlayer(id, "a")).resolves.toBeNull();
    });

    test("removes a waiting player and keeps the room listed as open", async () => {
        const room = await join("a", { maxPlayers: 3 });
        await join("b", { maxPlayers: 3 });
        const next = await game.fnRemovePlayer(room.gameId, "a");
        expect(next.players.map((p) => p.userId)).toEqual(["b"]);
        expect(storedRoom(room.gameId).players).toHaveLength(1);
        expect(activeGame("a")).toBeNull();
        expect(activeGame("b")).toBe(room.gameId);
        expect(inSet(openKey(3), room.gameId)).toBe(true);
    });

    test("re-lists a waiting public room that had been dropped from the open set", async () => {
        const room = await join("a", { maxPlayers: 3 });
        await join("b", { maxPlayers: 3 });
        redis.sets.delete(openKey(3));
        await game.fnRemovePlayer(room.gameId, "b");
        expect(inSet(openKey(3), room.gameId)).toBe(true);
    });

    test("does not list a private room as open", async () => {
        const room = await joinPrivate("a", { maxPlayers: 3 });
        putRoom({ ...storedRoom(room.gameId), players: [...room.players, { userId: "b" }] });
        await game.fnRemovePlayer(room.gameId, "b");
        expect(redis.sets.size).toBe(0);
    });

    test("does not re-list a room that is already playing", async () => {
        putRoom(playingRoom("g-play", ["a", "b", "c"]));
        const next = await game.fnRemovePlayer("g-play", "a");
        expect(next.status).toBe("playing");
        expect(redis.sets.size).toBe(0);
    });

    test("removing the last player deletes the room and every index entry", async () => {
        jest.spyOn(Date, "now").mockReturnValue(5);
        const room = await join("a");
        await redis.zadd(keys.fnRedisActiveGameActivityKey(), 1, room.gameId);

        await expect(game.fnRemovePlayer(room.gameId, "a")).resolves.toBeNull();
        expect(storedRoom(room.gameId)).toBeNull();
        expect(inSet(openKey(), room.gameId)).toBe(false);
        expect(zscore(keys.fnRedisWaitingExpiryKey(), room.gameId)).toBeUndefined();
        expect(zscore(keys.fnRedisActiveGameActivityKey(), room.gameId)).toBeUndefined();
        expect(activeGame("a")).toBeNull();
    });

    test("removing a user who isn't in the room is a harmless no-op that still clears their pointer", async () => {
        const room = await join("a", { maxPlayers: 3 });
        redis.strings.set(keys.fnRedisPlayerActiveGameKey("x"), room.gameId);
        const next = await game.fnRemovePlayer(room.gameId, "x");
        expect(next.players).toHaveLength(1);
        expect(activeGame("x")).toBeNull();
    });

    test("an unknown room returns null and clears the user's pointer", async () => {
        redis.strings.set(keys.fnRedisPlayerActiveGameKey("a"), "ghost");
        await expect(game.fnRemovePlayer("ghost", "a")).resolves.toBeNull();
        expect(activeGame("a")).toBeNull();
    });

    test("non-404 errors are rethrown but the pointer is still cleared", async () => {
        const room = await join("a", { maxPlayers: 3 });
        jest.spyOn(redis, "casSet").mockRejectedValue(new Error("redis down"));
        await expect(game.fnRemovePlayer(room.gameId, "a")).rejects.toThrow("redis down");
        expect(activeGame("a")).toBeNull();
    });

    test("removing a player refreshes the room TTL", async () => {
        const room = await join("a", { maxPlayers: 3 });
        await join("b", { maxPlayers: 3 });
        await game.fnRemovePlayer(room.gameId, "b");
        expect(redis.ttls.get(keys.fnRedisGameKey(room.gameId))).toBe(3600);
    });
});

describe("fnRollDice", () => {
    beforeEach(() => putRoom(playingRoom("g1")));

    test("applies the roll, advances the turn, and bumps the activity timestamp", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0.5);
        jest.spyOn(Date, "now").mockReturnValue(777);
        const { room, roll, justFinished } = await game.fnRollDice("g1", "a");
        expect(roll).toBe(4);
        expect(justFinished).toBe(false);
        expect(room.scores).toEqual({ a: 4, b: 0 });
        expect(room.turnIndex).toBe(1);
        expect(storedRoom("g1")).toEqual(room);
        expect(zscore(keys.fnRedisActiveGameActivityKey(), "g1")).toBe(777);
    });

    test("the winning roll finishes the game, reports justFinished, and stops activity tracking", async () => {
        putRoom(playingRoom("g1", ["a", "b"], { scores: { a: 99, b: 0 } }));
        await redis.zadd(keys.fnRedisActiveGameActivityKey(), 1, "g1");
        const { room, justFinished } = await game.fnRollDice("g1", "a");
        expect(room).toMatchObject({ status: "finished", winnerId: "a" });
        expect(justFinished).toBe(true);
        expect(zscore(keys.fnRedisActiveGameActivityKey(), "g1")).toBeUndefined();
    });

    test("out-of-turn rolls are rejected and leave the room untouched", async () => {
        const before = redis.strings.get(keys.fnRedisGameKey("g1"));
        await expect(game.fnRollDice("g1", "b")).rejects.toMatchObject({ message: "It's not your turn.", status: 400 });
        expect(redis.strings.get(keys.fnRedisGameKey("g1"))).toBe(before);
        expect(redis.zsets.size).toBe(0);
    });

    test("rolling after the game finished is rejected", async () => {
        putRoom(playingRoom("g1", ["a", "b"], { status: "finished", winnerId: "a" }));
        await expect(game.fnRollDice("g1", "a")).rejects.toThrow("This game is not active.");
    });

    test("rolling in a missing room is a 404", async () => {
        await expect(game.fnRollDice("ghost", "a")).rejects.toMatchObject({ status: 404 });
    });

    test("a double-tapped roll only lands once", async () => {
        const results = await Promise.allSettled([game.fnRollDice("g1", "a"), game.fnRollDice("g1", "a")]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.find((r) => r.status === "rejected").reason.message).toBe("It's not your turn.");
        expect(storedRoom("g1").turnIndex).toBe(1);
    });

    test("concurrent winning rolls can only finish (and so pay out) once", async () => {
        putRoom(playingRoom("g1", ["a", "b"], { scores: { a: 99, b: 99 } }));
        const results = await Promise.allSettled([game.fnRollDice("g1", "a"), game.fnRollDice("g1", "a")]);
        const finished = results.filter((r) => r.status === "fulfilled" && r.value.justFinished);
        expect(finished).toHaveLength(1);
    });

    test("retries through transient CAS conflicts", async () => {
        const cas = jest.spyOn(redis, "casSet").mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        const { room } = await game.fnRollDice("g1", "a");
        expect(cas).toHaveBeenCalledTimes(3);
        expect(room.turnIndex).toBe(1);
    });

    test("gives up with 409 after 8 failed CAS attempts", async () => {
        const cas = jest.spyOn(redis, "casSet").mockResolvedValue(0);
        await expect(game.fnRollDice("g1", "a")).rejects.toMatchObject({ status: 409 });
        expect(cas).toHaveBeenCalledTimes(8);
    });

    test("a room deleted between retries surfaces as a 404", async () => {
        jest.spyOn(redis, "casSet").mockImplementationOnce(async () => {
            redis.strings.delete(keys.fnRedisGameKey("g1"));
            return 0;
        });
        await expect(game.fnRollDice("g1", "a")).rejects.toMatchObject({ status: 404 });
    });

    test("domain errors are not retried", async () => {
        const get = jest.spyOn(redis, "get");
        await expect(game.fnRollDice("g1", "b")).rejects.toThrow("It's not your turn.");
        expect(get).toHaveBeenCalledTimes(1);
    });
});

describe("fnEndGameByForfeit", () => {
    test("finishes a playing game for the opponent", async () => {
        putRoom(playingRoom("g1"));
        await redis.zadd(keys.fnRedisActiveGameActivityKey(), 1, "g1");
        const { room, justFinished } = await game.fnEndGameByForfeit("g1", "a");
        expect(room).toMatchObject({ status: "finished", winnerId: "b" });
        expect(justFinished).toBe(true);
        expect(storedRoom("g1").status).toBe("finished");
        expect(zscore(keys.fnRedisActiveGameActivityKey(), "g1")).toBeUndefined();
    });

    test("forfeiting an already finished game doesn't change the winner or re-trigger payout", async () => {
        putRoom(playingRoom("g1", ["a", "b"], { status: "finished", winnerId: "a" }));
        const { room, justFinished } = await game.fnEndGameByForfeit("g1", "a");
        expect(room.winnerId).toBe("a");
        expect(justFinished).toBe(false);
    });

    test("forfeiting a waiting room is a no-op", async () => {
        const waiting = await join("a");
        const { room, justFinished } = await game.fnEndGameByForfeit(waiting.gameId, "a");
        expect(room.status).toBe("waiting");
        expect(justFinished).toBe(false);
    });

    test("both players leaving at once only finishes the game once", async () => {
        putRoom(playingRoom("g1"));
        const [r1, r2] = await Promise.all([game.fnEndGameByForfeit("g1", "a"), game.fnEndGameByForfeit("g1", "b")]);
        expect([r1.justFinished, r2.justFinished].filter(Boolean)).toHaveLength(1);
    });

    test("a missing room is a 404", async () => {
        await expect(game.fnEndGameByForfeit("ghost", "a")).rejects.toMatchObject({ status: 404 });
    });
});

describe("fnSweepExpiredWaitingRooms", () => {
    const expiryKey = keys.fnRedisWaitingExpiryKey();

    test("deletes rooms past their deadline, clears players, and reports each one", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        const r1 = await join("a", { maxPlayers: 3 });
        await join("b", { maxPlayers: 3 });
        const r2 = await joinPrivate("c");

        Date.now.mockReturnValue(game.WAITING_MS);
        const onExpired = jest.fn();
        await game.fnSweepExpiredWaitingRooms(onExpired);

        expect(onExpired).toHaveBeenCalledTimes(2);
        expect(onExpired.mock.calls.map(([r]) => r.gameId).sort()).toEqual([r1.gameId, r2.gameId].sort());
        expect(storedRoom(r1.gameId)).toBeNull();
        expect(storedRoom(r2.gameId)).toBeNull();
        expect(inSet(openKey(3), r1.gameId)).toBe(false);
        expect(redis.zsets.get(expiryKey)).toBeUndefined();
        ["a", "b", "c"].forEach((u) => expect(activeGame(u)).toBeNull());
    });

    test("leaves rooms that haven't expired yet (boundary: 1ms early)", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        const room = await join("a");
        Date.now.mockReturnValue(game.WAITING_MS - 1);
        const onExpired = jest.fn();
        await game.fnSweepExpiredWaitingRooms(onExpired);
        expect(onExpired).not.toHaveBeenCalled();
        expect(storedRoom(room.gameId)).not.toBeNull();
    });

    test("drops the expiry entry for a room that filled up and started, without touching it", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        const room = await join("a");
        await join("b");
        Date.now.mockReturnValue(game.WAITING_MS * 2);
        const onExpired = jest.fn();
        await game.fnSweepExpiredWaitingRooms(onExpired);
        expect(onExpired).not.toHaveBeenCalled();
        expect(storedRoom(room.gameId).status).toBe("playing");
        expect(zscore(expiryKey, room.gameId)).toBeUndefined();
    });

    test("skips entries whose room is already gone", async () => {
        await redis.zadd(expiryKey, 0, "ghost");
        const onExpired = jest.fn();
        await game.fnSweepExpiredWaitingRooms(onExpired);
        expect(onExpired).not.toHaveBeenCalled();
        expect(redis.zsets.get(expiryKey)).toBeUndefined();
    });

    test("skips a room another instance already claimed (ZREM returned 0)", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        const room = await join("a");
        Date.now.mockReturnValue(game.WAITING_MS);
        jest.spyOn(redis, "zrem").mockResolvedValueOnce(0);
        const onExpired = jest.fn();
        await game.fnSweepExpiredWaitingRooms(onExpired);
        expect(onExpired).not.toHaveBeenCalled();
        expect(storedRoom(room.gameId)).not.toBeNull();
    });

    test("two sweepers racing only process each room once", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        await join("a");
        await joinPrivate("b");
        Date.now.mockReturnValue(game.WAITING_MS);
        const onExpired = jest.fn();
        await Promise.all([game.fnSweepExpiredWaitingRooms(onExpired), game.fnSweepExpiredWaitingRooms(onExpired)]);
        expect(onExpired).toHaveBeenCalledTimes(2);
    });

    test.each([undefined, null, "not a function"])("works without a callback (%p)", async (cb) => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        const room = await join("a");
        Date.now.mockReturnValue(game.WAITING_MS);
        await expect(game.fnSweepExpiredWaitingRooms(cb)).resolves.toBeUndefined();
        expect(storedRoom(room.gameId)).toBeNull();
    });

    test("is a no-op on an empty index", async () => {
        await expect(game.fnSweepExpiredWaitingRooms(jest.fn())).resolves.toBeUndefined();
    });

    test("a throwing callback aborts the sweep; untouched rooms are still picked up next run", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        await join("a");
        await joinPrivate("b");
        Date.now.mockReturnValue(game.WAITING_MS);
        const failing = jest.fn().mockRejectedValueOnce(new Error("refund failed"));
        await expect(game.fnSweepExpiredWaitingRooms(failing)).rejects.toThrow("refund failed");
        expect(failing).toHaveBeenCalledTimes(1);

        const retry = jest.fn();
        await game.fnSweepExpiredWaitingRooms(retry);
        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe("fnSweepAbandonedGames", () => {
    const activityKey = keys.fnRedisActiveGameActivityKey();

    test("finishes idle games as an abandoned draw and clears the players", async () => {
        putRoom(playingRoom("g1"));
        redis.strings.set(keys.fnRedisPlayerActiveGameKey("a"), "g1");
        redis.strings.set(keys.fnRedisPlayerActiveGameKey("b"), "g1");
        await redis.zadd(activityKey, 1000, "g1");
        jest.spyOn(Date, "now").mockReturnValue(1000 + game.ABANDONED_GAME_MS);

        const onAbandoned = jest.fn();
        await game.fnSweepAbandonedGames(onAbandoned);

        expect(onAbandoned).toHaveBeenCalledWith(expect.objectContaining({ gameId: "g1", status: "finished", winnerId: null, abandoned: true }));
        expect(storedRoom("g1")).toMatchObject({ status: "finished", abandoned: true });
        expect(activeGame("a")).toBeNull();
        expect(activeGame("b")).toBeNull();
        expect(redis.zsets.get(activityKey)).toBeUndefined();
    });

    test("leaves games with recent activity alone (boundary: 1ms too soon)", async () => {
        putRoom(playingRoom("g1"));
        await redis.zadd(activityKey, 1000, "g1");
        jest.spyOn(Date, "now").mockReturnValue(1000 + game.ABANDONED_GAME_MS - 1);
        const onAbandoned = jest.fn();
        await game.fnSweepAbandonedGames(onAbandoned);
        expect(onAbandoned).not.toHaveBeenCalled();
        expect(storedRoom("g1").status).toBe("playing");
    });

    test("does not report a game that already finished normally", async () => {
        putRoom(playingRoom("g1", ["a", "b"], { status: "finished", winnerId: "a" }));
        await redis.zadd(activityKey, 0, "g1");
        jest.spyOn(Date, "now").mockReturnValue(game.ABANDONED_GAME_MS);
        const onAbandoned = jest.fn();
        await game.fnSweepAbandonedGames(onAbandoned);
        expect(onAbandoned).not.toHaveBeenCalled();
        expect(storedRoom("g1").winnerId).toBe("a");
    });

    test("skips entries whose room is gone", async () => {
        await redis.zadd(activityKey, 0, "ghost");
        jest.spyOn(Date, "now").mockReturnValue(game.ABANDONED_GAME_MS);
        const onAbandoned = jest.fn();
        await expect(game.fnSweepAbandonedGames(onAbandoned)).resolves.toBeUndefined();
        expect(onAbandoned).not.toHaveBeenCalled();
    });

    test("skips a game another instance already claimed", async () => {
        putRoom(playingRoom("g1"));
        await redis.zadd(activityKey, 0, "g1");
        jest.spyOn(Date, "now").mockReturnValue(game.ABANDONED_GAME_MS);
        jest.spyOn(redis, "zrem").mockResolvedValueOnce(0);
        const onAbandoned = jest.fn();
        await game.fnSweepAbandonedGames(onAbandoned);
        expect(onAbandoned).not.toHaveBeenCalled();
        expect(storedRoom("g1").status).toBe("playing");
    });

    test("works without a callback", async () => {
        putRoom(playingRoom("g1"));
        await redis.zadd(activityKey, 0, "g1");
        jest.spyOn(Date, "now").mockReturnValue(game.ABANDONED_GAME_MS);
        await expect(game.fnSweepAbandonedGames()).resolves.toBeUndefined();
        expect(storedRoom("g1").abandoned).toBe(true);
    });

    test("a roll keeps a game alive past the original deadline", async () => {
        putRoom(playingRoom("g1"));
        jest.spyOn(Date, "now").mockReturnValue(0);
        await game.fnRollDice("g1", "a");
        Date.now.mockReturnValue(game.ABANDONED_GAME_MS - 10);
        await game.fnRollDice("g1", "b");
        Date.now.mockReturnValue(game.ABANDONED_GAME_MS + 10);
        const onAbandoned = jest.fn();
        await game.fnSweepAbandonedGames(onAbandoned);
        expect(onAbandoned).not.toHaveBeenCalled();
    });
});
