"use strict";

const { EventEmitter } = require("events");

const mockIo = new EventEmitter();
mockIo.use = jest.fn();
mockIo.setMaxListeners = jest.fn();

jest.mock("socket.io", () => jest.fn(() => mockIo));
jest.mock("../../../socket/socket.connection.js");
jest.mock("../../../socket/controllers/join.controller");

const socketIO = require("socket.io");
const socketConnection = require("../../../socket/socket.connection.js");
const joinController = require("../../../socket/controllers/join.controller");
const { fnInit } = require("../../../socket/socket.init");

beforeEach(() => {
    mockIo.removeAllListeners();
});

describe("fnInit", () => {
    test("creates the server on the versioned path with websocket+polling", () => {
        const http = {};
        expect(fnInit(http)).toBeUndefined();
        expect(socketIO).toHaveBeenCalledWith(http, { path: "/v1/socket.io", transports: ["websocket", "polling"] });
        expect(mockIo.setMaxListeners).toHaveBeenCalledWith(0);
    });

    test("installs the auth middleware", () => {
        fnInit({});
        const mw = mockIo.use.mock.calls[0][0];
        const socket = {};
        const next = jest.fn();
        mw(socket, next);
        expect(socketConnection.fnPreConnection).toHaveBeenCalledWith(mockIo, socket, next);
    });

    test("routes new connections to fnConnection", () => {
        fnInit({});
        const socket = {};
        mockIo.emit("connection", socket);
        expect(socketConnection.fnConnection).toHaveBeenCalledWith(mockIo, socket);
    });

    test("logs connection errors", () => {
        fnInit({});
        const err = new Error("bad handshake");
        mockIo.emit("connection_error", err);
        expect(logger.error).toHaveBeenCalledWith("Socket error: ", err);
    });

    test("starts the background matchmaking/abandoned-game sweeps", () => {
        fnInit({});
        expect(joinController.fnStartBackgroundSweeps).toHaveBeenCalledWith(mockIo);
    });
});
