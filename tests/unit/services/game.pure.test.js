"use strict";

jest.mock("../../../utils/redis/connections", () => ({}));

const game = require("../../../services/game.services");

const player = (userId, extra = {}) => ({ userId, sName: `name-${userId}`, sImage: 37, ...extra });

const waitingRoom = (overrides = {}) => ({
    ...game.fnCreateRoomState({ gameId: "g1", eRoomMode: "Public", maxPlayers: 2, lobbyChips: 100, now: 1000 }),
    ...overrides,
});

const playingRoom = (userIds = ["a", "b"], overrides = {}) =>
    ({ ...game.fnStartGamePure(waitingRoom({ maxPlayers: userIds.length, players: userIds.map((id) => player(id)) })), ...overrides });

/** Recursively freezes an object so any accidental mutation throws in strict mode. */
const deepFreeze = (obj) => {
    Object.values(obj).forEach((v) => v && typeof v === "object" && deepFreeze(v));
    return Object.freeze(obj);
};

describe("constants", () => {
    test("exposes the tuning constants", () => {
        expect(game.WAITING_MS).toBe(30000);
        expect(game.ABANDONED_GAME_MS).toBe(120000);
        expect(game.TARGET_SCORE).toBe(100);
    });
});

describe("fnRollValue", () => {
    test.each([
        [0, 1],
        [0.1666, 1],
        [0.1667, 2],
        [0.5, 4],
        [0.8333, 5],
        [0.8334, 6],
        [0.9999999, 6],
    ])("Math.random()=%p -> %p", (rand, expected) => {
        jest.spyOn(Math, "random").mockReturnValue(rand);
        expect(game.fnRollValue()).toBe(expected);
    });

    test("always yields an integer in 1..6 and eventually every face", () => {
        const seen = new Set();
        for (let i = 0; i < 2000; i++) {
            const v = game.fnRollValue();
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(6);
            seen.add(v);
        }
        expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe("fnCreateRoomState", () => {
    test("builds an empty waiting room expiring WAITING_MS after `now`", () => {
        expect(game.fnCreateRoomState({ gameId: "g", eRoomMode: "Private", maxPlayers: 4, lobbyChips: 0, now: 5000 }))
            .toEqual({
                gameId: "g",
                eRoomMode: "Private",
                maxPlayers: 4,
                lobbyChips: 0,
                status: "waiting",
                players: [],
                playerOrder: null,
                scores: null,
                turnIndex: null,
                target: null,
                winnerId: null,
                createdAt: 5000,
                expiresAt: 5000 + game.WAITING_MS,
            });
    });

    test("defaults `now` to Date.now()", () => {
        jest.spyOn(Date, "now").mockReturnValue(42);
        const room = game.fnCreateRoomState({ gameId: "g" });
        expect(room.createdAt).toBe(42);
        expect(room.expiresAt).toBe(42 + game.WAITING_MS);
    });

    test("each room gets its own players array", () => {
        const a = game.fnCreateRoomState({ gameId: "a" });
        const b = game.fnCreateRoomState({ gameId: "b" });
        expect(a.players).not.toBe(b.players);
    });
});

describe("fnStartGamePure", () => {
    test("seeds turn order from join order with zero scores", () => {
        const room = waitingRoom({ maxPlayers: 3, players: [player("x"), player("y"), player("z")] });
        const started = game.fnStartGamePure(room);
        expect(started).toMatchObject({
            status: "playing",
            playerOrder: ["x", "y", "z"],
            scores: { x: 0, y: 0, z: 0 },
            turnIndex: 0,
            target: game.TARGET_SCORE,
            winnerId: null,
        });
    });

    test("preserves unrelated room fields and does not mutate the input", () => {
        const room = deepFreeze(waitingRoom({ players: [player("a"), player("b")], custom: "keep" }));
        const started = game.fnStartGamePure(room);
        expect(started.custom).toBe("keep");
        expect(started.gameId).toBe("g1");
        expect(room.status).toBe("waiting");
    });

    test("resets a stale winnerId", () => {
        const room = waitingRoom({ players: [player("a")], winnerId: "old" });
        expect(game.fnStartGamePure(room).winnerId).toBeNull();
    });

    test("with no players produces a playing room with an empty order (degenerate input)", () => {
        const started = game.fnStartGamePure(waitingRoom());
        expect(started.playerOrder).toEqual([]);
        expect(started.scores).toEqual({});
    });
});

describe("fnAddPlayerPure", () => {
    test("adds a player and stays waiting while below capacity", () => {
        const room = waitingRoom({ maxPlayers: 3 });
        const next = game.fnAddPlayerPure(room, player("a"));
        expect(next.status).toBe("waiting");
        expect(next.players).toEqual([player("a")]);
    });

    test("starts the game the moment the last seat is filled", () => {
        const room = waitingRoom({ players: [player("a")] });
        const next = game.fnAddPlayerPure(room, player("b"));
        expect(next.status).toBe("playing");
        expect(next.playerOrder).toEqual(["a", "b"]);
    });

    test("a 1-seat room starts immediately on the first join", () => {
        const next = game.fnAddPlayerPure(waitingRoom({ maxPlayers: 1 }), player("solo"));
        expect(next.status).toBe("playing");
    });

    test("is an idempotent no-op (same reference) for a player already seated", () => {
        const room = waitingRoom({ maxPlayers: 3, players: [player("a")] });
        expect(game.fnAddPlayerPure(room, player("a", { sName: "renamed" }))).toBe(room);
    });

    test("duplicate check wins over the full check (re-join of a full waiting room is OK)", () => {
        const room = waitingRoom({ maxPlayers: 1, players: [player("a")] });
        expect(game.fnAddPlayerPure(room, player("a"))).toBe(room);
    });

    test.each(["playing", "finished", "cancelled", undefined])("rejects joining a room with status %p", (status) => {
        const room = waitingRoom({ status });
        expect(() => game.fnAddPlayerPure(room, player("a"))).toThrow("This game has already started.");
        try {
            game.fnAddPlayerPure(room, player("a"));
        } catch (err) {
            expect(err.status).toBe(400);
        }
    });

    test("rejects a newcomer when a waiting room is already at capacity", () => {
        const room = waitingRoom({ maxPlayers: 2, players: [player("a"), player("b")] });
        expect(() => game.fnAddPlayerPure(room, player("c"))).toThrow(
            expect.objectContaining({ message: "This game is already full.", status: 400 }),
        );
    });

    test("even a seated player gets 'already started' once the game is underway", () => {
        expect(() => game.fnAddPlayerPure(playingRoom(), player("a"))).toThrow("This game has already started.");
    });

    test("never mutates the input room", () => {
        const room = deepFreeze(waitingRoom({ maxPlayers: 2, players: [player("a")] }));
        expect(() => game.fnAddPlayerPure(room, player("b"))).not.toThrow();
        expect(room.players).toHaveLength(1);
    });
});

describe("fnRemovePlayerPure", () => {
    test("removes the matching player only", () => {
        const room = waitingRoom({ maxPlayers: 3, players: [player("a"), player("b"), player("c")] });
        expect(game.fnRemovePlayerPure(room, "b").players.map((p) => p.userId)).toEqual(["a", "c"]);
    });

    test("returns an equal copy when the user isn't in the room", () => {
        const room = waitingRoom({ players: [player("a")] });
        const next = game.fnRemovePlayerPure(room, "zzz");
        expect(next).toEqual(room);
        expect(next).not.toBe(room);
    });

    test("can empty the room", () => {
        expect(game.fnRemovePlayerPure(waitingRoom({ players: [player("a")] }), "a").players).toEqual([]);
    });

    test("does not touch playerOrder/scores (leaving mid-game is handled by forfeit)", () => {
        const room = playingRoom(["a", "b"]);
        const next = game.fnRemovePlayerPure(room, "a");
        expect(next.playerOrder).toEqual(["a", "b"]);
        expect(next.scores).toEqual({ a: 0, b: 0 });
    });

    test("never mutates the input room", () => {
        const room = deepFreeze(waitingRoom({ players: [player("a")] }));
        game.fnRemovePlayerPure(room, "a");
        expect(room.players).toHaveLength(1);
    });
});

describe("fnRollDicePure", () => {
    test("adds the roll to the current player's score and passes the turn", () => {
        const next = game.fnRollDicePure(playingRoom(["a", "b"]), "a", 4);
        expect(next.scores).toEqual({ a: 4, b: 0 });
        expect(next.turnIndex).toBe(1);
        expect(next.status).toBe("playing");
    });

    test("wraps the turn back to the first player", () => {
        const room = playingRoom(["a", "b", "c"], { turnIndex: 2 });
        expect(game.fnRollDicePure(room, "c", 1).turnIndex).toBe(0);
    });

    test("a single-player game keeps the turn on that player", () => {
        const room = playingRoom(["solo"]);
        expect(game.fnRollDicePure(room, "solo", 3).turnIndex).toBe(0);
    });

    test("reaching the target exactly wins", () => {
        const room = playingRoom(["a", "b"], { scores: { a: 94, b: 0 } });
        const next = game.fnRollDicePure(room, "a", 6);
        expect(next).toMatchObject({ status: "finished", winnerId: "a", turnIndex: 0 });
        expect(next.scores.a).toBe(100);
    });

    test("overshooting is capped at the target and still wins", () => {
        const room = playingRoom(["a", "b"], { scores: { a: 99, b: 0 } });
        const next = game.fnRollDicePure(room, "a", 6);
        expect(next.scores.a).toBe(100);
        expect(next.winnerId).toBe("a");
    });

    test("one below the target does not win", () => {
        const room = playingRoom(["a", "b"], { scores: { a: 93, b: 0 } });
        const next = game.fnRollDicePure(room, "a", 6);
        expect(next.scores.a).toBe(99);
        expect(next.status).toBe("playing");
        expect(next.winnerId).toBeNull();
    });

    test("respects a custom target", () => {
        const room = playingRoom(["a", "b"], { target: 5 });
        expect(game.fnRollDicePure(room, "a", 5)).toMatchObject({ status: "finished", winnerId: "a" });
    });

    test.each(["waiting", "finished"])("rejects rolling when the room is %s", (status) => {
        const room = playingRoom(["a", "b"], { status });
        expect(() => game.fnRollDicePure(room, "a", 3)).toThrow(
            expect.objectContaining({ message: "This game is not active.", status: 400 }),
        );
    });

    test("rejects the player whose turn it isn't", () => {
        expect(() => game.fnRollDicePure(playingRoom(["a", "b"]), "b", 3)).toThrow(
            expect.objectContaining({ message: "It's not your turn.", status: 400 }),
        );
    });

    test("rejects a user who isn't in the game at all", () => {
        expect(() => game.fnRollDicePure(playingRoom(["a", "b"]), "intruder", 3)).toThrow("It's not your turn.");
    });

    test("does not mutate the input room or its scores object", () => {
        const room = deepFreeze(playingRoom(["a", "b"]));
        const next = game.fnRollDicePure(room, "a", 2);
        expect(next.scores).not.toBe(room.scores);
        expect(room.scores.a).toBe(0);
    });

    test("a full game played turn-by-turn always terminates with exactly one winner at the target", () => {
        let room = playingRoom(["a", "b", "c"]);
        let turns = 0;
        while (room.status === "playing") {
            const current = room.playerOrder[room.turnIndex];
            room = game.fnRollDicePure(room, current, game.fnRollValue());
            turns++;
            expect(turns).toBeLessThan(1000);
        }
        expect(room.scores[room.winnerId]).toBe(100);
        Object.entries(room.scores)
            .filter(([id]) => id !== room.winnerId)
            .forEach(([, score]) => expect(score).toBeLessThan(100));
    });
});

describe("fnForfeitPure", () => {
    test("in a 2-player game the other player wins", () => {
        expect(game.fnForfeitPure(playingRoom(["a", "b"]), "a")).toMatchObject({ status: "finished", winnerId: "b" });
        expect(game.fnForfeitPure(playingRoom(["a", "b"]), "b")).toMatchObject({ status: "finished", winnerId: "a" });
    });

    test("with 3+ players one forfeit ends the whole game; the first remaining player in turn order wins", () => {
        const room = playingRoom(["a", "b", "c", "d"], { scores: { a: 0, b: 10, c: 90, d: 50 } });
        expect(game.fnForfeitPure(room, "a")).toMatchObject({ status: "finished", winnerId: "b" });
    });

    test("winner is null when the leaver was the only player", () => {
        expect(game.fnForfeitPure(playingRoom(["solo"]), "solo")).toMatchObject({ status: "finished", winnerId: null });
    });

    test("tolerates a missing playerOrder (nobody can forfeit, room unchanged)", () => {
        const room = { ...playingRoom(["a", "b"]), playerOrder: null };
        expect(game.fnForfeitPure(room, "a")).toBe(room);
    });

    test("a user who isn't in the game cannot end it", () => {
        const room = playingRoom(["a", "b"]);
        expect(game.fnForfeitPure(room, "outsider")).toBe(room);
    });

    test.each(["waiting", "finished"])("returns the very same room when status is %s", (status) => {
        const room = playingRoom(["a", "b"], { status, winnerId: "b" });
        expect(game.fnForfeitPure(room, "a")).toBe(room);
    });
});

describe("fnAbandonPure", () => {
    test("finishes a playing game as a draw flagged abandoned", () => {
        expect(game.fnAbandonPure(playingRoom())).toMatchObject({ status: "finished", winnerId: null, abandoned: true });
    });

    test.each(["waiting", "finished"])("returns the same room when status is %s", (status) => {
        const room = playingRoom(["a", "b"], { status, winnerId: "a" });
        expect(game.fnAbandonPure(room)).toBe(room);
    });
});

describe("fnPublicRoomState", () => {
    test("projects the lobby view and strips private player fields", () => {
        const room = waitingRoom({
            maxPlayers: 3,
            players: [player("a", { chips: 999, did: "device", token: "t" })],
        });
        expect(game.fnPublicRoomState(room)).toEqual({
            gameId: "g1",
            eRoomMode: "Public",
            maxPlayers: 3,
            roomStatus: "waiting",
            expiresAt: 1000 + game.WAITING_MS,
            players: [{ userId: "a", sName: "name-a", sImage: 37 }],
        });
    });

    test("does not leak lobbyChips / scores / internal timestamps", () => {
        const state = game.fnPublicRoomState(playingRoom());
        expect(state).not.toHaveProperty("lobbyChips");
        expect(state).not.toHaveProperty("scores");
        expect(state).not.toHaveProperty("createdAt");
    });
});

describe("fnPublicGameState", () => {
    test("projects the in-game view with per-player scores and whose turn it is", () => {
        const room = playingRoom(["a", "b"], { scores: { a: 12, b: 7 }, turnIndex: 1 });
        expect(game.fnPublicGameState(room)).toEqual({
            gameId: "g1",
            eRoomMode: "Public",
            maxPlayers: 2,
            roomStatus: "playing",
            target: 100,
            turnUserId: "b",
            winnerId: null,
            abandoned: false,
            players: [
                { userId: "a", sName: "name-a", sImage: 37, score: 12 },
                { userId: "b", sName: "name-b", sImage: 37, score: 7 },
            ],
        });
    });

    test("a waiting room (no order/scores yet) reports no turn and zero scores", () => {
        const state = game.fnPublicGameState(waitingRoom({ players: [player("a")] }));
        expect(state.turnUserId).toBeNull();
        expect(state.target).toBeNull();
        expect(state.players[0].score).toBe(0);
    });

    test("normalises winnerId/abandoned", () => {
        const state = game.fnPublicGameState({ ...playingRoom(), winnerId: undefined, abandoned: undefined });
        expect(state.winnerId).toBeNull();
        expect(state.abandoned).toBe(false);
        expect(game.fnPublicGameState(game.fnAbandonPure(playingRoom())).abandoned).toBe(true);
    });

    test("a player missing from scores (e.g. joined after start) shows 0", () => {
        const room = playingRoom(["a"], { players: [player("a"), player("late")] });
        expect(game.fnPublicGameState(room).players[1].score).toBe(0);
    });

    test("turnUserId is undefined if turnIndex points past the order (corrupt state)", () => {
        expect(game.fnPublicGameState(playingRoom(["a"], { turnIndex: 5 })).turnUserId).toBeUndefined();
    });
});
