"use strict";

// index.js normally installs these as globals before anything else is required.
// Several modules (routes/index.js, socket.init.js, redis.ops.js, the socket
// controllers...) read them at require time or call time, so tests need them too.

global.constants = {
    NODE_ENV: "test",
    PORT: 0,
    LOCAL_IP: "127.0.0.1",
    MONGO_DB_URL: "mongodb://fake-host:27017/test",
    CODE_VERSION: "v1",
    JWT_SECRET: process.env.JWT_SECRET || "dev_secret_change_in_prod",
};

// Never let a test open a real ioredis connection (automocking a module that
// requires this one would otherwise still execute it). Suites that need a
// working client re-mock it with a FakeRedis instance.
jest.mock("../../utils/redis/connections", () => {
    const { FakeRedis } = require("../helpers/fakeRedis");
    return new FakeRedis();
});

global.logger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
