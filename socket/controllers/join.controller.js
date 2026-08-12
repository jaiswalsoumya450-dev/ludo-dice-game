"use strict";
import { redisOps, redisClientUser, redisKeys } from "../utils/redis";

const redisKeys = require("./socket/utils/redis");

const SOCKET_EVENTS = require("./socket.events");

const fnLudoPublic = async (socket, body) => {
  try {
    const _userId = socket._userId || "";
    const redisUser = await redisOps.fnRedisHGETALL(
      redisClientUser,
      redisKeys.fnRedisUserKey(_userId),
    );

    if (!redisUser)
      throw {
        status: 401,
        message: "restart_app",
      };

    body = _.pick(body, ["maxPlayers", "lobbyChips"]);
    body.eGameType = "LUDO";
    body.eRoomMode = "Public";
    body.maxPlayers = Number(body.maxPlayers) || 2;
    body._userId = _userId;
    body.sName = redisUser.sName || "Player";
    body.sImage = redisUser.sImage || "0";

    if (body.lobbyChips > (Number(redisUser.nTotalChips) || 0)) {
      throw {
        status: 400,
        message: "You do not have enough chips to join the game!",
      };
    }

    // Initialize game variables
    // New game set by default
    let newGame = true;
    let waitingTimer;
    let gamePlayers = Object.create(null);
    let redisGameKey;
    let redisGamePlayerKey;
    let gameData;

    // will have unique attributes a game has
    const keyWaitingGame = redisKeys.fnKeyWaitingGame({
      eGameType: body.eGameType,
      eRoomMode: body.eRoomMode,
      iMaxPlayer: body.maxPlayers,
      lobbyChips: body.lobbyChips,
    });

    let _gameId = await redisOps.fnRedisSRANDMEMBER(
      redisClientUser,
      keyWaitingGame,
    );

    //if we find an existing game, try and join
    if (_gameId) {
      redisGameKey = redisKeys.fnRedisGameKey(_gameId);

      try {
        gameData = await redisOps.fnRedisHGETALL(redisClientUser, redisGameKey);
        if (!gameData || !gameData._id) {
          redisOps.fnRedisSREM(redisClientUser, keyWaitingGame, _gameId);
          throw "invalid_game";
        }

        body.maxPlayers = Number(gameData.iMaxPlayer);
        gameData.iTotalPlayer = Number(gameData.iTotalPlayer);

        redisGamePlayerKey = redisKeys.fnRedisGamePlayerKey(_gameId);
        gamePlayers =
          (await redisOps.fnRedisHGETALL(
            redisClientUser,
            redisGamePlayerKey,
          )) || Object.create(null);

        //if player is not already in the game, add them to the game
        if (!gamePlayers[_userId]) {
          if (gameData.iTotalPlayer >= body.iMaxPlayer) throw "game_full";

          let result = await redisOps.fnRedisHINCRBYAtomic(
            redisClientUser,
            redisGameKey,
            "iTotalPlayer",
            1,
          );
          gameData.iTotalPlayer = Number(result[0]) || 0;

          // Handle race condition
          if (gameData.iTotalPlayer > body.iMaxPlayer) {
            redisOps.fnRedisHSET(
              redisClientUser,
              redisGameKey,
              "iTotalPlayer",
              body.iMaxPlayer,
            );
            throw "race_condition";
          }
        }
        redisClientUser.quit();
        newGame = false;
      } catch (err) {
        redisClientUser.quit();
        gamePlayers = Object.create(null);
      }
    }

    //create a new game if needed
    if (newGame) {
      waitingTimer = setTimeout(currentGame, 30000);
      gameData = await gameServices.fnRedisSaveNewGame({
        body,
        waitingTimer,
      });

      _gameId = gameData._id;
      redisGamePlayerKey = redisKeys.fnRedisGamePlayerKey(_gameId);
    } else {
      waitingTimer = setTimeout(currentGame, 30000);
    }

    //handle new vs existing game
    if (newGame) {
      const currentGame = gameServices.fnCreateNewGameObject(gameData);
      setTimeout(currentGame, 30000);

      // Add to waiting games
      redisOps.fnRedisSADD(
        redisClientGameSA,
        keyWaitingGame,
        _gameId.toString(),
      );

      // Initialize game
      setTimeout(
        () =>
          socket.emit(
            SOCKET_EVENTS.gameInit,
            aes.fnEncrypt(redisSchemaGame.fnGetGameWaitingSchema(gameData)),
          ),
        100,
      );
    } else if (gameData.iTotalPlayer == body.iMaxPlayer) {
      // game full - start game
      const waitingGameRemoved =
        await gameServices.fnRedisRemoveWaitingGame(gameData);

      setTimeout(() => {
        gameServices.fnPublishEvent({
          PS: gameData.PS,
          channel: gameData._id,
          e: SOCKET_EVENTS.gameInit,
          d: redisSchemaGame.fnGetGameWaitingSchema(gameData),
        });

        const currentGame = gameServices.fnCreateNewGameObject(gameData);
        return currentGame.roundInitialize(
          constants.ROUND_INIT_TIMEOUT,
          true,
          waitingGameRemoved,
        );
      }, 100);
    } else {
      // Waiting for more players
      setTimeout(
        () =>
          gameServices.fnPublishEvent({
            PS: gameData.PS,
            channel: gameData._id,
            e: SOCKET_EVENTS.gameInit,
            d: redisSchemaGame.fnGetGameWaitingSchema(gameData),
          }),
        100,
      );
    }

    // Return success response
    const output = {
      status: 200,
      _gameId,
      waitingTimer,
    };
  } catch (err) {
    if (!err.status) {
      logger.warn("LUDO public room ERROR", err);
      const status = err.status || 404;
      const message = err.message || "something_went_wrong";
      throw cb(aes.fnEncrypt({ status, message, ...(err.data || {}) }));
    }
  }
};

const fnLudoPrivate = async (socket, body) => {
  try {
    const _userId = socket._userId || "";

    // Get user data from redis
    const redisUser = await redisOps.fnRedisHGETALL(
      redisClientUser,
      redisKeys.fnRedisUserKey(_userId),
    );

    // Validate user exists and is not blocked
    if (!redisUser) throw { status: 401, message: "restart_app" };

    body = body._pick(body, ["maxPlayers", "lobbyId", "vPrivateCode"]);

    body.eGameType = "LUDO";
    body.eRoomMode = "Private";
    body.sName = redisUser.sName || "Player";
    body._userId = _userId;
    body.sImage = redisUser.sImage || "0";
    body.ip = redisUser.ip || null;
    const maxPlayers = body.maxPlayers;

    if (body.lobbyChips > (Number(redisUser.nTotalChips) || 0)) {
      throw {
        status: 400,
        message: "You do not have enough chips to join the game!",
      };
    }

    await gameServices.fnAddPlayerGameList({
      _userId,
      maxPlayers,
    });
  } catch (err) {
    if (!err.status) {
      logger.warn("LUDO private room ERROR", err);
      const status = err.status || 404;
      const message = err.message || "something_went_wrong";
    }
  }
};

module.exports = {fnLudoPublic, fnLudoPrivate}