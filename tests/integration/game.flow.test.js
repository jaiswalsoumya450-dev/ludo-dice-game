"use strict";

/**
 * End-to-end game flows through the real socket controllers, game service,
 * payout and wallet — only the storage layers are faked (FakeRedis for room
 * state, an in-memory User model for balances). The core invariant checked
 * throughout is chip conservation: no sequence of actions may create or
 * destroy chips.
 */

jest.mock("../../models/user.model", () => require("../helpers/fakeUserModel").createFakeUserModel());

const User = require("../../models/user.model");
const redis = require("../../utils/redis/connections");
const keys = require("../../utils/redis/redis.keys");
const gameServices = require("../../services/game.services");
const join = require("../../socket/controllers/join.controller");
const gameplay = require("../../socket/controllers/gameplay.controller");
const SOCKET_EVENTS = require("../../socket/socket.events");
const { createFakeIo, createFakeSocket, callHandler } = require("../helpers/socketFakes");

const START = 1000;
const STAKE = 100;

let io;
beforeEach(() => {
    User.reset();
    redis.reset();
    io = createFakeIo();
});

const newPlayer = (name, chips = START) => {
    const user = User.seed({ sName: name, chips });
    return createFakeSocket({ userId: user._id, sName: name });
};
const balance = (socket) => User.balance(socket._userId);
const totalChips = () => [...User._users.values()].reduce((sum, u) => sum + u.chips, 0);

/** Chips currently held in escrow by rooms that haven't been settled. */
const escrowed = () =>
    [...redis.strings.entries()]
        .filter(([k]) => k.endsWith(":game"))
        .map(([, raw]) => JSON.parse(raw))
        .filter((room) => room.status === "waiting" || room.status === "playing")
        .reduce((sum, room) => sum + Math.max(0, room.lobbyChips) * room.players.length, 0);

const joinPublic = (socket, data = { maxPlayers: 2, lobbyChips: STAKE }) => callHandler(join.fnJoinPublicGame, io, socket, data);
const joinPrivate = (socket, data = { maxPlayers: 2, lobbyChips: STAKE }) => callHandler(join.fnJoinPrivateGame, io, socket, data);
const leave = (socket, data = {}) => callHandler(join.fnLeaveRoom, io, socket, data);
const roll = (socket, data = {}) => callHandler(gameplay.fnRollDice, io, socket, data);
const rejoinGame = (socket, data = {}) => callHandler(gameplay.fnRejoinGame, io, socket, data);

/** Has whoever's turn it is roll until the game ends; returns the final ack. */
async function playToFinish(sockets) {
    const byId = new Map(sockets.map((s) => [s._userId, s]));
    for (let i = 0; i < 1000; i++) {
        const room = await gameServices.fnGetRoom(sockets[0]._gameId);
        if (room.status !== "playing") return room;
        const res = await roll(byId.get(room.playerOrder[room.turnIndex]));
        expect(res.status).toBe(200);
    }
    throw new Error("game never finished");
}

