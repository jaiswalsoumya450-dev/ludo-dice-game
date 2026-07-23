"use strict";

const fnRedisUserKey = (_userId = "") => `{${_userId}}:user`; //User

module.exports = {
    fnRedisUserKey
}