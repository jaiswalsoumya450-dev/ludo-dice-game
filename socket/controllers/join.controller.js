"use strict";

const gameServices = require("../../services/game.services");
const SOCKET_EVENTS = require("../socket.events");

const _fnClampMaxPlayers = (value) =>
  Math.min(4, Math.max(2, Number(value) || 2));

const _fnBroadcastRoom = (io, room) => {
  io.to(room.gameId).emit(SOCKET_EVENTS.room_update, gameServices.fnPublicRoomState(room));
};

const _fnHandleRoomExpired = (io) => (room) => {
  io.to(room.gameId).emit(SOCKET_EVENTS.room_cancelled, {
    message: "Not enough players joined in time.",
  });
};

const _fnJoinRoom = (io, socket, room) => {
  socket.join(room.gameId);
  socket._gameId = room.gameId;

  if (room.players.size >= room.maxPlayers) {
    gameServices.fnStartGame(room);
    io.to(room.gameId).emit(SOCKET_EVENTS.room_starting, gameServices.fnPublicGameState(room));
  } else {
    _fnBroadcastRoom(io, room);
  }
};

function fnJoinPublicGame(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  try {
    const maxPlayers = _fnClampMaxPlayers(data && data.maxPlayers);
    const lobbyChips = Number(data && data.lobbyChips) || 0;

    const room = gameServices.fnJoinPublicGame(
      {
        userId: socket._userId,
        sName: socket._sName,
        maxPlayers,
        lobbyChips,
      },
      _fnHandleRoomExpired(io),
    );

    _fnJoinRoom(io, socket, room);
    callback({ status: 200, ...gameServices.fnPublicRoomState(room) });
  } catch (err) {
    logger.warn("joinPublicGame error", err);
    callback({ status: 500, message: "Could not join a game. Try again." });
  }
}

function fnJoinPrivateGame(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  try {
    const maxPlayers = _fnClampMaxPlayers(data && data.maxPlayers);
    const lobbyChips = Number(data && data.lobbyChips) || 0;

    const room = gameServices.fnJoinPrivateGame(
      {
        userId: socket._userId,
        sName: socket._sName,
        maxPlayers,
        lobbyChips,
      },
      _fnHandleRoomExpired(io),
    );

    _fnJoinRoom(io, socket, room);
    callback({ status: 200, ...gameServices.fnPublicRoomState(room) });
  } catch (err) {
    logger.warn("joinPrivateGame error", err);
    callback({ status: 500, message: "Could not create a game. Try again." });
  }
}

function fnRejoinRoom(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = data && data.gameId;
  const room = gameId ? gameServices.fnGetRoom(gameId) : null;

  if (!room || !room.players.has(socket._userId)) {
    callback({ status: 404, message: "This game is no longer available." });
    return;
  }

  socket.join(room.gameId);
  socket._gameId = room.gameId;
  callback({ status: 200, ...gameServices.fnPublicRoomState(room) });
}

function fnLeaveRoom(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = (data && data.gameId) || socket._gameId;

  if (gameId) {
    const roomBeforeLeave = gameServices.fnGetRoom(gameId);
    const wasPlaying = roomBeforeLeave && roomBeforeLeave.status === "playing" && roomBeforeLeave.players.size === 2;

    const room = gameServices.fnRemovePlayer(gameId, socket._userId);
    socket.leave(gameId);

    if (room && wasPlaying) {
      gameServices.fnEndGameByForfeit(room, socket._userId);
      io.to(room.gameId).emit(SOCKET_EVENTS.dice_rolled, { roll: null, ...gameServices.fnPublicGameState(room) });
    } else if (room) {
      _fnBroadcastRoom(io, room);
    }
  }

  socket._gameId = null;
  callback({ status: 200 });
}

module.exports = { fnJoinPublicGame, fnJoinPrivateGame, fnRejoinRoom, fnLeaveRoom };