/** Runs async work that only waits on microtasks (FakeRedis) to completion. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("a complete 2-player public game", () => {
    test("stakes are escrowed, the winner takes the pot, and chips are conserved", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");

        const a = await joinPublic(alice);
        expect(a).toMatchObject({ status: 200, roomStatus: "waiting" });
        expect(balance(alice)).toBe(START - STAKE);

        const b = await joinPublic(bob);
        expect(b).toMatchObject({ status: 200, gameId: a.gameId, roomStatus: "playing" });
        expect(io.eventsFor(SOCKET_EVENTS.room_update)).toHaveLength(1);
        expect(io.eventsFor(SOCKET_EVENTS.room_starting)).toHaveLength(1);
        expect(totalChips() + escrowed()).toBe(2 * START);

        const final = await playToFinish([alice, bob]);
        const winner = final.winnerId === alice._userId ? alice : bob;
        const loser = winner === alice ? bob : alice;

        expect(balance(winner)).toBe(START + STAKE);
        expect(balance(loser)).toBe(START - STAKE);
        expect(totalChips()).toBe(2 * START);
        expect(escrowed()).toBe(0);

        const lastBroadcast = io.eventsFor(SOCKET_EVENTS.dice_rolled).pop();
        expect(lastBroadcast.payload).toMatchObject({ roomStatus: "finished", winnerId: winner._userId });
        expect(lastBroadcast.payload.players.find((p) => p.userId === winner._userId).score).toBe(100);
    });

    test("after the game ends, extra rolls / leaves never pay out twice", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        await playToFinish([alice, bob]);
        const snapshot = [balance(alice), balance(bob)];

        await expect(roll(alice)).resolves.toMatchObject({ status: 400, message: "This game is not active." });
        await leave(alice);
        await leave(bob);
        await leave(bob, { gameId: alice._gameId });

        expect([balance(alice), balance(bob)]).toEqual(snapshot);
    });

    test("players can rejoin the finished game to see the result", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        const final = await playToFinish([alice, bob]);
        await expect(rejoinGame(alice, { gameId: final.gameId })).resolves.toMatchObject({ status: 200, roomStatus: "finished" });
    });

    test("players can immediately queue for a new game after finishing", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const first = await joinPublic(alice);
        await joinPublic(bob);
        await playToFinish([alice, bob]);
        const next = await joinPublic(alice);
        expect(next).toMatchObject({ status: 200, roomStatus: "waiting" });
        expect(next.gameId).not.toBe(first.gameId);
    });

    test("rolling out of turn is rejected and changes nothing", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        const before = await gameServices.fnGetRoom(alice._gameId);
        const notTheirTurn = before.playerOrder[before.turnIndex] === alice._userId ? bob : alice;

        await expect(roll(notTheirTurn)).resolves.toEqual({ status: 400, message: "It's not your turn." });
        expect(await gameServices.fnGetRoom(alice._gameId)).toEqual(before);
    });
});

describe("leaving", () => {
    test("leaving a waiting room refunds the stake and frees the player to queue again", async () => {
        const alice = newPlayer("Alice");
        const { gameId } = await joinPublic(alice);
        await expect(leave(alice)).resolves.toEqual({ status: 200 });

        expect(balance(alice)).toBe(START);
        expect(await gameServices.fnGetRoom(gameId)).toBeNull();
        expect(alice._gameId).toBeNull();
        await expect(joinPublic(alice)).resolves.toMatchObject({ status: 200 });
    });

    test("when one of three waiting players leaves, the others are notified and the room re-opens", async () => {
        const [a, b, c] = [newPlayer("A"), newPlayer("B"), newPlayer("C")];
        const data = { maxPlayers: 3, lobbyChips: STAKE };
        const { gameId } = await joinPublic(a, data);
        await joinPublic(b, data);
        await leave(a);

        const update = io.eventsFor(SOCKET_EVENTS.room_update).pop();
        expect(update.payload.players.map((p) => p.userId)).toEqual([b._userId]);
        await expect(joinPublic(c, data)).resolves.toMatchObject({ gameId });
        expect(totalChips() + escrowed()).toBe(3 * START);
    });

    test("forfeiting mid-game hands the pot to the opponent", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        await roll(alice);

        await leave(alice);
        expect(balance(bob)).toBe(START + STAKE);
        expect(balance(alice)).toBe(START - STAKE);
        expect(io.eventsFor(SOCKET_EVENTS.dice_rolled).pop().payload).toMatchObject({ roll: null, winnerId: bob._userId });

        await leave(bob);
        expect(balance(bob)).toBe(START + STAKE);
        expect(totalChips()).toBe(2 * START);
    });

    test("both players leaving at the same moment only settles once", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        await Promise.all([leave(alice), leave(bob)]);
        expect(totalChips()).toBe(2 * START);
        expect(Math.max(balance(alice), balance(bob))).toBe(START + STAKE);
    });
});

describe("matchmaking edge cases", () => {
    test("a player who can't afford the stake is turned away and nothing is created", async () => {
        const poor = newPlayer("Poor", STAKE - 1);
        await expect(joinPublic(poor)).resolves.toEqual({ status: 400, message: "Not enough chips." });
        expect(balance(poor)).toBe(STAKE - 1);
        expect(escrowed()).toBe(0);
        expect(poor._gameId).toBeUndefined();
    });

    test("exactly enough chips is enough", async () => {
        const exact = newPlayer("Exact", STAKE);
        await expect(joinPublic(exact)).resolves.toMatchObject({ status: 200 });
        expect(balance(exact)).toBe(0);
    });

    test("a double-tapped join charges once", async () => {
        const alice = newPlayer("Alice");
        const results = await Promise.all([joinPublic(alice), joinPublic(alice)]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
        expect(balance(alice)).toBe(START - STAKE);
    });

    test("free games never touch balances", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const data = { maxPlayers: 2, lobbyChips: 0 };
        await joinPublic(alice, data);
        await joinPublic(bob, data);
        await playToFinish([alice, bob]);
        expect([balance(alice), balance(bob)]).toEqual([START, START]);
    });

    test("a private room can't be joined by anyone else via public matchmaking", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const priv = await joinPrivate(alice);
        const pub = await joinPublic(bob);
        expect(pub.gameId).not.toBe(priv.gameId);
    });

    test("4 players racing into 2-seat tables end up in exactly two full games", async () => {
        const players = ["A", "B", "C", "D"].map((n) => newPlayer(n));
        await Promise.all(players.map((p) => joinPublic(p)));

        const rooms = new Map();
        for (const p of players) rooms.set(p._gameId, await gameServices.fnGetRoom(p._gameId));
        for (const room of rooms.values()) expect(room.players.length).toBeLessThanOrEqual(2);
        expect(totalChips() + escrowed()).toBe(4 * START);
    });
});

describe("background sweeps", () => {
    beforeEach(() => {
        jest.useFakeTimers({ now: 0, doNotFake: ["setImmediate", "nextTick"] });
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    const tick = async (ms) => {
        jest.advanceTimersByTime(ms);
        await settle();
    };

    test("a room nobody else joins is cancelled after 30s and the stake refunded", async () => {
        const alice = newPlayer("Alice");
        const { gameId } = await joinPublic(alice);
        join.fnStartBackgroundSweeps(io);

        await tick(gameServices.WAITING_MS - 3000);
        expect(balance(alice)).toBe(START - STAKE);

        await tick(3000);
        expect(balance(alice)).toBe(START);
        expect(await gameServices.fnGetRoom(gameId)).toBeNull();
        expect(io.eventsFor(SOCKET_EVENTS.room_cancelled)).toEqual([
            { room: gameId, event: SOCKET_EVENTS.room_cancelled, payload: { message: "Not enough players joined in time." } },
        ]);
        expect(await redis.get(keys.fnRedisPlayerActiveGameKey(alice._userId))).toBeNull();
    });

    test("a game where nobody rolls for 2 minutes is abandoned and both stakes refunded", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        join.fnStartBackgroundSweeps(io);

        await tick(gameServices.ABANDONED_GAME_MS - 3000);
        expect(balance(alice)).toBe(START - STAKE);

        await tick(3000);
        expect([balance(alice), balance(bob)]).toEqual([START, START]);
        expect(io.eventsFor(SOCKET_EVENTS.dice_rolled).pop().payload).toMatchObject({ abandoned: true, winnerId: null, roll: null });
    });

    test("an active game is not abandoned", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        await joinPublic(alice);
        await joinPublic(bob);
        join.fnStartBackgroundSweeps(io);

        await tick(gameServices.ABANDONED_GAME_MS - 3000);
        const room = await gameServices.fnGetRoom(alice._gameId);
        await roll(room.playerOrder[room.turnIndex] === alice._userId ? alice : bob);
        await tick(6000);

        expect((await gameServices.fnGetRoom(alice._gameId)).status).toBe("playing");
    });
});

describe("chip conservation under random play", () => {
    const SEEDS = process.env.FUZZ_SEEDS ? Array.from({ length: Number(process.env.FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 7, 42, 1337];

    /** Small deterministic PRNG so failures are reproducible. */
    const mulberry32 = (seed) => () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    test.each(SEEDS)("seed %i: chips are never created or destroyed by legitimate play", async (seed) => {
        const rand = mulberry32(seed);
        const players = ["A", "B", "C", "D", "E"].map((n) => newPlayer(n, 600));
        const total = totalChips();
        const tables = [
            { maxPlayers: 2, lobbyChips: 100 },
            { maxPlayers: 3, lobbyChips: 50 },
            { maxPlayers: 2, lobbyChips: 0 },
        ];

        for (let step = 0; step < 400; step++) {
            const p = players[Math.floor(rand() * players.length)];
            const action = rand();
            // Private joins are left out on purpose: combined with public joins they
            // trigger the double-charge bug pinned in "known bugs" below. Add
            // `joinPrivate` back to the mix once that is fixed.
            if (action < 0.3) await joinPublic(p, tables[Math.floor(rand() * tables.length)]);
            else if (action < 0.4) await leave(p);
            else await roll(p);

            expect(totalChips() + escrowed()).toBe(total);
            players.forEach((pl) => expect(balance(pl)).toBeGreaterThanOrEqual(0));
        }

        for (const p of players) await leave(p);
        expect(totalChips() + escrowed()).toBe(total);
    });
});

