"use strict";

jest.mock("../../../services/game.services", () => {
    const actual = jest.requireActual("../../../services/game.services");
    return {
        // keep the real pure projections so payload shapes are realistic
        fnPublicRoomState: actual.fnPublicRoomState,
        fnPublicGameState: actual.fnPublicGameState,
        fnJoinPublicGame: jest.fn(),
        fnJoinPrivateGame: jest.fn(),
        fnGetRoom: jest.fn(),
        fnRemovePlayer: jest.fn(),
        fnEndGameByForfeit: jest.fn(),
        fnSweepExpiredWaitingRooms: jest.fn(),
        fnSweepAbandonedGames: jest.fn(),
    };
});
jest.mock("../../../services/wallet.services");
jest.mock("../../../services/payout.services");

const gameServices = require("../../../services/game.services");
const wallet = require("../../../services/wallet.services");
const payout = require("../../../services/payout.services");
const SOCKET_EVENTS = require("../../../socket/socket.events");
const join = require("../../../socket/controllers/join.controller");
const { createFakeIo, createFakeSocket, callHandler } = require("../../helpers/socketFakes");

const waiting = (overrides = {}) => ({
    gameId: "g1",
    eRoomMode: "Public",
    maxPlayers: 2,
    lobbyChips: 100,
    status: "waiting",
    expiresAt: 123,
    players: [{ userId: "user-1", sName: "Alice", sImage: 37 }],
    ...overrides,
});
const playing = (overrides = {}) => ({
    ...waiting(),
    status: "playing",
    players: [{ userId: "user-1", sName: "Alice", sImage: 37 }, { userId: "user-2", sName: "Bob", sImage: 37 }],
    playerOrder: ["user-1", "user-2"],
    scores: { "user-1": 0, "user-2": 0 },
    turnIndex: 0,
    target: 100,
    winnerId: null,
    ...overrides,
});

let io;
let socket;
beforeEach(() => {
    io = createFakeIo();
    socket = createFakeSocket();
    gameServices.fnJoinPublicGame.mockResolvedValue(waiting());
    gameServices.fnJoinPrivateGame.mockResolvedValue(waiting({ eRoomMode: "Private" }));
    payout.fnSettleGamePot.mockResolvedValue();
    wallet.fnCreditChips.mockResolvedValue(1);
});

