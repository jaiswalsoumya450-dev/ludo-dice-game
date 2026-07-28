'use strict';

const socketConnection = require('./socket.connection.js');

const fnInit = (http) => {
    const socketOptions = {
        path: `/${constants.CODE_VERSION}/socket.io`,
        transports: ["websocket", "polling"]
    };

    const io = require('socket.io')(http, socketOptions);
    io.setMaxListeners(0);

    //io.use((socket, next) => socketConnection.fnPreConnection(io, socket, next));

    io.on("connection", socketConnection.fnConnection);
    io.on("connection_error", _fnSocketErrorHandler);

    return;
};

module.exports = { fnInit };

const _fnSocketErrorHandler = err => logger.error("Socket error: ", err);