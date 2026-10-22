"use strict";

jest.mock("../../../services/game.services", () => {
    const actual = jest.requireActual("../../../services/game.services");
    return {
        fnPublicGameState: actual.fnPublicGameState,
        fnGetRoom: jest.fn(),
        fnRollDice: jest.fn(),
    };
});
jest.mock("../../../services/payout.services");

const gameServices = require("../../../services/game.services");
const payout = require("../../../services/payout.services");
const SOCKET_EVENTS = require("../../../socket/socket.events");
const gameplay = require("../../../socket/controllers/gameplay.controller");
const { createFakeIo, createFakeSocket, callHandler } = require("../../helpers/socketFakes");

const room = (overrides = {}) => ({
    gameId: "g1",
    eRoomMode: "Public",
    maxPlayers: 2,
    lobbyChips: 100,
    status: "playing",
    players: [{ userId: "user-1", sName: "A", sImage: 1 }, { userId: "user-2", sName: "B", sImage: 2 }],
    playerOrder: ["user-1", "user-2"],
    scores: { "user-1": 4, "user-2": 0 },
    turnIndex: 1,
    target: 100,
    winnerId: null,
    ...overrides,
});

let io;
let socket;
beforeEach(() => {
    io = createFakeIo();
    socket = createFakeSocket();
    payout.fnSettleGamePot.mockResolvedValue();
});

describe("fnRejoinGame", () => {
    const call = (data) => callHandler(gameplay.fnRejoinGame, io, socket, data);

    test("re-subscribes a member and acks with the game state", async () => {
        gameServices.fnGetRoom.mockResolvedValue(room());
        await expect(call({ gameId: "g1" })).resolves.toEqual({ status: 200, ...gameServices.fnPublicGameState(room()) });
        expect(socket.join).toHaveBeenCalledWith("g1");
        expect(socket._gameId).toBe("g1");
        expect(io.emitted).toHaveLength(0);
    });

    test("falls back to socket._gameId when the payload has none", async () => {
        socket._gameId = "g1";
        gameServices.fnGetRoom.mockResolvedValue(room());
        await call(undefined);
        expect(gameServices.fnGetRoom).toHaveBeenCalledWith("g1");
    });

    test("works for a finished game (to show the result screen)", async () => {
        gameServices.fnGetRoom.mockResolvedValue(room({ status: "finished", winnerId: "user-1" }));
        await expect(call({ gameId: "g1" })).resolves.toMatchObject({ status: 200, roomStatus: "finished", winnerId: "user-1" });
    });

    test.each([undefined, null, {}])("404 without any gameId (%p)", async (data) => {
        await expect(call(data)).resolves.toEqual({ status: 404, message: "This game is no longer available." });
        expect(gameServices.fnGetRoom).not.toHaveBeenCalled();
    });

    test("404 when the room is gone", async () => {
        gameServices.fnGetRoom.mockResolvedValue(null);
        await expect(call({ gameId: "g1" })).resolves.toMatchObject({ status: 404 });
    });

    test("404 for a spectator who isn't a player", async () => {
        socket._userId = "outsider";
        gameServices.fnGetRoom.mockResolvedValue(room());
        await expect(call({ gameId: "g1" })).resolves.toMatchObject({ status: 404 });
        expect(socket.join).not.toHaveBeenCalled();
    });

    test("tolerates a non-function ack", async () => {
        await expect(gameplay.fnRejoinGame(io, socket, {}, "nope")).resolves.toBeUndefined();
    });

    // KNOWN BUG — same as fnRejoinRoom: no try/catch around the lookup.
    test.failing("acks with an error when the room lookup throws", async () => {
        gameServices.fnGetRoom.mockRejectedValue(new Error("redis down"));
        const cb = jest.fn();
        await gameplay.fnRejoinGame(io, socket, { gameId: "g1" }, cb).catch(() => {});
        expect(cb).toHaveBeenCalled();
    });
});

describe("fnRollDice", () => {
    const call = (data) => callHandler(gameplay.fnRollDice, io, socket, data);

    test("rolls as the socket's user, broadcasts to the room, and acks", async () => {
        gameServices.fnRollDice.mockResolvedValue({ roll: 4, room: room(), justFinished: false });
        const res = await call({ gameId: "g1", userId: "spoofed" });

        expect(gameServices.fnRollDice).toHaveBeenCalledWith("g1", "user-1");
        const expected = { roll: 4, ...gameServices.fnPublicGameState(room()) };
        expect(res).toEqual({ status: 200, ...expected });
        expect(io.emitted).toEqual([{ room: "g1", event: SOCKET_EVENTS.dice_rolled, payload: expected }]);
        expect(payout.fnSettleGamePot).not.toHaveBeenCalled();
    });

    test("falls back to socket._gameId", async () => {
        socket._gameId = "g1";
        gameServices.fnRollDice.mockResolvedValue({ roll: 1, room: room(), justFinished: false });
        await call(null);
        expect(gameServices.fnRollDice).toHaveBeenCalledWith("g1", "user-1");
    });

    test("settles the pot BEFORE announcing the winning roll", async () => {
        const finished = room({ status: "finished", winnerId: "user-1" });
        gameServices.fnRollDice.mockResolvedValue({ roll: 6, room: finished, justFinished: true });
        const order = [];
        payout.fnSettleGamePot.mockImplementation(async () => order.push("settle"));
        io.to.mockImplementation(() => ({ emit: () => order.push("emit") }));

        await call({ gameId: "g1" });
        expect(payout.fnSettleGamePot).toHaveBeenCalledWith(finished);
        expect(order).toEqual(["settle", "emit"]);
    });

    test.each([undefined, null, {}])("404 without any gameId (%p)", async (data) => {
        await expect(call(data)).resolves.toEqual({ status: 404, message: "This game is no longer available." });
        expect(gameServices.fnRollDice).not.toHaveBeenCalled();
    });

    test("relays domain errors (e.g. not your turn) without broadcasting", async () => {
        gameServices.fnRollDice.mockRejectedValue(Object.assign(new Error("It's not your turn."), { status: 400 }));
        await expect(call({ gameId: "g1" })).resolves.toEqual({ status: 400, message: "It's not your turn." });
        expect(io.emitted).toHaveLength(0);
    });

    test.each([
        [{ status: 404, message: "gone" }, { status: 404, message: "gone" }],
        [{ status: 409, message: "busy" }, { status: 409, message: "busy" }],
        [{}, { status: 400, message: "Could not roll." }],
        [new Error(""), { status: 400, message: "Could not roll." }],
    ])("maps error %p to %p", async (err, expected) => {
        gameServices.fnRollDice.mockRejectedValue(err);
        await expect(call({ gameId: "g1" })).resolves.toEqual(expected);
    });

    test("a payout failure is reported to the roller and nothing is broadcast (even though the roll was saved)", async () => {
        gameServices.fnRollDice.mockResolvedValue({ roll: 6, room: room({ status: "finished", winnerId: "user-1" }), justFinished: true });
        payout.fnSettleGamePot.mockRejectedValue(new Error("mongo down"));
        await expect(call({ gameId: "g1" })).resolves.toEqual({ status: 400, message: "mongo down" });
        expect(io.emitted).toHaveLength(0);
    });

    test("tolerates a non-function ack", async () => {
        await expect(gameplay.fnRollDice(io, socket, {}, undefined)).resolves.toBeUndefined();
    });
});
