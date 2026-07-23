'use strict';

const log4js = require('log4js');
const appenders = constants.NODE_ENV || 'local';

log4js.configure({
    appenders: {
        console: {
            type: 'console'
        },
        standard: {
            type: 'stdout'
        }
    },
    categories: {
        prod: {
            appenders: ['standard'],
            level: 'trace',
            enableCallStack: true
        },
        staging: {
            appenders: ['standard'],
            level: 'trace',
            enableCallStack: true
        },
        dev: {
            appenders: ['standard'],
            level: 'trace',
            enableCallStack: true
        },
        local: {
            appenders: ['standard'],
            level: 'trace',
            enableCallStack: true
        },
        default: {
            appenders: ['standard'],
            level: 'trace',
            enableCallStack: true
        }
    }
});

const logger = log4js.getLogger(appenders);
module.exports = logger;