'use strict';

const jwt = require('jsonwebtoken');
const joinController = require('./controllers/join.controller');
const gameplayController = require('./controllers/gameplay.controller');
const SOCKET_EVENTS = require('./socket.events');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';

const socketIds = {};
const pendingLeaveTimers = new Map();

// This app moves between screens (main -> search -> gameplay) via full page
// navigations, so every screen transition disconnects the old socket and
// opens a new one. Leaving the room immediately on disconnect would destroy
// a player's room/game on every navigation, before their next page's socket
// has a chance to reconnect and rejoin. Give reconnects a short window.
const RECONNECT_GRACE_MS = 5000;

const fnPreConnection = (io, socket, next) => {
    try {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error("Unauthorized"));

        const decoded = jwt.verify(token, JWT_SECRET);
        socket._userId = decoded._id;
        socket._sName = decoded.sName;
        next();
    } catch (err) {
        next(new Error("Unauthorized"));
    }
};

const fnConnection = (io, socket) => {
    socketIds[socket._userId] = socket.id;

    const pendingLeave = pendingLeaveTimers.get(socket._userId);
    if (pendingLeave) {
        clearTimeout(pendingLeave);
        pendingLeaveTimers.delete(socket._userId);
    }

    logger.info(`Socket connected: userId=${socket._userId}, socketId=${socket.id}`);

    socket.on(SOCKET_EVENTS.join_public_room, (data, callback) => joinController.fnJoinPublicGame(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.join_private_room, (data, callback) => joinController.fnJoinPrivateGame(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.rejoin_room, (data, callback) => joinController.fnRejoinRoom(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.leave_room, (data, callback) => joinController.fnLeaveRoom(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.rejoin_game, (data, callback) => gameplayController.fnRejoinGame(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.roll_dice, (data, callback) => gameplayController.fnRollDice(io, socket, data, callback));

    socket.on("disconnect", () => _fnSocketCleanup(io, socket));
    socket.on("error", (err) => {
        logger.error(`Socket error: userId=${socket._userId}`, err);
        _fnSocketCleanup(io, socket);
    });
};

const _fnSocketCleanup = (io, socket) => {
    try {
        const userId = socket._userId;
        if (socketIds[userId] === socket.id) delete socketIds[userId];
        logger.info(`Socket disconnected: userId=${userId}, socketId=${socket.id}`);
        socket.removeAllListeners();

        if (socket._gameId) {
            const timer = setTimeout(() => {
                pendingLeaveTimers.delete(userId);
                if (socketIds[userId]) return; // reconnected on a new socket in the meantime
                joinController.fnLeaveRoom(io, socket, {}, () => {});
            }, RECONNECT_GRACE_MS);
            pendingLeaveTimers.set(userId, timer);
        }
    } catch (err) {
        logger.error("Socket cleanup error", err);
    }
};

module.exports = { fnPreConnection, fnConnection, socketIds };
