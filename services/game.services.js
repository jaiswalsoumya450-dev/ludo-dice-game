"use strict";

const fnCreateNewGameObject = (data = {}) => new table(data);

const fnAddPlayerGameList = async ({ _userId, maxPlayers }) => {
  try {
    const result =
      maxPlayers > 1
        ? await redisOps.fnRedisHSET(_userId)
        : await redisOps.fnRedisHSETEX(_userId);

    if (!result) {
      const verifyResult = await redisOps.fnRedisHSETEX(_userId);
      if (!verifyResult) throw "could_not_set_player";
      return verifyResult;
    }

    redisOps.fnRedisHSET(redisKeys.fnRedisUserKey(_userId));
    return result;
  } catch (err) {
    throw err;
  }
};

const fnGameUniqueId = async () => {
    try {
        let retryCount = 0;
        const maxRetries = 5;

        // Keep trying until we find a unique ID or hit max retries
        while (retryCount <= maxRetries) {
            // Generate new ObjectId
            const _tableId = new ObjectId();

            // Check if ID already exists in Redis
            const keyExists = await redisOps.fnRedisKeyExists(
                redisClientGame,
                redisKeys.fnRedisTableKey(_tableId)
            );

            // If ID doesn't exist, we found a unique one
            if (!keyExists) {
                return _tableId.toString();
            }

            retryCount++;
        }

        throw "retry_count_reached";
    }
    catch (err) {
        throw err;
    }
};

const fnRedisSaveNewGame = async ({
    body,
    waitingTimer = 40000
}) => {
    try {
        const _gameId = await fnGameUniqueId();
        let gameData = {
            _id: _gameId,
            eGameType: body.eGameType,
            eRoomMode: body.eRoomMode,
            maxPlayers: body.iMaxPlayer,
            iLobbyId: body.iLobbyId,
            lobbyChips: body.iLobbyChips,
        };

        if (body.sName) gameData.sOwnerName = body.sName;

        const expireAt = waitingTimer / 1000 + 15;

        gameData = redisSchemaGame.fnSetGameSchema(gameData, true);

        await redisOps.fnRedisHMSETEX(redisClientGame, redisKeys.fnRedisTableKey(_gameId), gameData, expireAt);

        if (!body._tmntId) redisOps.fnRedisSADD(redisClientGameSA, redisKeys.fnSETGamesWaitingPI(gameData.PI), _gameId.toString()).catch(helper.cbe);

        return gameData;

    } catch (err) {
        throw err;
    }
};

const fnRedisRemoveWaitingGame = async (gameData = {}) => {
  try {
    redisOps
      .fnRedisSREM(
        redisClientGameSA,
        redisKeys.fnSETGamesWaitingPI(gameData.PI),
        gameData._id,
      )
      .catch(helper.cbe);

    let result;
    let keyWaitingGame = redisKeys.fnKeyWaitingGame(gameData);
    if (gameData.vPrivateCode) {
      result = await redisOps.fnRedisKeyDEL(redisClientGameSA, keyWaitingGame);
    } else {
      result = await redisOps.fnRedisSREM(
        redisClientGameSA,
        keyWaitingGame,
        gameData._id,
      );
      const nBucket =
        typeof gameData.nBucket != "undefined" ? Number(gameData.nBucket) : -1;
      if (nBucket >= 0 && !result) {
        gameData.nBucket = -1;
        keyWaitingGame = redisKeys.fnKeyWaitingGame(gameData);
        result = await redisOps.fnRedisSREM(
          redisClientGameSA,
          keyWaitingGame,
          gameData._id,
        );
      }
    }
    return result;
  } catch (err) {
    logger.warn(err);
  }
  return;
};

const fnPublishEvent = ({ PS, channel, e, d, x }) => {
    try {
        redisOps.fnRedisPublish(`socket.io#/#${channel}#`, { e, d: aes.fnEncrypt(d), x }, global.gamePublisher[PS]);
    } catch (err) {
        logger.warn(err);
    }
};
