"use strict";

describe("utils/mongodb/connection", () => {
    let mongoose;
    let fnMongoDBConnection;
    beforeEach(() => {
        mongoose = require("mongoose");
        ({ fnMongoDBConnection } = require("../../../utils/mongodb/connection"));
    });

    test("connects to constants.MONGO_DB_URL and resolves with nothing", async () => {
        const connect = jest.spyOn(mongoose, "connect").mockResolvedValue(mongoose);
        await expect(fnMongoDBConnection()).resolves.toBeUndefined();
        expect(connect).toHaveBeenCalledWith(constants.MONGO_DB_URL, {});
    });

    test("rejects with the driver's error", async () => {
        const err = new Error("ECONNREFUSED");
        jest.spyOn(mongoose, "connect").mockRejectedValue(err);
        await expect(fnMongoDBConnection()).rejects.toBe(err);
    });
});

describe("modules/start.server", () => {
    let fnStartServer;
    let socketInit;
    let mongo;
    let fakeServer;
    let createServer;

    beforeEach(() => {
        jest.resetModules();
        fakeServer = {
            listening: false,
            listen: jest.fn((port, ip, cb) => cb()),
            address: jest.fn(() => ({ address: "127.0.0.1", port: 1234 })),
        };
        createServer = jest.fn(() => fakeServer);
        jest.doMock("node:http", () => ({ createServer }));
        jest.doMock("../../../socket/socket.init");
        jest.doMock("../../../utils/mongodb/connection");
        socketInit = require("../../../socket/socket.init");
        mongo = require("../../../utils/mongodb/connection");
        mongo.fnMongoDBConnection.mockResolvedValue();
        fnStartServer = require("../../../modules/start.server");
    });

    test("creates the HTTP server with keep-alive tuning, attaches sockets, connects mongo, then listens", async () => {
        const order = [];
        socketInit.fnInit.mockImplementation(() => order.push("socket"));
        mongo.fnMongoDBConnection.mockImplementation(async () => order.push("mongo"));
        fakeServer.listen.mockImplementation((port, ip, cb) => {
            order.push("listen");
            cb();
        });
        const app = () => {};

        await fnStartServer(app);

        expect(createServer).toHaveBeenCalledWith({ keepAliveTimeout: 65000, headersTimeout: 66000 }, app);
        expect(socketInit.fnInit).toHaveBeenCalledWith(fakeServer);
        expect(fakeServer.listen).toHaveBeenCalledWith(constants.PORT, constants.LOCAL_IP, expect.any(Function));
        expect(order).toEqual(["socket", "mongo", "listen"]);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Start Server"), fakeServer.address(), undefined);
    });

    test("headersTimeout is greater than keepAliveTimeout (avoids spurious 502s behind a load balancer)", async () => {
        await fnStartServer(() => {});
        const [opts] = createServer.mock.calls[0];
        expect(opts.headersTimeout).toBeGreaterThan(opts.keepAliveTimeout);
    });

    test("does not listen again if the server is already listening", async () => {
        fakeServer.listening = true;
        await fnStartServer(() => {});
        expect(fakeServer.listen).not.toHaveBeenCalled();
    });

    test("a mongo failure aborts startup before listening", async () => {
        mongo.fnMongoDBConnection.mockRejectedValue(new Error("mongo down"));
        await expect(fnStartServer(() => {})).rejects.toThrow("mongo down");
        expect(fakeServer.listen).not.toHaveBeenCalled();
    });

    test("a socket.io init failure aborts startup", async () => {
        socketInit.fnInit.mockImplementation(() => {
            throw new Error("bad path");
        });
        await expect(fnStartServer(() => {})).rejects.toThrow("bad path");
        expect(mongo.fnMongoDBConnection).not.toHaveBeenCalled();
    });
});

describe("config/logger.config", () => {
    const loadWithEnv = (NODE_ENV) => {
        const saved = global.constants;
        global.constants = { ...saved, NODE_ENV };
        try {
            let logger;
            jest.isolateModules(() => {
                logger = require("../../../config/logger.config");
            });
            return logger;
        } finally {
            global.constants = saved;
        }
    };

    test.each(["prod", "staging", "dev", "local"])("uses the '%s' category", (env) => {
        expect(loadWithEnv(env).category).toBe(env);
    });

    test("falls back to 'local' when NODE_ENV is unset", () => {
        expect(loadWithEnv(undefined).category).toBe("local");
    });

    test("an unknown NODE_ENV still yields a working logger (log4js default category)", () => {
        const logger = loadWithEnv("weird");
        expect(logger.category).toBe("weird");
        expect(typeof logger.warn).toBe("function");
    });

    test("logs at trace level", () => {
        expect(loadWithEnv("prod").isTraceEnabled()).toBe(true);
    });
});

describe("constants/app.constants", () => {
    const load = (env) => {
        const saved = { ...process.env };
        Object.assign(process.env, env);
        try {
            let c;
            jest.isolateModules(() => {
                c = require("../../../constants/app.constants");
            });
            return c;
        } finally {
            process.env = saved;
        }
    };

    test("reads values from the environment", () => {
        const c = load({ PORT: "3001", CODE_VERSION: "v9", JWT_SECRET: "s3cret" });
        expect(c).toMatchObject({ PORT: "3001", CODE_VERSION: "v9", JWT_SECRET: "s3cret" });
    });

    test("falls back to a dev JWT secret when none is configured", () => {
        const saved = process.env.JWT_SECRET;
        delete process.env.JWT_SECRET;
        try {
            let c;
            jest.isolateModules(() => {
                c = require("../../../constants/app.constants");
            });
            expect(c.JWT_SECRET).toBe("dev_secret_change_in_prod");
        } finally {
            if (saved !== undefined) process.env.JWT_SECRET = saved;
        }
    });
});
