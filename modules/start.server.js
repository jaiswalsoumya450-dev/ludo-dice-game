'use strict';

const fnMongoDBConnection = require('../utils/mongodb/connection').fnMongoDBConnection;
//const redisConnection = require('../utils/redis/connection');
const socketIO = require("../socket/socket.init");


const fnStartServer = async (app) => {
    try {
        const serverOptions = {
            keepAliveTimeout: 65000,
            headersTimeout: 66000
        };
        const http = require('node:http').createServer(serverOptions, app);

        socketIO.fnInit(http);

        await fnMongoDBConnection();
        await _fnListenServer(http);

    } catch (err) {
        throw err;
    }
};

const _fnListenServer = async (http) => {
    if (http.listening) return;

    await new Promise((resolve) => {
        http.listen(constants.PORT, constants.LOCAL_IP, () => resolve());
    });

    logger.info(
        `Start Server at: %s , Process Identifier: %s`,
        http.address(),
        constants.PROCESS_IDENTIFIER
    );
};

module.exports = fnStartServer;