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

const _fnInitGlobal = () => {
    try {
        global.gamePublisher = {};
        global.tables = {};
        global.tmnt_waiting_timer = {};

        global.team_player_wtr = {};
        global.team_wtr = {};

        global.loginEntry = {};
        global.cronJobs = {};
        global.gs = {};

        global.ObjectId = require('mongodb').ObjectId;

        global.redisClientUser = redisConnection(constants.R_USER_CACHE, `Global redis user`);

        global.redisClientGame = redisConnection(constants.R_GAME_CACHE, `Global redis game`);
        global.redisClientGameSA = redisConnection(constants.R_GAME_CACHE_SA, `Global redis game standalone`);

        global.redisClientLB = redisConnection(constants.R_LB_CACHE, `Global redis LB`);
        global.redisClientAddon = redisConnection(constants.R_ADDON_CACHE, `Global redis addon`);

        global.mongoOps = require('../utils/mongodb/mongo.ops');
        global.redisKeys = require('../utils/redis/redis.keys');
        global.redisOps = require('../utils/redis/redis.ops');

        global.userServices = require('../services/user.services');
        global.gameServices = require('../services/game.services');
        global.teamgameServices = require('../services/teamgame.services');

        redisOps.fnInitializeGamePubSubServerList();
    } catch (err) {
        throw err;
    }
};

module.exports = fnStartServer;