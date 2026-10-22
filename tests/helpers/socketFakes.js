"use strict";

const { EventEmitter } = require("events");

/** Fake socket.io server: records every io.to(room).emit(event, payload). */
function createFakeIo() {
    const emitted = [];
    const io = {
        emitted,
        to: jest.fn((room) => ({
            emit: jest.fn((event, payload) => emitted.push({ room, event, payload })),
        })),
        eventsFor(event) {
            return emitted.filter((e) => e.event === event);
        },
    };
    return io;
}

let socketSeq = 0;

/** Fake server-side socket, already authenticated the way fnPreConnection leaves it. */
function createFakeSocket({ userId = "user-1", sName = "Alice", id } = {}) {
    const socket = new EventEmitter();
    socket.id = id || `sock-${++socketSeq}`;
    socket._userId = userId;
    socket._sName = sName;
    socket.handshake = { auth: {}, query: {} };
    socket.rooms = new Set();
    socket.join = jest.fn((room) => socket.rooms.add(room));
    socket.leave = jest.fn((room) => socket.rooms.delete(room));
    return socket;
}

/** Invokes a socket controller handler and resolves with whatever it passes to its ack callback. */
function callHandler(handler, io, socket, data) {
    return new Promise((resolve, reject) => {
        Promise.resolve(handler(io, socket, data, resolve)).catch(reject);
    });
}

module.exports = { createFakeIo, createFakeSocket, callHandler };
