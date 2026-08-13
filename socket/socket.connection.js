'use strict';

const jwt = require('jsonwebtoken');
const joinController = require('./controllers/join.controller');
const SOCKET_EVENTS = require('./socket.events');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';

const socketIds = {};

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
    logger.info(`Socket connected: userId=${socket._userId}, socketId=${socket.id}`);

    socket.on(SOCKET_EVENTS.join_public_room, (data, callback) => joinController.fnJoinPublicGame(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.join_private_room, (data, callback) => joinController.fnJoinPrivateGame(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.rejoin_room, (data, callback) => joinController.fnRejoinRoom(io, socket, data, callback));
    socket.on(SOCKET_EVENTS.leave_room, (data, callback) => joinController.fnLeaveRoom(io, socket, data, callback));

    socket.on("disconnect", () => _fnSocketCleanup(io, socket));
    socket.on("error", (err) => {
        logger.error(`Socket error: userId=${socket._userId}`, err);
        _fnSocketCleanup(io, socket);
    });
};

const _fnSocketCleanup = (io, socket) => {
    try {
        joinController.fnLeaveRoom(io, socket, {}, () => {});
        delete socketIds[socket._userId];
        logger.info(`Socket disconnected: userId=${socket._userId}`);
        socket.removeAllListeners();
    } catch (err) {
        logger.error("Socket cleanup error", err);
    }
};

module.exports = { fnPreConnection, fnConnection, socketIds };