describe.each([
    ["fnJoinPublicGame", "fnJoinPublicGame", "Could not join a game. Try again."],
    ["fnJoinPrivateGame", "fnJoinPrivateGame", "Could not create a game. Try again."],
])("%s", (handler, serviceFn, defaultMessage) => {
    const call = (data) => callHandler(join[handler], io, socket, data);
    const serviceArgs = () => gameServices[serviceFn].mock.calls[0][0];

    test("joins via the service using the socket's identity (never the payload's)", async () => {
        await call({ maxPlayers: 2, lobbyChips: 100, userId: "spoofed", sName: "Spoof" });
        expect(serviceArgs()).toEqual({ userId: "user-1", sName: "Alice", maxPlayers: 2, lobbyChips: 100 });
    });

    test("subscribes the socket to the room and acks with the public room state", async () => {
        const res = await call({ maxPlayers: 2, lobbyChips: 100 });
        const room = await gameServices[serviceFn].mock.results[0].value;
        expect(socket.join).toHaveBeenCalledWith("g1");
        expect(socket._gameId).toBe("g1");
        expect(res).toEqual({ status: 200, ...gameServices.fnPublicRoomState(room) });
        expect(res).not.toHaveProperty("lobbyChips");
    });

    test("broadcasts roomUpdate while the room is still waiting", async () => {
        await call({});
        expect(io.to).toHaveBeenCalledWith("g1");
        expect(io.eventsFor(SOCKET_EVENTS.room_update)).toHaveLength(1);
        expect(io.eventsFor(SOCKET_EVENTS.room_starting)).toHaveLength(0);
    });

    test("broadcasts roomStarting (with game state) when this join filled the room", async () => {
        gameServices[serviceFn].mockResolvedValue(playing());
        await call({});
        const [evt] = io.eventsFor(SOCKET_EVENTS.room_starting);
        expect(evt.payload).toMatchObject({ roomStatus: "playing", turnUserId: "user-1", target: 100 });
        expect(io.eventsFor(SOCKET_EVENTS.room_update)).toHaveLength(0);
    });

    test.each([
        [undefined, 2],
        [null, 2],
        ["", 2],
        ["abc", 2],
        [NaN, 2],
        [0, 2],
        [1, 2],
        [-3, 2],
        [2, 2],
        ["3", 3],
        [4, 4],
        [5, 4],
        [1e9, 4],
        [Infinity, 4],
        [-Infinity, 2],
        [true, 2],
    ])("clamps maxPlayers %p -> %p", async (maxPlayers, expected) => {
        await call({ maxPlayers });
        expect(serviceArgs().maxPlayers).toBe(expected);
    });

    // KNOWN BUG — fractional sizes aren't rounded, producing rooms that need
    // 3.5 players (they start at 4) and a separate matchmaking bucket.
    test.failing("rounds a fractional maxPlayers to a whole number", async () => {
        await call({ maxPlayers: 3.5 });
        expect(Number.isInteger(serviceArgs().maxPlayers)).toBe(true);
    });

    test.each([
        [undefined, 0],
        [null, 0],
        ["", 0],
        ["abc", 0],
        [NaN, 0],
        [0, 0],
        [100, 100],
        ["250", 250],
        ["1e3", 1000],
    ])("coerces lobbyChips %p -> %p", async (lobbyChips, expected) => {
        await call({ lobbyChips });
        expect(serviceArgs().lobbyChips).toBe(expected);
    });

    test("missing / null payloads fall back to defaults", async () => {
        await callHandler(join[handler], io, socket, undefined);
        await callHandler(join[handler], io, socket, null);
        gameServices[serviceFn].mock.calls.forEach(([args]) => {
            expect(args).toMatchObject({ maxPlayers: 2, lobbyChips: 0 });
        });
    });

    // KNOWN BUG — negative stakes are passed straight through. They skip the
    // debit (`lobbyChips > 0`) but the payout credits `lobbyChips * players`
    // to the winner, i.e. the winner LOSES chips. Should be rejected/clamped.
    test.failing("never forwards a negative stake", async () => {
        await call({ lobbyChips: -500 });
        expect(serviceArgs().lobbyChips).toBeGreaterThanOrEqual(0);
    });

    test("relays the service's status and message on failure", async () => {
        gameServices[serviceFn].mockRejectedValue(Object.assign(new Error("Not enough chips."), { status: 400 }));
        await expect(call({})).resolves.toEqual({ status: 400, message: "Not enough chips." });
        expect(socket.join).not.toHaveBeenCalled();
        expect(socket._gameId).toBeUndefined();
        expect(io.emitted).toHaveLength(0);
        expect(logger.warn).toHaveBeenCalled();
    });

    test("defaults to 500 and a friendly message for unexpected errors", async () => {
        gameServices[serviceFn].mockRejectedValue({});
        await expect(call({})).resolves.toEqual({ status: 500, message: defaultMessage });
    });

    test.each([undefined, null, "not a function", 42])("tolerates a non-function ack (%p)", async (cb) => {
        await expect(join[handler](io, socket, {}, cb)).resolves.toBeUndefined();
        gameServices[serviceFn].mockRejectedValueOnce(new Error("x"));
        await expect(join[handler](io, socket, {}, cb)).resolves.toBeUndefined();
    });
});

describe("fnRejoinRoom", () => {
    const call = (data) => callHandler(join.fnRejoinRoom, io, socket, data);

    test.each([undefined, null, {}, { gameId: "" }])("404 without a gameId (%p) and no lookup", async (data) => {
        await expect(call(data)).resolves.toEqual({ status: 404, message: "This game is no longer available." });
        expect(gameServices.fnGetRoom).not.toHaveBeenCalled();
    });

    test("ignores socket._gameId (only the payload is used)", async () => {
        socket._gameId = "g1";
        await expect(call({})).resolves.toMatchObject({ status: 404 });
    });

    test("404 when the room no longer exists", async () => {
        gameServices.fnGetRoom.mockResolvedValue(null);
        await expect(call({ gameId: "g1" })).resolves.toMatchObject({ status: 404 });
        expect(socket.join).not.toHaveBeenCalled();
    });

    test("404 (and no subscription) for a user who isn't in the room", async () => {
        gameServices.fnGetRoom.mockResolvedValue(waiting({ players: [{ userId: "someone-else" }] }));
        await expect(call({ gameId: "g1" })).resolves.toMatchObject({ status: 404 });
        expect(socket.join).not.toHaveBeenCalled();
        expect(socket._gameId).toBeUndefined();
    });

    test("re-subscribes a member and acks with the room state, without broadcasting", async () => {
        gameServices.fnGetRoom.mockResolvedValue(waiting());
        const res = await call({ gameId: "g1" });
        expect(res).toEqual({ status: 200, ...gameServices.fnPublicRoomState(waiting()) });
        expect(socket.join).toHaveBeenCalledWith("g1");
        expect(socket._gameId).toBe("g1");
        expect(io.emitted).toHaveLength(0);
    });

    test("tolerates a non-function ack", async () => {
        await expect(join.fnRejoinRoom(io, socket, {}, null)).resolves.toBeUndefined();
    });

    // KNOWN BUG — no try/catch: a redis error rejects the handler, the client's
    // ack is never called (its UI hangs) and the rejection goes unhandled.
    test.failing("acks with an error when the room lookup throws", async () => {
        gameServices.fnGetRoom.mockRejectedValue(new Error("redis down"));
        const cb = jest.fn();
        await join.fnRejoinRoom(io, socket, { gameId: "g1" }, cb).catch(() => {});
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: expect.any(Number) }));
    });
});

