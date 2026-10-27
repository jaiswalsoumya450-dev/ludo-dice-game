'use strict';

const socketConnection = require('./socket.connection.js');
const joinController = require('./controllers/join.controller');

const fnInit = (http) => {
    const socketOptions = {
        path: `/${constants.CODE_VERSION}/socket.io`,
        transports: ["websocket", "polling"]
    };

    const io = require('socket.io')(http, socketOptions);
    io.setMaxListeners(0);

    io.use((socket, next) => socketConnection.fnPreConnection(io, socket, next));

    io.on("connection", (socket) => socketConnection.fnConnection(io, socket));
    io.on("connection_error", _fnSocketErrorHandler);

    // reap rooms nobody filled in time and games abandoned mid-match (refunds/settles their stakes);
    // safe to run on every instance, each expiry is claimed by exactly one
    joinController.fnStartBackgroundSweeps(io);

    return;
};

module.exports = { fnInit };

const _fnSocketErrorHandler = err => logger.error("Socket error: ", err);