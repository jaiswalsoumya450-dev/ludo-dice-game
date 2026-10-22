"use strict";

const gameServices = require("../../services/game.services");
const payoutServices = require("../../services/payout.services");
const SOCKET_EVENTS = require("../socket.events");

async function fnRejoinGame(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = (data && data.gameId) || socket._gameId;
  const room = gameId ? await gameServices.fnGetRoom(gameId) : null;

  if (!room || !room.players.some((p) => p.userId === socket._userId)) {
    callback({ status: 404, message: "This game is no longer available." });
    return;
  }

  socket.join(room.gameId);
  socket._gameId = room.gameId;
  callback({ status: 200, ...gameServices.fnPublicGameState(room) });
}

async function fnRollDice(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = (data && data.gameId) || socket._gameId;

  if (!gameId) {
    callback({ status: 404, message: "This game is no longer available." });
    return;
  }

  try {
    const { roll, room, justFinished } = await gameServices.fnRollDice(gameId, socket._userId);
    if (justFinished) await payoutServices.fnSettleGamePot(room);

    const state = gameServices.fnPublicGameState(room);
    io.to(room.gameId).emit(SOCKET_EVENTS.dice_rolled, { roll, ...state });
    callback({ status: 200, roll, ...state });
  } catch (err) {
    callback({ status: err.status || 400, message: err.message || "Could not roll." });
  }
}

module.exports = { fnRejoinGame, fnRollDice };
