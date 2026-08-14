"use strict";

const gameServices = require("../../services/game.services");
const SOCKET_EVENTS = require("../socket.events");

function fnRejoinGame(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = (data && data.gameId) || socket._gameId;
  const room = gameId ? gameServices.fnGetRoom(gameId) : null;

  if (!room || !room.players.has(socket._userId)) {
    callback({ status: 404, message: "This game is no longer available." });
    return;
  }

  socket.join(room.gameId);
  socket._gameId = room.gameId;
  callback({ status: 200, ...gameServices.fnPublicGameState(room) });
}

function fnRollDice(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = (data && data.gameId) || socket._gameId;
  const room = gameId ? gameServices.fnGetRoom(gameId) : null;

  if (!room) {
    callback({ status: 404, message: "This game is no longer available." });
    return;
  }

  try {
    const { roll } = gameServices.fnRollDice(room, socket._userId);
    const state = gameServices.fnPublicGameState(room);
    io.to(room.gameId).emit(SOCKET_EVENTS.dice_rolled, { roll, ...state });
    callback({ status: 200, roll, ...state });
  } catch (err) {
    callback({ status: err.status || 400, message: err.message || "Could not roll." });
  }
}

module.exports = { fnRejoinGame, fnRollDice };
