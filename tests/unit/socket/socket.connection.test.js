"use strict";

const jwt = require("jsonwebtoken");
const SOCKET_EVENTS = require("../../../socket/socket.events");
const { createFakeIo, createFakeSocket } = require("../../helpers/socketFakes");

const SECRET = process.env.JWT_SECRET || "dev_secret_change_in_prod";
const GRACE_MS = 5000;

// socket.connection keeps module-level state (socketIds, pending timers), so
// load a fresh copy for every test.
let conn;
let joinController;
let gameplayController;
beforeEach(() => {
    jest.resetModules();
    jest.doMock("../../../socket/controllers/join.controller");
    jest.doMock("../../../socket/controllers/gameplay.controller");
    conn = require("../../../socket/socket.connection");
    joinController = require("../../../socket/controllers/join.controller");
    gameplayController = require("../../../socket/controllers/gameplay.controller");
    jest.useFakeTimers();
});
afterEach(() => {
    jest.useRealTimers();
});

describe("socket.events", () => {
    test("event names are unique", () => {
        const names = Object.values(SOCKET_EVENTS);
        expect(new Set(names).size).toBe(names.length);
    });
});

describe("fnPreConnection", () => {
    const handshake = (auth = {}, query = {}) => {
        const socket = createFakeSocket({ userId: undefined, sName: undefined });
        socket.handshake = { auth, query };
        return socket;
    };
    const token = (payload = { _id: "u1", sName: "Alice" }, opts) => jwt.sign(payload, SECRET, opts);

    test("accepts a token from handshake.auth and stamps the identity on the socket", () => {
        const socket = handshake({ token: token() });
        const next = jest.fn();
        conn.fnPreConnection({}, socket, next);
        expect(next).toHaveBeenCalledWith();
        expect(socket._userId).toBe("u1");
        expect(socket._sName).toBe("Alice");
    });

    test("falls back to the query string token", () => {
        const socket = handshake({}, { token: token() });
        const next = jest.fn();
        conn.fnPreConnection({}, socket, next);
        expect(next).toHaveBeenCalledWith();
        expect(socket._userId).toBe("u1");
    });

    test("handshake.auth wins over the query string", () => {
        const socket = handshake({ token: token({ _id: "from-auth" }) }, { token: token({ _id: "from-query" }) });
        conn.fnPreConnection({}, socket, jest.fn());
        expect(socket._userId).toBe("from-auth");
    });

    test.each([
        ["no token", handshake()],
        ["an empty token", handshake({ token: "" })],
        ["a garbage token", handshake({ token: "abc" })],
        ["a token signed with another secret", handshake({ token: jwt.sign({ _id: "u1" }, "other") })],
        ["an expired token", handshake({ token: jwt.sign({ _id: "u1", exp: 1 }, SECRET) })],
        ["a missing auth object", Object.assign(createFakeSocket(), { handshake: { query: {} } })],
        ["a missing query object", Object.assign(createFakeSocket(), { handshake: { auth: {} } })],
    ])("rejects %s with Unauthorized", (_, socket) => {
        const next = jest.fn();
        conn.fnPreConnection({}, socket, next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(next.mock.calls[0][0].message).toBe("Unauthorized");
    });

    test("rejects (rather than crashing) when the handshake itself is missing", () => {
        const next = jest.fn();
        conn.fnPreConnection({}, {}, next);
        expect(next.mock.calls[0][0].message).toBe("Unauthorized");
    });
});

describe("fnConnection", () => {
    let io;
    beforeEach(() => {
        io = createFakeIo();
    });

    test("registers the user's socket id", () => {
        const socket = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, socket);
        expect(conn.socketIds.u1).toBe(socket.id);
    });

    test.each([
        [SOCKET_EVENTS.join_public_room, "join", "fnJoinPublicGame"],
        [SOCKET_EVENTS.join_private_room, "join", "fnJoinPrivateGame"],
        [SOCKET_EVENTS.rejoin_room, "join", "fnRejoinRoom"],
        [SOCKET_EVENTS.leave_room, "join", "fnLeaveRoom"],
        [SOCKET_EVENTS.rejoin_game, "gameplay", "fnRejoinGame"],
        [SOCKET_EVENTS.roll_dice, "gameplay", "fnRollDice"],
    ])("routes '%s' to %s.%s with (io, socket, data, ack)", (event, ctrl, fn) => {
        const socket = createFakeSocket();
        conn.fnConnection(io, socket);
        const data = { x: 1 };
        const ack = jest.fn();
        socket.emit(event, data, ack);
        const controller = ctrl === "join" ? joinController : gameplayController;
        expect(controller[fn]).toHaveBeenCalledWith(io, socket, data, ack);
    });

    test("a disconnect outside any game cleans up immediately with no leave", () => {
        const socket = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, socket);
        socket.emit("disconnect");
        expect(conn.socketIds.u1).toBeUndefined();
        jest.advanceTimersByTime(GRACE_MS * 2);
        expect(joinController.fnLeaveRoom).not.toHaveBeenCalled();
        expect(socket.listenerCount(SOCKET_EVENTS.roll_dice)).toBe(0);
    });

    test("a disconnect mid-game leaves the room only after the grace period", () => {
        const socket = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, socket);
        socket._gameId = "g1";
        socket.emit("disconnect");

        jest.advanceTimersByTime(GRACE_MS - 1);
        expect(joinController.fnLeaveRoom).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(joinController.fnLeaveRoom).toHaveBeenCalledTimes(1);
        expect(joinController.fnLeaveRoom).toHaveBeenCalledWith(io, socket, {}, expect.any(Function));
        expect(() => joinController.fnLeaveRoom.mock.calls[0][3]()).not.toThrow();
    });

    test("reconnecting within the grace period cancels the pending leave (page navigation)", () => {
        const first = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, first);
        first._gameId = "g1";
        first.emit("disconnect");

        jest.advanceTimersByTime(GRACE_MS - 100);
        const second = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, second);
        jest.advanceTimersByTime(GRACE_MS * 2);

        expect(joinController.fnLeaveRoom).not.toHaveBeenCalled();
        expect(conn.socketIds.u1).toBe(second.id);
    });

    test("reconnecting AFTER the grace period is too late", () => {
        const first = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, first);
        first._gameId = "g1";
        first.emit("disconnect");
        jest.advanceTimersByTime(GRACE_MS);
        conn.fnConnection(io, createFakeSocket({ userId: "u1" }));
        expect(joinController.fnLeaveRoom).toHaveBeenCalledTimes(1);
    });

    test("another user's reconnect doesn't cancel this user's pending leave", () => {
        const socket = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, socket);
        socket._gameId = "g1";
        socket.emit("disconnect");
        conn.fnConnection(io, createFakeSocket({ userId: "u2" }));
        jest.advanceTimersByTime(GRACE_MS);
        expect(joinController.fnLeaveRoom).toHaveBeenCalledTimes(1);
    });

    test("with two tabs open, closing the older one keeps the newer registered and never leaves", () => {
        const older = createFakeSocket({ userId: "u1" });
        const newer = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, older);
        conn.fnConnection(io, newer);
        older._gameId = "g1";
        older.emit("disconnect");

        expect(conn.socketIds.u1).toBe(newer.id);
        jest.advanceTimersByTime(GRACE_MS);
        expect(joinController.fnLeaveRoom).not.toHaveBeenCalled();
    });

    test("a socket error triggers the same cleanup, and the later disconnect is a no-op", () => {
        const socket = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, socket);
        socket._gameId = "g1";
        socket.emit("error", new Error("transport"));
        expect(logger.error).toHaveBeenCalledWith("Socket error: userId=u1", expect.any(Error));
        socket.emit("disconnect");

        jest.advanceTimersByTime(GRACE_MS);
        expect(joinController.fnLeaveRoom).toHaveBeenCalledTimes(1);
    });

    test("cleanup errors are logged, not thrown", () => {
        const socket = createFakeSocket({ userId: "u1" });
        conn.fnConnection(io, socket);
        socket.removeAllListeners = () => {
            throw new Error("boom");
        };
        expect(() => socket.emit("disconnect")).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith("Socket cleanup error", expect.any(Error));
    });
});
