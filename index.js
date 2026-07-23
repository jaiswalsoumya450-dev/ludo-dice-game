"use strict";

require('dotenv').config();
const express = require('express');
require('events').EventEmitter.defaultMaxListeners = 15;

global.constants = require('./constants/app.constants.js');
global.logger = require('./config/logger.config');

(async () => {
    try {
        const app = express();
        require('./config/app.config')(app);
        await require('./modules/start.server')(app);
    }
    catch (err) {
        logger.warn("Error in starting server %o", err);
        return err;
    }
})();

//handle un handled Promise
process.on('unhandledRejection', err => logger.warn('Custom unhandledRejection %o', err));

//handle un handled Exception
process.on('uncaughtException', err => logger.warn('Custom uncaughtException %o', err));

process.on('warning', err => logger.warn('Custom warning %o', err));