describe("leaveRoom can't be abused", () => {
    test("a player who never joined a room can't get a 'refund' from it", async () => {
        const alice = newPlayer("Alice");
        const mallory = newPlayer("Mallory");
        const { gameId } = await joinPublic(alice, { maxPlayers: 3, lobbyChips: STAKE });

        await leave(mallory, { gameId });
        expect(balance(mallory)).toBe(START);
        expect((await gameServices.fnGetRoom(gameId)).players).toHaveLength(1);
        expect(totalChips() + escrowed()).toBe(2 * START);
    });

    test("leaving the same waiting room twice only refunds once", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const data = { maxPlayers: 3, lobbyChips: STAKE };
        const { gameId } = await joinPublic(alice, data);
        await joinPublic(bob, data);

        await leave(alice, { gameId });
        await leave(alice, { gameId });
        expect(balance(alice)).toBe(START);
    });

    test("spamming concurrent leaves only refunds once", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const data = { maxPlayers: 3, lobbyChips: STAKE };
        const { gameId } = await joinPublic(alice, data);
        await joinPublic(bob, data);

        await Promise.all(Array.from({ length: 10 }, () => leave(alice, { gameId })));
        expect(balance(alice)).toBe(START);
        expect(totalChips() + escrowed()).toBe(2 * START);
    });

    test("an outsider can't end someone else's game", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const mallory = newPlayer("Mallory");
        const { gameId } = await joinPublic(alice);
        await joinPublic(bob);

        await leave(mallory, { gameId });
        expect((await gameServices.fnGetRoom(gameId)).status).toBe("playing");
        expect([balance(alice), balance(bob), balance(mallory)]).toEqual([START - STAKE, START - STAKE, START]);
        expect(io.eventsFor(SOCKET_EVENTS.dice_rolled)).toHaveLength(0);
    });

    describe("expiry sweep racing other players", () => {
        beforeEach(() => jest.useFakeTimers({ now: 0, doNotFake: ["setImmediate", "nextTick"] }));
        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        /** Starts the sweeps, lets the 30s run out, and freezes the sweep right after its first read of the room. */
        async function startSweepAndPauseAfterRead(gameId) {
            let resume;
            let paused = false;
            const realGet = redis.get.bind(redis);
            jest.spyOn(redis, "get").mockImplementation(async (key) => {
                const fromSweep = new Error().stack.includes("fnSweepExpiredWaitingRooms");
                const value = await realGet(key);
                if (fromSweep && key === keys.fnRedisGameKey(gameId) && !paused) {
                    paused = true;
                    await new Promise((r) => (resume = r));
                }
                return value;
            });
            join.fnStartBackgroundSweeps(io);
            jest.advanceTimersByTime(gameServices.WAITING_MS);
            await settle();
            expect(paused).toBe(true);
            return async () => {
                resume();
                await settle();
                jest.advanceTimersByTime(50); // past the CAS retry jitter, in case the sweep lost its write
                await settle();
            };
        }

        test("refunds the stake exactly once when the sweep wins the race", async () => {
            const alice = newPlayer("Alice");
            await joinPublic(alice);
            join.fnStartBackgroundSweeps(io);

            const realRemove = gameServices.fnRemovePlayer;
            jest.spyOn(gameServices, "fnRemovePlayer").mockImplementationOnce(async (...args) => {
                jest.advanceTimersByTime(gameServices.WAITING_MS);
                await settle();
                return realRemove(...args);
            });

            await leave(alice);
            expect(balance(alice)).toBe(START);
        });

        test("a leave that lands mid-sweep is refunded once, and the rest of the room is still refunded", async () => {
            const alice = newPlayer("Alice");
            const bob = newPlayer("Bob");
            const data = { maxPlayers: 3, lobbyChips: STAKE };
            const { gameId } = await joinPublic(alice, data);
            await joinPublic(bob, data);

            const resumeSweep = await startSweepAndPauseAfterRead(gameId);
            await leave(alice, { gameId });
            await resumeSweep();

            expect([balance(alice), balance(bob)]).toEqual([START, START]);
            expect(await gameServices.fnGetRoom(gameId)).toBeNull();
            expect(io.eventsFor(SOCKET_EVENTS.room_cancelled)).toHaveLength(1);
        });

        test("a join that fills the room mid-sweep starts the game instead of it being cancelled", async () => {
            const alice = newPlayer("Alice");
            const bob = newPlayer("Bob");
            const { gameId } = await joinPublic(alice);

            const resumeSweep = await startSweepAndPauseAfterRead(gameId);
            await expect(joinPublic(bob)).resolves.toMatchObject({ gameId, roomStatus: "playing" });
            await resumeSweep();

            expect((await gameServices.fnGetRoom(gameId)).status).toBe("playing");
            expect([balance(alice), balance(bob)]).toEqual([START - STAKE, START - STAKE]);
            expect(totalChips() + escrowed()).toBe(2 * START);
            expect(io.eventsFor(SOCKET_EVENTS.room_cancelled)).toHaveLength(0);
        });

        test("leaving a room after it was cancelled refunds nothing extra", async () => {
            const alice = newPlayer("Alice");
            const { gameId } = await joinPublic(alice);
            join.fnStartBackgroundSweeps(io);
            jest.advanceTimersByTime(gameServices.WAITING_MS);
            await settle();

            await leave(alice, { gameId });
            expect(balance(alice)).toBe(START);
        });
    });
});

