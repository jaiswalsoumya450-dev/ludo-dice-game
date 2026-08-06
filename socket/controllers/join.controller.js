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

    body = _.pick(body, ["maxPlayers", "lobbyChips"]);
    body.eGameType = "LUDO";
    body.eRoomMode = "Public";
    body.maxPlayer = Number(body.maxPlayer) || 2;
    body._userId = _userId;
    body.sName = redisUser.sName || "Player";
    body.sImage = redisUser.sImage || "0";

    if (body.lobbyChips > (Number(redisUser.nTotalChips) || 0)) {
      throw {
        status: 400,
        message: "You do not have enough chips to join the game!",
      };
    }
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
