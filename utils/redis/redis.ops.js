'use strict';


const _ = require('lodash');
const Peers = require('weighted-round-robin');

const fnRedisKeyExists = (client, key) => client.exists(key);
const fnRedisKeyExpire = (client, key, ttl = 3600) => client.expire(key, ttl);
const fnRedisKEYS = (client, expression) => client.keys(expression); //keys works on single shard
const fnRedisTTL = (client, key) => client.ttl(key);
const fnRedisKeyDEL = (client, key) => client.del(key);
const fnRedisINCRBY = (client, key, value = 1) => client.incrby(key, value);
const fnRedisINCRBYAtomic = (client, key, value = 1) => {
    return new Promise((resolve, reject) => {
        return client.multi()
            .incrby(key, value)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 16);
                if (err) return reject(err);
                else return resolve(result);
            });
    });
};

const fnRedisHSET = (client, key, field, value) => client.hset(key, field, value);
const fnRedisHMSET = (client, key, data) => client.hmset(key, data);
const fnRedisHINCRBY = (client, key, field, value) => client.hincrby(key, field, value);
const fnRedisHGET = (client, key, field) => client.hget(key, field);
const fnRedisHDEL = (client, key, field) => client.hdel(key, field);
const fnRedisHGETALL = async (client, key) => {
    try {
        const result = await client.hgetall(key);
        if (result && Object.keys(result).length == 0) return;
        return result;
    }
    catch (err) {
        return;
    }
};
const fnRedisHMGET = (client, key, fields, defaultValue = {}) => {
    return new Promise((resolve, reject) => {
        return client.hmget(key, fields, (err, result) => {
            if (err) return reject(err);
            try {
                if (result[0] != null) {
                    let data = Object.create(null);
                    for (let i = 0; i < fields.length; i++) {
                        data[fields[i]] = result[i] || defaultValue[fields[i]] || "";
                    }
                    return resolve(data);
                } else {
                    return resolve(false);
                }
            } catch (err) {
                return reject(err);
            }
        })
    });
};

const fnRedisHMSETEX = (client, key, data, ttl = 600) => {
    return new Promise((resolve, reject) => {
        return client.multi()
            .hmset(key, data)
            .expire(key, ttl)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 16);
                if (err) return reject(err);
                return resolve(result);
            });
    });
};

const fnRedisHSETEX = (client, key, field, value, ttl = 600) => {
    return new Promise((resolve, reject) => {
        return client.multi()
            .hset(key, field, value)
            .expire(key, ttl)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 16);
                if (err) return reject(err);
                return resolve(result);
            });
    });
};

const fnRedisHINCRBYAtomic = (client, key, field, value = 1) => {
    return new Promise((resolve, reject) => {
        return client.multi()
            .hincrby(key, field, value)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 17);
                if (err) return reject(err);
                if (!result) return reject("race_condition");
                if (isNaN(parseInt(result[0]))) return reject("counter_failled");
                else return resolve(result);
            });
    });
};

const fnRedisJSONSET = (client, key, field = "$", value) => {
    return client.send_command('JSON.SET', key, field, value);
};

const fnRedisGET = (client, key) => client.get(key);
const fnRedisSET = (client, key, value) => client.set(key, value);
const fnRedisSETEX = (client, key, ttl = 600, value) => client.setex(key, ttl, value);
const fnRedisSETNX = (client, key, value) => client.setnx(key, value);
const fnRedisSETEXNX = (client, key, value, ttl = 60) => client.set(key, value, 'NX', 'EX', ttl);

const fnRedisSADD = (client, key, value) => client.sadd(key, value);
const fnRedisSMEMBERS = (client, key) => client.smembers(key);
const fnRedisSRANDMEMBER = (client, key) => client.srandmember(key);
const fnRedisSMOVE = (client, fromKey, toKey, value) => client.smove(fromKey, toKey, value);
const fnRedisSREM = (client, key, value) => client.srem(key, value);
const fnRedisSCARD = (client, key) => client.scard(key);
const fnRedisSISMEMBER = (client, key, value) => client.sismember(key, value);
const fnRedisSPOP = (client, key, count = 1) => client.spop(key, count);

const fnRedisSADDEX = (client, key, value, ttl = 30) => {
    return new Promise((resolve, reject) => {
        return client.multi()
            .sadd(key, value)
            .expire(key, ttl)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 16);
                if (err) return reject(err);
                else return resolve(result);
            });
    });
};

const fnRedisZADD = (client, key, value, field) => client.zadd(key, value, field.toString());
const fnRedisZADDXX = (client, key, value, field) => client.zadd(key, 'XX', value, field.toString());
const fnRedisZADDMulti = (client, key, elements = []) => client.zadd(key, elements);

const fnRedisZINCRBY = (client, key, value, field) => client.zincrby(key, value, field);
const fnRedisZREM = (client, key, value) => client.zrem(key, value.toString());
const fnRedisZREMMulti = (client, key, elements = []) => client.zrem(key, elements);
const fnRedisZCARD = (client, key) => client.zcard(key);
const fnRedisZCOUNT = (client, key, from, to) => client.zcount(key, from, to);
const fnRedisZRANK = (client, key, member) => client.zrank(key, member);
const fnRedisZREVRANK = (client, key, member) => client.zrevrank(key, member);
const fnRedisZSCORE = (client, key, member) => client.zscore(key, member);

