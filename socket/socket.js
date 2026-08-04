"use strict";

const socket = io.connect("http://192.168.1.109:3001");
const privateButton = document.getElementById("play-pri-btn");
privateButton.addEventListener("click", () => {
  const maxPlayers = document.getElementById("pri-max-players").value;
  const lobbyAmount = document.getElementById("pri-lobby-amt").value;
  socket.emit("joinPrivateGame", { maxPlayers, lobbyAmount });
});

const socket = io.connect("http://192.168.1.109:3001");
const publicButton = document.getElementById("play-pub-btn");
publicButton.addEventListener("click", () => {
  const maxPlayers = document.getElementById("pub-max-players").value;
  const lobbyAmount = document.getElementById("pub-lobby-amt").value;
  socket.emit("joinPublicGame", { maxPlayers, lobbyAmount });
});
