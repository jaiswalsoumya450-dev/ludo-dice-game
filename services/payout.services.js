"use strict";

const walletServices = require("./wallet.services");

/**
 * Settles the chip pot for a finished game room. Winner takes everyone's
 * stake; if there's no winner (a mid-game draw from the abandoned-game
 * sweep), every player's stake is refunded instead. `justFinished` in
 * game.services' return values guarantees a room's "playing" -> "finished"
 * transition is only ever observed once, so callers can call this
 * unconditionally on that transition without risking a double payout.
 */
async function fnSettleGamePot(room) {
  if (!room || room.status !== "finished") return;
  const lobbyChips = room.lobbyChips || 0;
  if (!lobbyChips) return;

  if (room.winnerId) {
    const pot = lobbyChips * room.players.length;
    await walletServices.fnCreditChips(room.winnerId, pot);
  } else {
    await Promise.all(room.players.map((p) => walletServices.fnCreditChips(p.userId, lobbyChips)));
  }
}

module.exports = { fnSettleGamePot };