describe("fnLeaveRoom", () => {
    const call = (data) => callHandler(join.fnLeaveRoom, io, socket, data);

    test("with no gameId anywhere it just acks 200", async () => {
        await expect(call(undefined)).resolves.toEqual({ status: 200 });
        expect(gameServices.fnGetRoom).not.toHaveBeenCalled();
        expect(socket._gameId).toBeNull();
    });

    test("falls back to socket._gameId and prefers the payload's gameId when both exist", async () => {
        gameServices.fnGetRoom.mockResolvedValue(null);
        socket._gameId = "from-socket";
        await call({});
        expect(gameServices.fnGetRoom).toHaveBeenLastCalledWith("from-socket");
        socket._gameId = "from-socket";
        await call({ gameId: "from-payload" });
        expect(gameServices.fnGetRoom).toHaveBeenLastCalledWith("from-payload");
    });

    describe("while waiting", () => {
        test("removes the player, refunds the stake, unsubscribes, and broadcasts the smaller room", async () => {
            gameServices.fnGetRoom.mockResolvedValue(waiting());
            const after = waiting({ players: [{ userId: "user-2", sName: "Bob", sImage: 37 }] });
            gameServices.fnRemovePlayer.mockResolvedValue({ room: after, removedFrom: waiting() });

            await expect(call({ gameId: "g1" })).resolves.toEqual({ status: 200 });
            expect(gameServices.fnRemovePlayer).toHaveBeenCalledWith("g1", "user-1");
            expect(socket.leave).toHaveBeenCalledWith("g1");
            expect(wallet.fnCreditChips).toHaveBeenCalledWith("user-1", 100);
            expect(io.eventsFor(SOCKET_EVENTS.room_update)[0].payload).toEqual(gameServices.fnPublicRoomState(after));
            expect(gameServices.fnEndGameByForfeit).not.toHaveBeenCalled();
            expect(socket._gameId).toBeNull();
        });

        test("no broadcast when the room was deleted (last player left)", async () => {
            gameServices.fnGetRoom.mockResolvedValue(waiting());
            gameServices.fnRemovePlayer.mockResolvedValue({ room: null, removedFrom: waiting() });
            await call({ gameId: "g1" });
            expect(wallet.fnCreditChips).toHaveBeenCalledWith("user-1", 100);
            expect(io.emitted).toHaveLength(0);
        });

        test("refunds the stake recorded at removal time, not the earlier read", async () => {
            gameServices.fnGetRoom.mockResolvedValue(waiting({ lobbyChips: 999 }));
            gameServices.fnRemovePlayer.mockResolvedValue({ room: null, removedFrom: waiting({ lobbyChips: 100 }) });
            await call({ gameId: "g1" });
            expect(wallet.fnCreditChips).toHaveBeenCalledWith("user-1", 100);
        });

        test("no refund if this call didn't actually remove the player (a concurrent leave or sweep got there first)", async () => {
            gameServices.fnGetRoom.mockResolvedValue(waiting());
            gameServices.fnRemovePlayer.mockResolvedValue({ room: null, removedFrom: null });
            await call({ gameId: "g1" });
            expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        });

        test("no refund if the room had started by the time the removal landed", async () => {
            gameServices.fnGetRoom.mockResolvedValue(waiting());
            gameServices.fnRemovePlayer.mockResolvedValue({ room: playing(), removedFrom: playing() });
            await call({ gameId: "g1" });
            expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        });

        test.each([0, undefined, -5])("no refund for a free room (lobbyChips=%p)", async (lobbyChips) => {
            gameServices.fnGetRoom.mockResolvedValue(waiting({ lobbyChips }));
            gameServices.fnRemovePlayer.mockResolvedValue({ room: null, removedFrom: waiting({ lobbyChips }) });
            await call({ gameId: "g1" });
            expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        });
    });

    describe("while playing", () => {
        test("forfeits, settles the pot once, and broadcasts the final state", async () => {
            gameServices.fnGetRoom.mockResolvedValue(playing());
            const finished = playing({ status: "finished", winnerId: "user-2" });
            gameServices.fnEndGameByForfeit.mockResolvedValue({ room: finished, justFinished: true });

            await expect(call({ gameId: "g1" })).resolves.toEqual({ status: 200 });
            expect(gameServices.fnEndGameByForfeit).toHaveBeenCalledWith("g1", "user-1");
            expect(socket.leave).toHaveBeenCalledWith("g1");
            expect(payout.fnSettleGamePot).toHaveBeenCalledWith(finished);
            const [evt] = io.eventsFor(SOCKET_EVENTS.dice_rolled);
            expect(evt.payload).toMatchObject({ roll: null, roomStatus: "finished", winnerId: "user-2" });
            expect(gameServices.fnRemovePlayer).not.toHaveBeenCalled();
            expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        });

        test("does not pay out again if someone else already finished it", async () => {
            gameServices.fnGetRoom.mockResolvedValue(playing());
            gameServices.fnEndGameByForfeit.mockResolvedValue({ room: playing({ status: "finished" }), justFinished: false });
            await call({ gameId: "g1" });
            expect(payout.fnSettleGamePot).not.toHaveBeenCalled();
            expect(io.eventsFor(SOCKET_EVENTS.dice_rolled)).toHaveLength(1);
        });
    });

    describe("a room the user isn't in", () => {
        test.each([
            ["waiting", () => waiting({ players: [{ userId: "someone-else" }] })],
            ["playing", () => playing({ players: [{ userId: "a" }, { userId: "b" }], playerOrder: ["a", "b"] })],
        ])("a %s room is left alone: no removal, refund, forfeit, payout or broadcast", async (_, makeRoom) => {
            gameServices.fnGetRoom.mockResolvedValue(makeRoom());
            await expect(call({ gameId: "g1" })).resolves.toEqual({ status: 200 });
            expect(gameServices.fnRemovePlayer).not.toHaveBeenCalled();
            expect(gameServices.fnEndGameByForfeit).not.toHaveBeenCalled();
            expect(wallet.fnCreditChips).not.toHaveBeenCalled();
            expect(payout.fnSettleGamePot).not.toHaveBeenCalled();
            expect(io.emitted).toHaveLength(0);
            expect(socket.leave).toHaveBeenCalledWith("g1");
            expect(socket._gameId).toBeNull();
        });
    });

    test("leaving a finished game just removes the player (no refund, no payout)", async () => {
        const finished = playing({ status: "finished", winnerId: "user-2" });
        gameServices.fnGetRoom.mockResolvedValue(finished);
        gameServices.fnRemovePlayer.mockResolvedValue({ room: playing({ status: "finished", players: [{ userId: "user-2" }] }), removedFrom: finished });
        await call({ gameId: "g1" });
        expect(gameServices.fnRemovePlayer).toHaveBeenCalled();
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        expect(payout.fnSettleGamePot).not.toHaveBeenCalled();
    });

    test("an unknown room is treated as already gone (no refund)", async () => {
        gameServices.fnGetRoom.mockResolvedValue(null);
        gameServices.fnRemovePlayer.mockResolvedValue({ room: null, removedFrom: null });
        await expect(call({ gameId: "ghost" })).resolves.toEqual({ status: 200 });
        expect(gameServices.fnRemovePlayer).toHaveBeenCalledWith("ghost", "user-1");
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test.each([
        ["the room lookup", () => gameServices.fnGetRoom.mockRejectedValue(new Error("x"))],
        ["the forfeit", () => {
            gameServices.fnGetRoom.mockResolvedValue(playing());
            gameServices.fnEndGameByForfeit.mockRejectedValue(new Error("x"));
        }],
        ["the payout", () => {
            gameServices.fnGetRoom.mockResolvedValue(playing());
            gameServices.fnEndGameByForfeit.mockResolvedValue({ room: playing({ status: "finished" }), justFinished: true });
            payout.fnSettleGamePot.mockRejectedValue(new Error("x"));
        }],
        ["the refund", () => {
            gameServices.fnGetRoom.mockResolvedValue(waiting());
            gameServices.fnRemovePlayer.mockResolvedValue({ room: null, removedFrom: waiting() });
            wallet.fnCreditChips.mockRejectedValue(new Error("x"));
        }],
    ])("errors in %s are logged and the client still gets a 200 ack", async (_, arrange) => {
        arrange();
        socket._gameId = "g1";
        await expect(call({})).resolves.toEqual({ status: 200 });
        expect(logger.warn).toHaveBeenCalledWith("leaveRoom error", expect.any(Error));
        expect(socket._gameId).toBeNull();
    });

    test("tolerates a non-function ack", async () => {
        await expect(join.fnLeaveRoom(io, socket, {}, undefined)).resolves.toBeUndefined();
    });
});

describe("fnStartBackgroundSweeps", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        gameServices.fnSweepExpiredWaitingRooms.mockResolvedValue();
        gameServices.fnSweepAbandonedGames.mockResolvedValue();
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("runs both sweeps every 3 seconds", async () => {
        join.fnStartBackgroundSweeps(io);
        await jest.advanceTimersByTimeAsync(2999);
        expect(gameServices.fnSweepExpiredWaitingRooms).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(gameServices.fnSweepExpiredWaitingRooms).toHaveBeenCalledTimes(1);
        expect(gameServices.fnSweepAbandonedGames).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(6000);
        expect(gameServices.fnSweepExpiredWaitingRooms).toHaveBeenCalledTimes(3);
        expect(gameServices.fnSweepAbandonedGames).toHaveBeenCalledTimes(3);
    });

    test("expired rooms: every player is refunded and the room is told it was cancelled", async () => {
        join.fnStartBackgroundSweeps(io);
        await jest.advanceTimersByTimeAsync(3000);
        const onExpired = gameServices.fnSweepExpiredWaitingRooms.mock.calls[0][0];
        await onExpired(waiting({ players: [{ userId: "a" }, { userId: "b" }] }));
        expect(wallet.fnCreditChips.mock.calls).toEqual([["a", 100], ["b", 100]]);
        expect(io.eventsFor(SOCKET_EVENTS.room_cancelled)).toEqual([
            { room: "g1", event: SOCKET_EVENTS.room_cancelled, payload: { message: "Not enough players joined in time." } },
        ]);
    });

    test("expired free rooms are cancelled without touching the wallet", async () => {
        join.fnStartBackgroundSweeps(io);
        await jest.advanceTimersByTimeAsync(3000);
        await gameServices.fnSweepExpiredWaitingRooms.mock.calls[0][0](waiting({ lobbyChips: 0 }));
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
        expect(io.eventsFor(SOCKET_EVENTS.room_cancelled)).toHaveLength(1);
    });

    test("abandoned games are settled and the final state broadcast", async () => {
        join.fnStartBackgroundSweeps(io);
        await jest.advanceTimersByTimeAsync(3000);
        const onAbandoned = gameServices.fnSweepAbandonedGames.mock.calls[0][0];
        const room = playing({ status: "finished", abandoned: true });
        await onAbandoned(room);
        expect(payout.fnSettleGamePot).toHaveBeenCalledWith(room);
        expect(io.eventsFor(SOCKET_EVENTS.dice_rolled)[0].payload).toMatchObject({ roll: null, abandoned: true, winnerId: null });
    });

    test("a failing sweep is logged and the timer keeps running", async () => {
        gameServices.fnSweepExpiredWaitingRooms.mockRejectedValue(new Error("redis down"));
        gameServices.fnSweepAbandonedGames.mockRejectedValue(new Error("redis down"));
        join.fnStartBackgroundSweeps(io);
        await jest.advanceTimersByTimeAsync(6000);
        expect(logger.warn).toHaveBeenCalledWith("fnSweepExpiredWaitingRooms error", expect.any(Error));
        expect(logger.warn).toHaveBeenCalledWith("fnSweepAbandonedGames error", expect.any(Error));
        expect(gameServices.fnSweepExpiredWaitingRooms).toHaveBeenCalledTimes(2);
    });
});