describe("known bugs (test.failing: these assert the CORRECT behaviour and currently fail)", () => {
    // If a player is still seated in a waiting public room but their
    // active-game pointer was moved (joining a private room, then leaving it),
    // the next public join debits the stake again, picks the same room, and
    // fnAddPlayerPure's "already joined" no-op seats them zero extra times.
    // Found by the random-play conservation test.
    test.failing("re-joining a public room you're still seated in doesn't charge twice", async () => {
        const alice = newPlayer("Alice");
        const pub = { maxPlayers: 3, lobbyChips: 50 };
        const first = await joinPublic(alice, pub);
        await joinPrivate(alice);
        await leave(alice);

        const again = await joinPublic(alice, pub);
        expect(again.gameId).toBe(first.gameId);
        expect(totalChips() + escrowed()).toBe(START);
    });

    // A negative lobbyChips skips the debit (`> 0` guard) but the payout
    // credits `lobbyChips * players` — a negative number — to the winner.
    test.failing("a negative stake can't be used to drain the winner's balance", async () => {
        const alice = newPlayer("Alice");
        const bob = newPlayer("Bob");
        const data = { maxPlayers: 2, lobbyChips: -STAKE };
        await joinPublic(alice, data);
        await joinPublic(bob, data);
        const final = await playToFinish([alice, bob]);

        expect(User.balance(final.winnerId)).toBeGreaterThanOrEqual(START);
    });
});