const fnRedisZRANGEBYSCORE = (client, key, min, max, start = 0, end = -1, withScore = true) => {
    if (withScore) return client.zrangebyscore(key, min, max, 'WITHSCORES', 'LIMIT', start, end);
    return client.zrangebyscore(key, min, max, 'LIMIT', start, end);
};
const fnRedisZREVRANGEBYSCORE = (client, key, max, min, start = 0, end = -1, withScore = true) => {
    if (withScore) return client.zrevrangebyscore(key, max, min, 'WITHSCORES', 'LIMIT', start, end);
    return client.zrevrangebyscore(key, max, min, 'LIMIT', start, end);
};

const fnRedisZREVRANGE = (client, key, from, to, withScore = true) => {
    if (withScore) return client.zrevrange(key, from, to, 'WITHSCORES');
    else return client.zrevrange(key, from, to);
};

const fnRedisZREMRANGEBYRANK = (client, key, start, stop) => client.zremrangebyrank(key, start, stop);
const fnRedisZREMRANGEBYSCORE = (client, key, min, max) => client.zremrangebyscore(key, min, max);
const fnRedisZRANGE = (client, key, from, to, withScore = true) => {
    if (withScore) {
        return client.zrange(key, from, to, 'WITHSCORES');
    }
    else {
        return client.zrange(key, from, to);
    }
};
const fnRedisZMOVE = (client, fromKey, toKey, field, value = 0) => {
    return new Promise((resolve, reject) => {
        client.multi()
            .zrem(fromKey, field)
            .zadd(toKey, value, field)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 16);
                if (err) return reject(err);
                return resolve(result);
            });
    });
};
const fnRedisZADDEX = (client, key, value, field, ttl = 600) => {
    return new Promise((resolve, reject) => {
        return client.multi()
            .zadd(key, value, field.toString())
            .expire(key, ttl)
            .exec((err, result) => {
                [err, result] = fnMultiHandle(err, result, 18);
                if (err) return reject(err);
                return resolve(result);
            });
    });
};

const fnRedisLPUSH = (client, key, value) => client.lpush(key, value);
const fnRedisRPUSH = (client, key, value) => client.rpush(key, value);
const fnRedisLREM = (client, key, count, value) => client.lrem(key, count, value);
const fnRedisLRANGE = (client, key, from, to) => client.lrange(key, from, to);
const fnRedisLLEN = (client, key) => client.llen(key);
const fnRedisLTRIM = (client, key, from, to) => client.ltrim(key, from, to);

const fnLockAcquire = async (client, lockKey, ttl = 1) => {
    try {
        const result = await fnRedisSETEXNX(client, lockKey, 1, ttl);
        return result;

    } catch (err) {
        logger.warn(err, lockKey);
        return;
    }
};

const fnLockRelease = async (client, lockKey) => {
    try {
        fnRedisKeyDEL(client, lockKey).catch(helper.cbe);
    } catch (err) {
        logger.warn(err, lockKey);
    }
    return;
};

const fnMultiHandle = (error, result) => {
    try {
        if (error || !result) return [error, result];
        error = [];
        error = _.reduce(result, (x, value) => {
            if (value[0] != null) error.push(value[0]);
            return error.join();
        }, {});

        result = _.map(result, o => !o[0] ? o[1] : null);
    } catch (err) {
        logger.warn(err, error, result);
    }
    return [error, result];
};

const fnMultiErrorReduce = (error, result) => {
    try {
        if (error || !result) return error;
        error = [];
        error = _.reduce(result, (x, value) => {
            if (value[0] != null) error.push(value[0]);
            return error.join();
        }, {});

        if (!error) return;
    } catch (err) {
        logger.warn(err, error, result);
    }
    return error;
};

const fnMultiResultReduce = (result) => {
    try {
        if (!Array.isArray(result)) return [];
        return result.map(([err, data]) => (err ? null : data));
    } catch (err) {
        logger.warn(err, result);
        return [];
    }
};

const fnPipelineHandle = (error, result) => {
    try {
        if (error || !result) return [error, result];
        error = [];
        error = _.reduce(result, (x, value) => {
            if (value[0] != null) error.push(value[0]);
            return error.join();
        }, {});

        result = _.map(result, o => !o[0] ? o[1] : null);
    } catch (err) {
        logger.warn(err, error, result);
    }
    return [error, result];
};

const fnPipelineResultReduce = (result) => {
    try {
        if (!Array.isArray(result)) return [];
        return result.map(([err, data]) => (err ? null : data));
    } catch (err) {
        logger.warn(err, result);
        return [];
    }
};

/**
 * Checks if any command in the Redis pipeline failed.
 * @param {Array} pipelineResult - Result from pipeline, array of [err, result].
 * @returns {Error|null} - Returns an Error object if any command failed, otherwise null.
 */
