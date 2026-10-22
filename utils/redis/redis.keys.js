"use strict";

const fnRedisUserKey = (_userId = "") => `{${_userId}}:user`; //User

const fnRedisGameKey = (gameId = "") => `{${gameId}}:game`; //Game room state (JSON blob)
const fnRedisPlayerActiveGameKey = (_userId = "") => `{${_userId}}:active_game`; //which gameId this player currently belongs to
const fnRedisOpenRoomsKey = (eRoomMode, maxPlayers, lobbyChips) => `open_rooms:${eRoomMode}:${maxPlayers}:${lobbyChips}`; //SET of gameIds still accepting players
const fnRedisWaitingExpiryKey = () => `waiting_rooms_expiry`; //ZSET gameId -> expiresAt, for the 30s matchmaking timeout sweep
const fnRedisActiveGameActivityKey = () => `active_games_activity`; //ZSET gameId -> lastActivityAt, for the abandoned-mid-game sweep
const fnRedisJoinLockKey = (_userId = "") => `{${_userId}}:join_lock`; //short-lived lock serializing one user's concurrent join attempts

module.exports = {
    fnRedisUserKey,
    fnRedisGameKey,
    fnRedisPlayerActiveGameKey,
    fnRedisOpenRoomsKey,
    fnRedisWaitingExpiryKey,
    fnRedisActiveGameActivityKey,
    fnRedisJoinLockKey
}