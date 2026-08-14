"use strict";

const { room_update } = require("../../socket/socket.events");

$(document).ready(function () {
  const token = localStorage.getItem("token");
  const _id = localStorage.getItem("_id");

  if (!token || !_id) {
    window.location.href = "/web/login";
    return;
  }

  let game = _fnReadActiveGame();
  if (!game) {
    window.location.href = "/web/main";
    return;
  }

  // the room can already be full/playing by the time this page loads (the
  // player whose join filled the room isn't listening for "roomStarting"
  // yet — they're still on /web/main when it fires), so check up front too.
  if (_fnMaybeGoToGameplay(game)) return;

  const socket = io({ path: `/${CODE_VERSION}/socket.io`, auth: { token } });

  let countdownInterval = null;

  // render immediately from the cached join response to avoid a flash of emptiness
  renderRoom(game);

  socket.on("connect", function () {
    socket.emit("rejoinRoom", { gameId: game.gameId }, function (response) {
      if (!response || response.status !== 200) {
        _fnLeaveToMain("This game is no longer available.");
        return;
      }
      game = response;
      localStorage.setItem("activeGame", JSON.stringify(game));
      if (_fnMaybeGoToGameplay(game)) return;
      renderRoom(game);
    });
  });

  socket.on("roomUpdate", function (state) {
    game = state;
    localStorage.setItem("activeGame", JSON.stringify(game));
    renderRoom(game);
  });

  socket.on("roomStarting", function (state) {
    game = state;
    localStorage.setItem("activeGame", JSON.stringify(game));
    renderRoom(game, { starting: true });
    setTimeout(function () {
      window.location.href = "/web/gameplay";
    }, 1200);
  });

  socket.on("roomCancelled", function (payload) {
    _fnLeaveToMain((payload && payload.message) || "Not enough players joined in time.");
  });

  $("#leave-btn").on("click", function () {
    socket.emit("leaveRoom", { gameId: game.gameId }, function () {
      localStorage.removeItem("activeGame");
      window.location.href = "/web/main";
    });
  });

  //reroute back to main if enough players didnt join
  function _fnLeaveToMain(message) {
    clearInterval(countdownInterval);
    $("#room-status-msg").removeClass("hidden").text(message);
    localStorage.removeItem("activeGame");
    setTimeout(function () {
      window.location.href = "/web/main";
    }, 2000);
  }

  function renderRoom(state, opts) {
    opts = opts || {};

    const maxPlayers = Number(state.maxPlayers) || 2;
    const players = state.players || [];

    const $wrap = $("#players-wrap")
      .toggleClass("grid-cols-2", maxPlayers > 2)
      .toggleClass("grid-cols-1", maxPlayers <= 2)
      .empty();

    for (let i = 0; i < maxPlayers; i++) {
      $wrap.append(buildSlotCard(players[i] || null));
    }

    if (opts.starting) {
      clearInterval(countdownInterval);
      $("#room-status-msg").removeClass("hidden").text("All players joined! Starting...");
    } else {
      $("#room-status-msg").addClass("hidden").text("");
      if (state.expiresAt) startCountdown(state.expiresAt);
    }
  }

  function buildSlotCard(player) {
    const filled = !!player;
    const $card = $(
      '<div class="relative w-40 sm:w-48 aspect-[4/5] rounded-2xl border-4 border-yellow-400 overflow-hidden shadow-lg player-slot">' +
        '<div class="w-full h-full flex items-center justify-center">' +
          '<svg class="w-16 h-16 sm:w-20 sm:h-20 text-slate-400/70" fill="currentColor" viewBox="0 0 24 24">' +
            '<path d="M12 12a5 5 0 100-10 5 5 0 000 10zM4 22a8 8 0 1116 0H4z"/>' +
          "</svg>" +
        "</div>" +
        '<div class="absolute bottom-0 inset-x-0 bg-[#0d1e4d]/90 text-center py-2 px-2">' +
          '<span class="text-white text-sm font-semibold block truncate"></span>' +
        "</div>" +
      "</div>",
    );
    $card
      .find("span")
      .text(filled ? player.sName || "Player" : "…")
      .toggleClass("pulse-dot", !filled);
    return $card;
  }

  function startCountdown(expiresAt) {
    clearInterval(countdownInterval);
    function tick() {
      const remaining = Math.max(0, expiresAt - Date.now());
      const totalSec = Math.ceil(remaining / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");
      $("#timer-text").text(`${mm}:${ss}`);
      if (remaining <= 0) clearInterval(countdownInterval);
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function _fnMaybeGoToGameplay(state) {
    if (state && (state.roomStatus === "playing" || state.roomStatus === "finished")) {
      localStorage.setItem("activeGame", JSON.stringify(state));
      window.location.href = "/web/gameplay";
      return true;
    }
    return false;
  }

  function _fnReadActiveGame() {
    const raw = localStorage.getItem("activeGame");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      localStorage.removeItem("activeGame");
      return null;
    }
  }
});
