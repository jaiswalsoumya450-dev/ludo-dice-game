"use strict";

const gameServices = require("../../services/game.services");
const walletServices = require("../../services/wallet.services");
const payoutServices = require("../../services/payout.services");
const SOCKET_EVENTS = require("../socket.events");

const _fnClampMaxPlayers = (value) =>
  Math.min(4, Math.max(2, Number(value) || 2));

const _fnBroadcastRoom = (io, room) => {
  io.to(room.gameId).emit(SOCKET_EVENTS.room_update, gameServices.fnPublicRoomState(room));
};

const _fnJoinRoom = (io, socket, room) => {
  socket.join(room.gameId);
  socket._gameId = room.gameId;

  if (room.status === "playing") {
    io.to(room.gameId).emit(SOCKET_EVENTS.room_starting, gameServices.fnPublicGameState(room));
  } else {
    _fnBroadcastRoom(io, room);
  }
};

async function fnJoinPublicGame(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  try {
    const maxPlayers = _fnClampMaxPlayers(data && data.maxPlayers);
    const lobbyChips = Number(data && data.lobbyChips) || 0;

    const room = await gameServices.fnJoinPublicGame({
      userId: socket._userId,
      sName: socket._sName,
      maxPlayers,
      lobbyChips,
    });

    _fnJoinRoom(io, socket, room);
    callback({ status: 200, ...gameServices.fnPublicRoomState(room) });
  } catch (err) {
    logger.warn("joinPublicGame error", err);
    callback({ status: err.status || 500, message: err.message || "Could not join a game. Try again." });
  }
}

async function fnJoinPrivateGame(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  try {
    const maxPlayers = _fnClampMaxPlayers(data && data.maxPlayers);
    const lobbyChips = Number(data && data.lobbyChips) || 0;

    const room = await gameServices.fnJoinPrivateGame({
      userId: socket._userId,
      sName: socket._sName,
      maxPlayers,
      lobbyChips,
    });

    _fnJoinRoom(io, socket, room);
    callback({ status: 200, ...gameServices.fnPublicRoomState(room) });
  } catch (err) {
    logger.warn("joinPrivateGame error", err);
    callback({ status: err.status || 500, message: err.message || "Could not create a game. Try again." });
  }
}

async function fnRejoinRoom(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = data && data.gameId;
  const room = gameId ? await gameServices.fnGetRoom(gameId) : null;

  if (!room || !room.players.some((p) => p.userId === socket._userId)) {
    callback({ status: 404, message: "This game is no longer available." });
    return;
  }

  socket.join(room.gameId);
  socket._gameId = room.gameId;
  callback({ status: 200, ...gameServices.fnPublicRoomState(room) });
}

async function fnLeaveRoom(io, socket, data, callback) {
  callback = typeof callback === "function" ? callback : () => {};
  const gameId = (data && data.gameId) || socket._gameId;

  if (gameId) {
    try {
      const roomBeforeLeave = await gameServices.fnGetRoom(gameId);

      if (roomBeforeLeave && roomBeforeLeave.status === "playing") {
        const { room, justFinished } = await gameServices.fnEndGameByForfeit(gameId, socket._userId);
        socket.leave(gameId);
        if (justFinished) await payoutServices.fnSettleGamePot(room);
        io.to(room.gameId).emit(SOCKET_EVENTS.dice_rolled, { roll: null, ...gameServices.fnPublicGameState(room) });
      } else {
        const room = await gameServices.fnRemovePlayer(gameId, socket._userId);
        socket.leave(gameId);
        if (roomBeforeLeave && roomBeforeLeave.status === "waiting" && roomBeforeLeave.lobbyChips > 0) {
          await walletServices.fnCreditChips(socket._userId, roomBeforeLeave.lobbyChips); // left before the game started — refund the stake
        }
        if (room) _fnBroadcastRoom(io, room);
      }
    } catch (err) {
      logger.warn("leaveRoom error", err);
    }
  }

  socket._gameId = null;
  callback({ status: 200 });
}

/**
 * Registers the periodic sweeps that reap rooms which never got their state
 * change pushed to them by a live socket event — a waiting room nobody
 * filled in time, or a "playing" game whose server instance (and with it,
 * any in-memory disconnect timers) died mid-match. Safe to call from every
 * server instance: game.services claims each due room via an atomic ZREM,
 * so only one instance ever actually processes a given expiry.
 */
function fnStartBackgroundSweeps(io) {
  const SWEEP_INTERVAL_MS = 3000;

  setInterval(() => {
    gameServices
      .fnSweepExpiredWaitingRooms(async (room) => {
        if (room.lobbyChips > 0) {
          await Promise.all(room.players.map((p) => walletServices.fnCreditChips(p.userId, room.lobbyChips)));
        }
        io.to(room.gameId).emit(SOCKET_EVENTS.room_cancelled, {
          message: "Not enough players joined in time.",
        });
      })
      .catch((err) => logger.warn("fnSweepExpiredWaitingRooms error", err));
  }, SWEEP_INTERVAL_MS);

  setInterval(() => {
    gameServices
      .fnSweepAbandonedGames(async (room) => {
        await payoutServices.fnSettleGamePot(room);
        io.to(room.gameId).emit(SOCKET_EVENTS.dice_rolled, { roll: null, ...gameServices.fnPublicGameState(room) });
      })
      .catch((err) => logger.warn("fnSweepAbandonedGames error", err));
  }, SWEEP_INTERVAL_MS);
}

module.exports = { fnJoinPublicGame, fnJoinPrivateGame, fnRejoinRoom, fnLeaveRoom, fnStartBackgroundSweeps };
