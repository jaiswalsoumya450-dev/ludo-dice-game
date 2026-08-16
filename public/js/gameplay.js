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

  let rolling = false;
  let spinInterval = null;

  const PIP_LAYOUT = {
    0: [5],
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  // render immediately from the cached room-starting payload to avoid a flash of emptiness
  renderDicePips(0);
  renderGame(game);

  socket.on("connect", function () {
    socket.emit("rejoinGame", { gameId: game.gameId }, function (response) {
      if (!response || response.status !== 200) {
        _fnLeaveToMain("This game is no longer available.");
        return;
      }
      game = response;
      localStorage.setItem("activeGame", JSON.stringify(game));
      renderGame(game);
    });
  });

  socket.on("diceRolled", function (state) {
    game = state;
    localStorage.setItem("activeGame", JSON.stringify(game));
    animateRoll(state.roll, function () {
      renderGame(game);
    });
  });

  socket.on("roomCancelled", function (payload) {
    _fnLeaveToMain((payload && payload.message) || "The game has ended.");
  });

  $("#dice-btn").on("click", function () {
    if (rolling) return;
    if (game.roomStatus !== "playing") return;
    if (game.turnUserId !== _id) return;

    rolling = true;
    $("#dice-hint").text("Rolling...");
    startSpin(); // spin immediately so the tap feels instant; the broadcast below settles it on the real value
    socket.emit("rollDice", { gameId: game.gameId }, function (response) {
      if (!response || response.status !== 200) {
        rolling = false;
        stopSpin();
        renderDicePips(0);
        $("#dice-hint").text((response && response.message) || "Could not roll. Try again.");
      }
      // on success, the "diceRolled" broadcast drives the settle animation + render
    });
  });

  $("#leave-btn, #back-to-main-btn").on("click", function () {
    socket.emit("leaveRoom", { gameId: game.gameId }, function () {
      localStorage.removeItem("activeGame");
      window.location.href = "/web/main";
    });
  });

  $("#help-btn").on("click", function () {
    $("#help-popover").toggleClass("hidden");
  });

  function _fnLeaveToMain(message) {
    $("#dice-hint").text(message);
    localStorage.removeItem("activeGame");
    setTimeout(function () {
      window.location.href = "/web/main";
    }, 2000);
  }

  function renderDicePips(value) {
    const active = PIP_LAYOUT[value] || PIP_LAYOUT[0];
    const $pips = $("#dice-pips").empty();
    for (let i = 1; i <= 9; i++) {
      $pips.append('<div class="pip w-3.5 h-3.5 sm:w-4 sm:h-4' + (active.includes(i) ? " on" : "") + '"></div>');
    }
  }

  function startSpin() {
    stopSpin();
    spinInterval = setInterval(function () {
      renderDicePips(1 + Math.floor(Math.random() * 6));
    }, 80);
  }

  function stopSpin() {
    if (spinInterval) {
      clearInterval(spinInterval);
      spinInterval = null;
    }
  }

  function animateRoll(finalValue, done) {
    rolling = true;
    stopSpin();
    $("#dice-hint").text("Rolling...");
    let ticks = 0;
    const maxTicks = 6;
    const interval = setInterval(function () {
      renderDicePips(1 + Math.floor(Math.random() * 6));
      ticks++;
      if (ticks >= maxTicks) {
        clearInterval(interval);
        renderDicePips(finalValue || 0);
        rolling = false;
        if (done) done();
      }
    }, 80);
  }

  function renderGame(state) {
    const players = state.players || [];
    const isOver = state.roomStatus === "finished";

    const $wrap = $("#players-wrap").empty();
    players.forEach(function (player) {
      $wrap.append(buildPlayerCard(player, state));
    });

    if (isOver) {
      showGameOver(state, players);
      return;
    }

    $("#gameover-panel").addClass("hidden").removeClass("flex");
    $("#dice-area").removeClass("hidden");

    const myTurn = state.turnUserId === _id;
    if (!rolling) {
      $("#dice-hint").text(myTurn ? "Tap the dice to roll" : "Waiting for opponent...");
    }
    $("#dice-btn")
      .toggleClass("playable", myTurn)
      .toggleClass("opacity-50 cursor-not-allowed", !myTurn)
      .toggleClass("cursor-pointer", myTurn);
  }

  function buildPlayerCard(player, state) {
    const isMe = player.userId === _id;
    const isTurn = state.turnUserId === player.userId && state.roomStatus === "playing";
    const color = isMe ? "green" : "red";
    const target = state.target || 100;
    const pct = Math.max(0, Math.min(100, Math.round((player.score / target) * 100)));

    const $card = $(
      '<div class="w-64 sm:w-72 rounded-2xl border-2 overflow-hidden bg-black bg-opacity-30 transition">' +
        '<div class="flex items-center justify-between px-4 py-3">' +
          '<div class="flex items-center gap-2">' +
            '<div class="avatar w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"></div>' +
            '<span class="name font-bold text-white truncate max-w-[8rem]"></span>' +
          "</div>" +
          '<span class="turn-label text-xs font-semibold uppercase tracking-wide"></span>' +
        "</div>" +
        '<div class="px-4 pb-4">' +
          '<div class="flex items-baseline gap-1 mb-2">' +
            '<span class="score text-3xl font-extrabold"></span>' +
            '<span class="text-gray-400 text-sm">/ ' + target + "</span>" +
          "</div>" +
          '<div class="w-full h-2 rounded-full bg-gray-700 overflow-hidden">' +
            '<div class="bar h-full rounded-full transition-all duration-500"></div>' +
          "</div>" +
        "</div>" +
      "</div>",
    );

    $card
      .toggleClass("border-green-400", color === "green")
      .toggleClass("border-red-400", color === "red")
      .toggleClass("ring-2 ring-green-400/60", isTurn && color === "green")
      .toggleClass("ring-2 ring-red-400/60", isTurn && color === "red");

    $card
      .find(".avatar")
      .toggleClass("bg-green-500", color === "green")
      .toggleClass("bg-red-500", color === "red")
      .text((player.sName || "Player").charAt(0).toUpperCase());

    $card.find(".name").text(player.sName || "Player");

    $card
      .find(".turn-label")
      .toggleClass("text-green-400", color === "green")
      .text(isMe && isTurn ? "your turn" : "");

    $card
      .find(".score")
      .toggleClass("text-green-400", color === "green")
      .toggleClass("text-red-400", color === "red")
      .text(player.score);

    $card
      .find(".bar")
      .toggleClass("bg-green-400", color === "green")
      .toggleClass("bg-red-400", color === "red")
      .css("width", pct + "%");

    return $card;
  }

  function showGameOver(state, players) {
    $("#dice-area").addClass("hidden");
    const winner = players.find(function (p) {
      return p.userId === state.winnerId;
    });
    const iWon = state.winnerId === _id;
    $("#gameover-title")
      .toggleClass("text-green-400", iWon)
      .toggleClass("text-red-400", !iWon)
      .text(iWon ? "You Won! 🎉" : (winner ? winner.sName : "Opponent") + " Won");
    $("#gameover-panel").removeClass("hidden").addClass("flex");
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
