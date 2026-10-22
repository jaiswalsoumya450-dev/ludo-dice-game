"use strict";

const client = require("../utils/redis/connections");
const {
  fnRedisGET,
  fnRedisSET,
  fnRedisKeyDEL,
  fnRedisCasSet,
  fnRedisSADD,
  fnRedisSREM,
  fnRedisSRANDMEMBER,
  fnRedisZADD,
  fnRedisZREM,
  fnRedisZRANGEBYSCORE,
  fnLockAcquire,
  fnLockRelease,
} = require("../utils/redis/redis.ops");
const {
  fnRedisGameKey,
  fnRedisPlayerActiveGameKey,
  fnRedisOpenRoomsKey,
  fnRedisWaitingExpiryKey,
  fnRedisActiveGameActivityKey,
  fnRedisJoinLockKey,
} = require("../utils/redis/redis.keys");
const { fnGetPlayerSchema } = require("../utils/redis/schema/player");
const walletServices = require("./wallet.services");

const WAITING_MS = 30000;
const ABANDONED_GAME_MS = 120000; // no activity in a "playing" game for this long -> treat as crashed/abandoned
const TARGET_SCORE = 100;
const ROOM_TTL_SECONDS = 60 * 60; // safety net so a room key can never live forever even if cleanup is missed

