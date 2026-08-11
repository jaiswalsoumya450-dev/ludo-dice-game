"use strict";

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
    renderRoom(game, { starting: true });
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

    $("#room-code").text(String(state.roomCode || "").split("").join(" "));

    const maxPlayers = Number(state.maxPlayers) || 2;
    const players = state.players || [];
    const slots = [];
    for (let i = 0; i < maxPlayers; i++) slots.push(players[i] || null);

    const perRow = maxPlayers > 2 ? 2 : 1;
    const totalRows = Math.ceil(maxPlayers / perRow);

    const $wrap = $("#players-wrap").empty();
    for (let r = 0; r < totalRows; r++) {
      const rowSlots = slots.slice(r * perRow, r * perRow + perRow);
      const $row = $('<div class="flex gap-4 justify-center"></div>');
      rowSlots.forEach(function (player) {
        $row.append(buildSlotCard(player));
      });
      $wrap.append($row);
      if (r === 0) $wrap.append(buildTimerPill());
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
    const name = filled ? player.sName || "Player" : "…";
    return $(
      '<div class="relative w-40 sm:w-48 aspect-[4/5] rounded-2xl border-4 border-yellow-400 overflow-hidden shadow-lg player-slot flex-shrink-0">' +
        '<div class="w-full h-full flex items-center justify-center">' +
          '<svg class="w-16 h-16 sm:w-20 sm:h-20 text-slate-400/70" fill="currentColor" viewBox="0 0 24 24">' +
            '<path d="M12 12a5 5 0 100-10 5 5 0 000 10zM4 22a8 8 0 1116 0H4z"/>' +
          "</svg>" +
        "</div>" +
        '<div class="absolute bottom-0 inset-x-0 bg-[#0d1e4d]/90 text-center py-2 px-2">' +
          '<span class="text-white text-sm font-semibold block truncate' + (filled ? "" : " pulse-dot") + '"></span>' +
        "</div>" +
      "</div>",
    ).find("span").text(name).end();
  }

  function buildTimerPill() {
    return $(
      '<div class="flex items-center justify-center gap-2 bg-[#0d1e4d] border-2 border-yellow-400 rounded-full px-5 py-2 text-yellow-300 font-bold text-lg self-center">' +
        '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<circle cx="12" cy="12" r="9" stroke-width="2"/>' +
          '<path stroke-linecap="round" stroke-width="2" d="M12 7v5l3 3"/>' +
        "</svg>" +
        '<span class="timer-text">--:--</span>' +
      "</div>",
    );
  }

  function startCountdown(expiresAt) {
    clearInterval(countdownInterval);
    function tick() {
      const remaining = Math.max(0, expiresAt - Date.now());
      const totalSec = Math.ceil(remaining / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");
      $(".timer-text").text(`${mm}:${ss}`);
      if (remaining <= 0) clearInterval(countdownInterval);
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
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
