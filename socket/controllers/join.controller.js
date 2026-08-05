"use strict";

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

    gameServices.fnCheckOtherTable(redisUser);

    body = _.pick(body, ["maxPlayers", "lobbyChips"]);
    body.eGameType = "LUDO";
    body.eRoomMode = "Public";
    body.iMaxPlayer = Number(body.iMaxPlayer) || 2;
    body.iLobbyId = Number(body.iLobbyId) || 0;

    const lobbyData = gameServices.fnGetValidLobby({
      eGameType: body.eGameType,
      eRoomMode: body.eRoomMode,
      iLobbyId: body.iLobbyId,
    });

    if (lobbyData.iLobbyChips < 0) {
      throw {
        status: 412,
        message: "No player found, try again later!",
      };
    }

    body.iLobbyChips = lobbyData.iLobbyChips;
    body.nTotalChips = Number(redisUser.nTotalChips) || 0;
    body.nLevel = Number(redisUser.nLevel) || 1;

    if (body.iLobbyChips > body.nTotalChips) {
      throw {
        status: 400,
        message: "You do not have enough chips to join the game!",
        data: { nTotalChips: body.nTotalChips },
      };
    }

    body._userId = _userId;
    body.sName = redisUser.sName || "Player";
    body.sImage = redisUser.sImage || "0";
  } catch (err) {
    if (!err.status) {
      logger.warn("LUDO public room ERROR", err);
      const status = err.status || 404;
      const message = err.message || "something_went_wrong";
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

    // Check if user is already in another game
    gameServices.fnCheckOtherTable(redisUser);

    body = body._pick(body, ["maxPlayers", "iLobbyId", "vPrivateCode"]);

    body.eGameType = "LUDO";
    body.eRoomMode = "Private";
    body.nTotalChips = Number(redisUser.nTotalChips) || 0;
    body.sName = redisUser.sName || "Player";
    body._userId = _userId;
    body.sImage = redisUser.sImage || "0";
    body.ip = redisUser.ip || null;

    await gameServices.fnAddPlayerGameList({
      _userId,
    });
  } catch (err) {
    if (!err.status) {
      logger.warn("LUDO private room ERROR", err);
      const status = err.status || 404;
      const message = err.message || "something_went_wrong";
    }
  }
};
