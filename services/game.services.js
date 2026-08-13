"use strict";

// Minimal in-memory matchmaking rooms. Single-process only — good enough
// until real game state needs to survive a server restart / run across
// multiple instances.

const WAITING_MS = 30000;

const rooms = new Map(); // gameId -> room

const fnGenerateGameId = () =>
  `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const fnPublicRoomState = (room) => ({
  gameId: room.gameId,
  eRoomMode: room.eRoomMode,
  maxPlayers: room.maxPlayers,
  roomStatus: room.status,
  expiresAt: room.expiresAt,
  players: Array.from(room.players.values()).map(
    ({ userId, sName, sImage }) => ({ userId, sName, sImage }),
  ),
});

const fnGetRoom = (gameId) => rooms.get(gameId) || null;

const fnDeleteRoom = (gameId) => rooms.delete(gameId);

function fnFindOpenPublicRoom(maxPlayers, lobbyChips) {
  for (const room of rooms.values()) {
    if (
      room.eRoomMode === "Public" &&
      room.status === "waiting" &&
      room.maxPlayers === maxPlayers &&
      room.lobbyChips === lobbyChips &&
      room.players.size < room.maxPlayers
    ) {
      return room;
    }
  }
  return null;
}

function fnFindPlayerWaitingRoom(eRoomMode, userId) {
  for (const room of rooms.values()) {
    if (
      room.eRoomMode === eRoomMode &&
      room.status === "waiting" &&
      room.players.has(userId)
    ) {
      return room;
    }
  }
  return null;
}

function fnCreateRoom({ eRoomMode, maxPlayers, lobbyChips }, onExpire) {
  const room = {
    gameId: fnGenerateGameId(),
    eRoomMode,
    maxPlayers,
    lobbyChips,
    status: "waiting",
    players: new Map(),
    expiresAt: Date.now() + WAITING_MS,
    timer: null,
  };
  rooms.set(room.gameId, room);

  if (typeof onExpire === "function") {
    room.timer = setTimeout(() => {
      if (room.status !== "waiting") return;
      rooms.delete(room.gameId);
      onExpire(room);
    }, WAITING_MS);
  }

  return room;
}

function fnClearRoomTimer(room) {
  if (room && room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function fnAddPlayer(room, { userId, sName, sImage }) {
  room.players.set(userId, {
    userId,
    sName: sName || "Player",
    sImage: sImage || "0",
  });
  return room;
}

function fnRemovePlayer(gameId, userId) {
  const room = rooms.get(gameId);
  if (!room) return null;
  room.players.delete(userId);
  if (room.players.size === 0) {
    rooms.delete(gameId);
    return null;
  }
  return room;
}

function fnJoinPublicGame({ userId, sName, sImage, maxPlayers, lobbyChips }) {
  let room = fnFindPlayerWaitingRoom("Public", userId);
  if (!room) room = fnFindOpenPublicRoom(maxPlayers, lobbyChips);
  if (!room) room = fnCreateRoom({ eRoomMode: "Public", maxPlayers, lobbyChips });
  return fnAddPlayer(room, { userId, sName, sImage });
}

function fnJoinPrivateGame({ userId, sName, sImage, maxPlayers, lobbyChips }) {
  const room =
    fnFindPlayerWaitingRoom("Private", userId) ||
    fnCreateRoom({ eRoomMode: "Private", maxPlayers, lobbyChips });
  return fnAddPlayer(room, { userId, sName, sImage });
}

module.exports = {
  WAITING_MS,
  fnJoinPublicGame,
  fnJoinPrivateGame,
  fnRemovePlayer,
  fnGetRoom,
  fnDeleteRoom,
  fnPublicRoomState,
};
