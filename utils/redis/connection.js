"use strict";
const Redis = require("ioredis");

const client = new Redis({ host: "127.0.0.1", port: 6379 });

client.on("connect", () => console.log("Connected to Redis"));
client.on("error",   (err) => console.error("Redis error:", err));

module.exports = client;
