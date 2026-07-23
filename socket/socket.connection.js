'use strict';

const socketIds = {}
const fnPreConnection = (io, socket, next) => {
    try {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error("Unauthorized"));

        const decoded = jwt.verify(token, constants.JWT_SECRET);
        socket._userId = decoded.userId;
        next();
    } catch (err) {
        next(new Error("Unauthorized"));
    }
};

const fnConnection = (socket) => {
    socketIds[socket._userId] = socket.id;
    logger.info(`Socket connected: userId=${socket._userId}, socketId=${socket.id}`);

    socket.on("disconnect", () => _fnSocketCleanup(socket));
    socket.on("error", (err) => {
        logger.error(`Socket error: userId=${socket._userId}`, err);
        _fnSocketCleanup(socket);
    });
};

const _fnSocketCleanup = (socket) => {
    try {
        delete socketIds[socket._userId];
        logger.info(`Socket disconnected: userId=${socket._userId}`);
        socket.removeAllListeners();
    } catch (err) {
        logger.error("Socket cleanup error", err);
    }
};

module.exports = { fnPreConnection, fnConnection, socketIds };