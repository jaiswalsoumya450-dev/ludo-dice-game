"use strict";
import { redisOps, redisClientUser, redisKeys } from '../utils/redis.utils.js';
import { gameServices } from '../services/game.services.js';
import { logger } from '../utils/logger.utils.js';
import { constants } from '../config/constants.js';
import jwt from 'jsonwebtoken';

async function fnJoinGame(socket, data) {
    try {
        const _userId = socket._userId || "";
        // Get user data from redis
        const redisUser = await redisOps.fnRedisHGETALL(redisClientUser, redisKeys.fnRedisUserKey(_userId));

        if (!redisUser || !redisUser.userId) {
            logger.error(`User not found in Redis: userId=${_userId}`);
            socket.emit("error", { message: "User not found" });
            return;
        }

    } catch (err) {
        logger.error("Error occurred while joining game", err);
        socket.emit("error", { message: "An error occurred" });
    }

    if (!redisUser || !redisUser.userId) {
        logger.error("User not found in Redis: user id - ", _userId);
        socket.emit("error", { message: "User not found" });
        return;
    }

    // Get lobby data and validate chips
        const lobbyData = gameServices.fnGetValidLobby({
            kPass: redisUser.kPass,
            eGameType: body.eGameType,
            eRoomMode: body.eRoomMode,
            lobbyId: body.lobbyId
        });

    if(lobbyData.lobbyChips < 0) {
        throw new Error("Invalid lobby chips");
    }
}