const fnGenerateGameId = () =>
  `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const _fnSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const _fnError = (message, status) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/* ------------------------------------------------------------------ *
 * Pure domain logic — no I/O. Every function here takes plain data
 * in and returns plain data out (or throws a domain error), so it's
 * trivial to unit test without touching Redis at all.
 * ------------------------------------------------------------------ */

function fnRollValue() {
  return 1 + Math.floor(Math.random() * 6);
}

function fnCreateRoomState({ gameId, eRoomMode, maxPlayers, lobbyChips, now = Date.now() }) {
  return {
    gameId,
    eRoomMode,
    maxPlayers,
    lobbyChips,
    status: "waiting",
    players: [],
    playerOrder: null,
    scores: null,
    turnIndex: null,
    target: null,
    winnerId: null,
    createdAt: now,
    expiresAt: now + WAITING_MS,
  };
}

function fnStartGamePure(room) {
  const playerOrder = room.players.map((p) => p.userId);
  const scores = {};
  playerOrder.forEach((userId) => {
    scores[userId] = 0;
  });
  return {
    ...room,
    status: "playing",
    playerOrder,
    scores,
    turnIndex: 0,
    target: TARGET_SCORE,
    winnerId: null,
  };
}

function fnAddPlayerPure(room, player) {
  if (room.status !== "waiting") {
    throw _fnError("This game has already started.", 400);
  }
  if (room.players.some((p) => p.userId === player.userId)) {
    return room; // already joined — idempotent no-op (handles duplicate join calls)
  }
  if (room.players.length >= room.maxPlayers) {
    throw _fnError("This game is already full.", 400);
  }

  const nextRoom = { ...room, players: [...room.players, player] };
  if (nextRoom.players.length >= nextRoom.maxPlayers) {
    return fnStartGamePure(nextRoom);
  }
  return nextRoom;
}

function fnRemovePlayerPure(room, userId) {
  return { ...room, players: room.players.filter((p) => p.userId !== userId) };
}

function fnRollDicePure(room, userId, rollValue) {
  if (room.status !== "playing") {
    throw _fnError("This game is not active.", 400);
  }
  if (room.playerOrder[room.turnIndex] !== userId) {
    throw _fnError("It's not your turn.", 400);
  }

  const nextScores = { ...room.scores };
  nextScores[userId] = Math.min(room.target, nextScores[userId] + rollValue);

  const nextRoom = { ...room, scores: nextScores };
  if (nextScores[userId] >= room.target) {
    nextRoom.status = "finished";
    nextRoom.winnerId = userId;
  } else {
    nextRoom.turnIndex = (room.turnIndex + 1) % room.playerOrder.length;
  }
  return nextRoom;
}

function fnForfeitPure(room, leavingUserId) {
  if (room.status !== "playing") return room;
  const winnerId = (room.playerOrder || []).find((id) => id !== leavingUserId) || null;
  return { ...room, status: "finished", winnerId };
}

function fnAbandonPure(room) {
  if (room.status !== "playing") return room;
  return { ...room, status: "finished", winnerId: null, abandoned: true };
}

function fnPublicRoomState(room) {
  return {
    gameId: room.gameId,
    eRoomMode: room.eRoomMode,
    maxPlayers: room.maxPlayers,
    roomStatus: room.status,
    expiresAt: room.expiresAt,
    players: room.players.map(({ userId, sName, sImage }) => ({ userId, sName, sImage })),
  };
}

function fnPublicGameState(room) {
  return {
    gameId: room.gameId,
    eRoomMode: room.eRoomMode,
    maxPlayers: room.maxPlayers,
    roomStatus: room.status,
    target: room.target,
    turnUserId: room.playerOrder ? room.playerOrder[room.turnIndex] : null,
    winnerId: room.winnerId || null,
    abandoned: !!room.abandoned,
    players: room.players.map(({ userId, sName, sImage }) => ({
      userId,
      sName,
      sImage,
      score: (room.scores && room.scores[userId]) || 0,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Redis-backed persistence. Room state lives in Redis (survives a
 * server restart/crash and is shared across every instance), keyed by
 * gameId. Every read-modify-write against an existing room goes
 * through _fnCasUpdateRoom, which uses the CAS primitive to guarantee
 * the mutation is atomic even with concurrent writers — e.g. two
 * players' sockets landing on different server instances can never
 * both apply their roll to the same stale copy of the room.
 * ------------------------------------------------------------------ */

async function fnGetRoom(gameId) {
  if (!gameId) return null;
  const raw = await fnRedisGET(client, fnRedisGameKey(gameId));
  return raw ? JSON.parse(raw) : null;
}

async function _fnCasUpdateRoom(gameId, mutateFn, { maxRetries = 8 } = {}) {
  const key = fnRedisGameKey(gameId);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const raw = await fnRedisGET(client, key);
    if (!raw) throw _fnError("This game is no longer available.", 404);

    const room = JSON.parse(raw);
    const nextRoom = mutateFn(room); // domain errors thrown here propagate immediately — no point retrying those
    const newRaw = JSON.stringify(nextRoom);

    const ok = await fnRedisCasSet(client, key, raw, newRaw, ROOM_TTL_SECONDS);
    if (ok) return { previousRoom: room, nextRoom };

    await _fnSleep(5 + Math.floor(Math.random() * 15)); // brief jitter before retrying against fresh state
  }
  throw _fnError("Could not update the game right now. Try again.", 409);
}

async function _fnSaveNewRoom(room) {
  await fnRedisSET(client, fnRedisGameKey(room.gameId), JSON.stringify(room));
}

async function _fnDeleteRoomFully(room) {
  await fnRedisKeyDEL(client, fnRedisGameKey(room.gameId));
  await fnRedisZREM(client, fnRedisWaitingExpiryKey(), room.gameId);
  await fnRedisZREM(client, fnRedisActiveGameActivityKey(), room.gameId);
  if (room.eRoomMode === "Public") {
    await fnRedisSREM(client, fnRedisOpenRoomsKey("Public", room.maxPlayers, room.lobbyChips), room.gameId);
  }
}

async function _fnSetPlayerActiveGame(userId, gameId) {
  await fnRedisSET(client, fnRedisPlayerActiveGameKey(userId), gameId);
}

async function _fnClearPlayerActiveGame(userId) {
  await fnRedisKeyDEL(client, fnRedisPlayerActiveGameKey(userId));
}

async function fnGetPlayerActiveGameId(userId) {
  return fnRedisGET(client, fnRedisPlayerActiveGameKey(userId));
}

function _fnNormalizePlayer({ userId, sName, sImage }) {
  const normalized = fnGetPlayerSchema({ _id: userId, sName, sImage });
  return { userId: normalized._id, sName: normalized.sName, sImage: normalized.sImage };
}

async function _fnFindExistingWaitingRoom(userId, eRoomMode) {
  const existingGameId = await fnGetPlayerActiveGameId(userId);
  if (!existingGameId) return null;
  const room = await fnGetRoom(existingGameId);
  if (room && room.status === "waiting" && room.eRoomMode === eRoomMode) return room;
  return null;
}

async function _fnWithJoinLock(userId, fn) {
  const lockKey = fnRedisJoinLockKey(userId);
  const acquired = await fnLockAcquire(client, lockKey, 5);
  if (!acquired) throw _fnError("Already processing your last request. Try again.", 429);
  try {
    return await fn();
  } finally {
    await fnLockRelease(client, lockKey);
  }
}

async function fnJoinPublicGame({ userId, sName, sImage, maxPlayers, lobbyChips }) {
  return _fnWithJoinLock(userId, async () => {
    const player = _fnNormalizePlayer({ userId, sName, sImage });

    const existingRoom = await _fnFindExistingWaitingRoom(userId, "Public");
    if (existingRoom) return existingRoom; // already paid & waiting — don't charge again

    if (lobbyChips > 0) {
      const balance = await walletServices.fnDebitChips(userId, lobbyChips);
      if (balance == null) throw _fnError("Not enough chips.", 400);
    }

    try {
      const openKey = fnRedisOpenRoomsKey("Public", maxPlayers, lobbyChips);

      for (let attempt = 0; attempt < 5; attempt++) {
        const candidateId = await fnRedisSRANDMEMBER(client, openKey);
        if (!candidateId) break;

        try {
          const { nextRoom } = await _fnCasUpdateRoom(candidateId, (room) => fnAddPlayerPure(room, player));
          if (nextRoom.players.length >= nextRoom.maxPlayers) {
            await fnRedisSREM(client, openKey, candidateId);
            await fnRedisZADD(client, fnRedisActiveGameActivityKey(), Date.now(), candidateId);
          }
          await _fnSetPlayerActiveGame(userId, candidateId);
          return nextRoom;
        } catch (err) {
          // candidate vanished / filled / already started between SRANDMEMBER and the CAS — drop it and retry another
          await fnRedisSREM(client, openKey, candidateId);
        }
      }

      const room = fnAddPlayerPure(
        fnCreateRoomState({ gameId: fnGenerateGameId(), eRoomMode: "Public", maxPlayers, lobbyChips }),
        player,
      );
      await _fnSaveNewRoom(room);
      await fnRedisZADD(client, fnRedisWaitingExpiryKey(), room.expiresAt, room.gameId);
      await fnRedisSADD(client, openKey, room.gameId);
      await _fnSetPlayerActiveGame(userId, room.gameId);
      return room;
    } catch (err) {
      if (lobbyChips > 0) await walletServices.fnCreditChips(userId, lobbyChips); // couldn't actually seat them — refund
      throw err;
    }
  });
}

async function fnJoinPrivateGame({ userId, sName, sImage, maxPlayers, lobbyChips }) {
  return _fnWithJoinLock(userId, async () => {
    const player = _fnNormalizePlayer({ userId, sName, sImage });

    const existingRoom = await _fnFindExistingWaitingRoom(userId, "Private");
    if (existingRoom) return existingRoom; // already paid & waiting — don't charge again

    if (lobbyChips > 0) {
      const balance = await walletServices.fnDebitChips(userId, lobbyChips);
      if (balance == null) throw _fnError("Not enough chips.", 400);
    }

    try {
      const room = fnAddPlayerPure(
        fnCreateRoomState({ gameId: fnGenerateGameId(), eRoomMode: "Private", maxPlayers, lobbyChips }),
        player,
      );
      await _fnSaveNewRoom(room);
      await fnRedisZADD(client, fnRedisWaitingExpiryKey(), room.expiresAt, room.gameId);
      await _fnSetPlayerActiveGame(userId, room.gameId);
      return room;
    } catch (err) {
      if (lobbyChips > 0) await walletServices.fnCreditChips(userId, lobbyChips);
      throw err;
    }
  });
}

async function fnRemovePlayer(gameId, userId) {
  if (!gameId) return null;

  let deletedRoomSnapshot = null;
  let nextRoom;
  try {
    ({ nextRoom } = await _fnCasUpdateRoom(gameId, (room) => {
      const updated = fnRemovePlayerPure(room, userId);
      if (updated.players.length === 0) deletedRoomSnapshot = updated;
      return updated;
    }));
  } catch (err) {
    await _fnClearPlayerActiveGame(userId);
    if (err.status === 404) return null;
    throw err;
  }

  await _fnClearPlayerActiveGame(userId);

  if (deletedRoomSnapshot) {
    await _fnDeleteRoomFully(deletedRoomSnapshot);
    return null;
  }

  // room was still "waiting" and dropped below capacity (e.g. filled then someone
  // left before the game formally started) — make sure it's listed as open again
  if (nextRoom.status === "waiting" && nextRoom.eRoomMode === "Public") {
    await fnRedisSADD(client, fnRedisOpenRoomsKey("Public", nextRoom.maxPlayers, nextRoom.lobbyChips), nextRoom.gameId);
  }

  return nextRoom;
}

async function fnRollDice(gameId, userId) {
  const roll = fnRollValue();
  const { previousRoom, nextRoom } = await _fnCasUpdateRoom(gameId, (room) => fnRollDicePure(room, userId, roll));

  if (nextRoom.status === "finished") {
    await fnRedisZREM(client, fnRedisActiveGameActivityKey(), gameId);
  } else {
    await fnRedisZADD(client, fnRedisActiveGameActivityKey(), Date.now(), gameId);
  }

  return { room: nextRoom, roll, justFinished: previousRoom.status === "playing" && nextRoom.status === "finished" };
}

async function fnEndGameByForfeit(gameId, leavingUserId) {
  const { previousRoom, nextRoom } = await _fnCasUpdateRoom(gameId, (room) => fnForfeitPure(room, leavingUserId));
  await fnRedisZREM(client, fnRedisActiveGameActivityKey(), gameId);
  return { room: nextRoom, justFinished: previousRoom.status === "playing" && nextRoom.status === "finished" };
}

/**
 * Sweeps rooms still stuck "waiting" past their matchmaking timeout.
 * Any server instance can run this; ZREM only succeeds for whichever
 * instance gets there first, so an expiry is only ever processed once
 * even with several instances sweeping in parallel.
 */
async function fnSweepExpiredWaitingRooms(onExpired) {
  const now = Date.now();
  const dueIds = await fnRedisZRANGEBYSCORE(client, fnRedisWaitingExpiryKey(), 0, now, 0, -1, false);
  for (const gameId of dueIds || []) {
    const claimed = await fnRedisZREM(client, fnRedisWaitingExpiryKey(), gameId);
    if (!claimed) continue;

    const room = await fnGetRoom(gameId);
    if (!room || room.status !== "waiting") continue;

    await _fnDeleteRoomFully(room);
    for (const p of room.players) await _fnClearPlayerActiveGame(p.userId);
    if (typeof onExpired === "function") await onExpired(room);
  }
}

/**
 * Sweeps "playing" games with no roll for ABANDONED_GAME_MS — the backstop
 * for a crash that takes out a whole server instance (and with it, any
 * in-memory per-socket disconnect timers) mid-game. Nobody wins; it's
 * reported as a draw so both players' stakes can be refunded.
 */
async function fnSweepAbandonedGames(onAbandoned) {
  const cutoff = Date.now() - ABANDONED_GAME_MS;
  const dueIds = await fnRedisZRANGEBYSCORE(client, fnRedisActiveGameActivityKey(), 0, cutoff, 0, -1, false);
  for (const gameId of dueIds || []) {
    const claimed = await fnRedisZREM(client, fnRedisActiveGameActivityKey(), gameId);
    if (!claimed) continue;

    let nextRoom;
    try {
      ({ nextRoom } = await _fnCasUpdateRoom(gameId, (room) => fnAbandonPure(room)));
    } catch (err) {
      continue; // room already gone/finished — nothing to do
    }
    if (nextRoom.status !== "finished" || !nextRoom.abandoned) continue;

    for (const p of nextRoom.players) await _fnClearPlayerActiveGame(p.userId);
    if (typeof onAbandoned === "function") await onAbandoned(nextRoom);
  }
}

module.exports = {
  WAITING_MS,
  TARGET_SCORE,
  ABANDONED_GAME_MS,

  // pure logic (unit-testable, no I/O)
  fnRollValue,
  fnCreateRoomState,
  fnStartGamePure,
  fnAddPlayerPure,
  fnRemovePlayerPure,
  fnRollDicePure,
  fnForfeitPure,
  fnAbandonPure,
  fnPublicRoomState,
  fnPublicGameState,

  // Redis-backed
  fnGetRoom,
  fnJoinPublicGame,
  fnJoinPrivateGame,
  fnRemovePlayer,
  fnRollDice,
  fnEndGameByForfeit,
  fnSweepExpiredWaitingRooms,
  fnSweepAbandonedGames,
};