function fnPipelineErrorReduce(result) {
    if (!Array.isArray(result)) {
        return new Error("Invalid pipeline result format.");
    }

    for (let i = 0; i < result.length; i++) {
        const [err] = result[i];
        if (err) {
            return new Error(`Redis pipeline error at index ${i}: ${err.message || err}`);
        }
    }
    return;
};

const fnGetAllShardKeys = async (client, key = '*', exactShard = null) => {
    try {
        let allKeys = [];
        // Get all master nodes (shards)
        const clusterInfo = await client.cluster('info').catch(() => null);
        if (clusterInfo) {
            const shards = client.nodes('master');
            // Iterate over each shard
            for (const shard of shards) {
                try {
                    if (exactShard) {
                        const { host, port } = shard.options;
                        if (host == exactShard) {
                            const keys = await shard.keys(key);
                            allKeys = allKeys.concat(keys);
                        }
                    }
                    else {
                        const keys = await shard.keys(key);
                        allKeys = allKeys.concat(keys);
                    }

                } catch (err) {
                    logger.warn(err);
                }
            }
        }
        else {
            allKeys = await client.keys(key);
        }
        return allKeys;
    }
    catch (err) {
        logger.warn(err);
        return [];
    }
};

const fnScanAcrossShards = async (client, pattern) => {
    try {
        if (!pattern) return;
        const nodes = client.nodes("master"); // Get all master nodes
        const foundKeys = [];

        for (const node of nodes) {
            let cursor = "0";
            do {
                const [nextCursor, keys] = await node.scan(cursor, "MATCH", pattern, "COUNT", 100);
                foundKeys.push(...keys);
                cursor = nextCursor;
            } while (cursor !== "0");
        }

        return foundKeys;
    }
    catch (err) {
        logger.warn(err);
        return [];
    }
};

const fnRedisPublish = async (channel, message, client) => {
    try {
        if (!channel || !message) return true;

        if (typeof message == 'object') {
            message = JSON.stringify(message);
        } else if (typeof message != 'string') {
            message = message.toString();
        }
        await client.publish(channel, message);
        return true;
    } catch (err) {
        return false;
    }
};

const fnGetRedisGamePubsubServer = () => global.peers.get().server;

const fnInitializeGamePubSubServerList = () => {
    try {
        const { hosts, port, mode } = constants.R_PUBSUB_GAME;
        global.peers = new Peers();

        hosts.forEach((host, index) => {
            global.peers.add({ server: index, weight: 1 });

            global.gamePublisher[index] = require('./connection')({ host, port, mode }, 9);
        });

    } catch (err) {
        logger.warn(err);
    }
};

module.exports = {
    fnRedisKeyExists,
    fnRedisKeyExpire,
    fnRedisKEYS,
    fnRedisTTL,
    fnRedisKeyDEL,
    fnRedisINCRBY,
    fnRedisINCRBYAtomic,

    fnRedisHSET,
    fnRedisHMSET,
    fnRedisHINCRBY,
    fnRedisHGET,
    fnRedisHDEL,
    fnRedisHGETALL,
    fnRedisHMGET,
    fnRedisHMSETEX,
    fnRedisHSETEX,
    fnRedisHINCRBYAtomic,

    fnRedisJSONSET,

    fnRedisGET,
    fnRedisSET,
    fnRedisSETEX,
    fnRedisSETNX,
    fnRedisSETEXNX,

    fnRedisSADD,
    fnRedisSMEMBERS,
    fnRedisSRANDMEMBER,
    fnRedisSMOVE,
    fnRedisSREM,
    fnRedisSCARD,
    fnRedisSISMEMBER,
    fnRedisSADDEX,
    fnRedisSPOP,

    fnRedisZADD,
    fnRedisZADDXX,
    fnRedisZADDMulti,
    fnRedisZADDEX,

    fnRedisZINCRBY,
    fnRedisZREM,
    fnRedisZREMMulti,
    fnRedisZCARD,
    fnRedisZCOUNT,
    fnRedisZRANK,
    fnRedisZREVRANK,
    fnRedisZSCORE,
    fnRedisZREVRANGE,
    fnRedisZRANGEBYSCORE,
    fnRedisZREVRANGEBYSCORE,
    fnRedisZREMRANGEBYRANK,
    fnRedisZREMRANGEBYSCORE,
    fnRedisZRANGE,
    fnRedisZMOVE,


    fnRedisLPUSH,
    fnRedisRPUSH,
    fnRedisLREM,
    fnRedisLRANGE,
    fnRedisLLEN,
    fnRedisLTRIM,



    fnMultiHandle,
    fnMultiResultReduce,
    fnMultiErrorReduce,

    fnPipelineHandle,
    fnPipelineResultReduce,
    fnPipelineErrorReduce,

    fnLockAcquire,
    fnLockRelease,

    fnGetAllShardKeys,
    fnScanAcrossShards,

    fnRedisPublish,
    fnGetRedisGamePubsubServer,
    fnInitializeGamePubSubServerList
};