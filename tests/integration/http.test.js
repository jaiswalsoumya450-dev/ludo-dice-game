"use strict";

jest.mock("../../models/user.model", () => require("../helpers/fakeUserModel").createFakeUserModel());

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../../models/user.model");
const redis = require("../../utils/redis/connections");

const SECRET = process.env.JWT_SECRET || "dev_secret_change_in_prod";
const API = "/api/v1";

let app;
beforeAll(() => {
    app = express();
    require("../../config/app.config")(app);
});

beforeEach(() => {
    User.reset();
    redis.reset();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
});

const login = async (did = "device-1", sName = "Alice") => {
    const res = await request(app).post(`${API}/auth/guest`).send({ did, sName }).expect(200);
    return res.body;
};
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe("POST /auth/guest", () => {
    test("creates a user and returns a usable token", async () => {
        const body = await login();
        expect(body).toEqual({ success: true, token: expect.any(String), _id: expect.any(String), sName: "Alice", did: "device-1", chips: 5000 });
        expect(jwt.verify(body.token, SECRET)._id).toBe(body._id);
    });

    test("caches the user profile in redis on login", async () => {
        const { _id } = await login();
        expect(redis.hashes.get(`user:${_id}`)).toMatchObject({ _id, sName: "Alice", chips: "5000" });
    });

    test("the same device always maps to the same account; a new name renames it", async () => {
        const first = await login("device-1", "Alice");
        const again = await login("device-1", "Alice");
        const renamed = await login("device-1", "Alicia");
        expect(again._id).toBe(first._id);
        expect(renamed._id).toBe(first._id);
        expect(renamed.sName).toBe("Alicia");
    });

    test("accepts form-urlencoded bodies", async () => {
        const res = await request(app).post(`${API}/auth/guest`).type("form").send("did=d9&sName=Form").expect(200);
        expect(res.body.sName).toBe("Form");
    });

    test.each([
        ["missing did", { sName: "A" }],
        ["missing sName", { did: "d" }],
        ["empty strings", { did: "", sName: "" }],
        ["no body", undefined],
    ])("412 for %s", async (_, body) => {
        await request(app).post(`${API}/auth/guest`).send(body).expect(412);
        expect(User._users.size).toBe(0);
    });

    test("malformed JSON gets a bare 400", async () => {
        const res = await request(app)
            .post(`${API}/auth/guest`)
            .set("Content-Type", "application/json")
            .send('{"did": "d1", "sName": ')
            .expect(400);
        expect(res.text).toBe("Bad Request");
    });

    test("JSON bodies over 1mb are rejected with 413 via the error handler", async () => {
        const res = await request(app)
            .post(`${API}/auth/guest`)
            .set("Content-Type", "application/json")
            .send(JSON.stringify({ did: "d", sName: "x".repeat(1024 * 1024 + 10) }))
            .expect(413);
        expect(res.body).toEqual({ error: "request entity too large" });
        expect(logger.warn).toHaveBeenCalled();
    });

    test("form bodies with more than 500 parameters are rejected", async () => {
        const params = Array.from({ length: 501 }, (_, i) => `p${i}=1`).join("&");
        await request(app).post(`${API}/auth/guest`).type("form").send(`did=d&sName=n&${params}`).expect(413);
    });

    test("a database failure is a generic 400", async () => {
        jest.spyOn(User, "findOne").mockRejectedValueOnce(new Error("mongo down"));
        const res = await request(app).post(`${API}/auth/guest`).send({ did: "d", sName: "n" }).expect(400);
        expect(res.body).toEqual({ error: "Client-side error" });
    });

    test("GET is not routed", async () => {
        await request(app).get(`${API}/auth/guest`).expect(404);
    });
});

describe("user routes require a valid token", () => {
    test.each([
        ["get", `${API}/user/64f000000000000000000000`],
        ["put", `${API}/user`],
        ["delete", `${API}/user/64f000000000000000000000`],
    ])("%s %s -> 401 without a token", async (method, url) => {
        const res = await request(app)[method](url).expect(401);
        expect(res.body).toEqual({ error: "No token provided" });
    });

    test("401 for a forged token", async () => {
        const forged = jwt.sign({ _id: "x" }, "not-the-secret");
        await request(app).get(`${API}/user/x`).set(bearer(forged)).expect(401, { error: "Invalid or expired token" });
    });

    test("401 for a token whose account is valid but expired", async () => {
        const { _id } = await login();
        const expired = jwt.sign({ _id, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
        await request(app).get(`${API}/user/${_id}`).set(bearer(expired)).expect(401);
    });
});

describe("GET /user/:id", () => {
    test("returns the profile", async () => {
        const { token, _id } = await login();
        const res = await request(app).get(`${API}/user/${_id}`).set(bearer(token)).expect(200);
        expect(res.body).toMatchObject({ success: true, data: { _id, sName: "Alice", chips: 5000 } });
    });

    test("404 once the caller's own account no longer exists", async () => {
        const { token, _id } = await login();
        User.reset();
        await request(app).get(`${API}/user/${_id}`).set(bearer(token)).expect(404, { error: "User not found" });
    });

    test("403 (not 400) for a malformed id, since it can't be the caller's", async () => {
        const { token } = await login();
        await request(app).get(`${API}/user/not-an-id`).set(bearer(token)).expect(403);
    });

    // the profile includes `did`, which is the only credential guest login checks
    test("can't read another player's profile (which would leak their login credential)", async () => {
        const alice = await login("alice-device", "Alice");
        const bob = await login("bob-device", "Bob");
        const res = await request(app).get(`${API}/user/${alice._id}`).set(bearer(bob.token)).expect(403);
        expect(res.body).toEqual({ error: "Forbidden" });
        expect(JSON.stringify(res.body)).not.toContain("alice-device");
    });
});

describe("PUT /user", () => {
    test("updates the profile", async () => {
        const { token, _id } = await login();
        const res = await request(app).put(`${API}/user`).set(bearer(token)).send({ _id, sName: "Bob", sImage: 3 }).expect(200);
        expect(res.body.data).toMatchObject({ sName: "Bob", sImage: 3 });
    });

    test.each([
        [{ sImage: "abc" }],
        [{ sImage: "" }],
    ])("412 for invalid field types %j", async (patch) => {
        const { token, _id } = await login();
        await request(app).put(`${API}/user`).set(bearer(token)).send({ _id, ...patch }).expect(412);
    });

    test("400 when the update fails schema validation (empty name)", async () => {
        const { token, _id } = await login();
        await request(app).put(`${API}/user`).set(bearer(token)).send({ _id, sName: "" }).expect(400);
    });

    test("the account comes from the token, so no _id is needed in the body", async () => {
        const { token, _id } = await login();
        await request(app).put(`${API}/user`).set(bearer(token)).send({ sName: "x" }).expect(200);
        expect(User._users.get(_id).sName).toBe("x");
    });

    test("cannot modify another player's account", async () => {
        const alice = await login("alice-device", "Alice");
        const bob = await login("bob-device", "Bob");
        await request(app).put(`${API}/user`).set(bearer(bob.token)).send({ _id: alice._id, sName: "pwned" }).expect(200);
        expect(User._users.get(alice._id).sName).toBe("Alice");
        expect(User._users.get(bob._id).sName).toBe("pwned");
    });

    test("cannot change a chip balance, not even their own", async () => {
        const { token, _id } = await login();
        const res = await request(app).put(`${API}/user`).set(bearer(token)).send({ chips: 1e9, sName: "Rich" }).expect(200);
        expect(res.body.data).toMatchObject({ sName: "Rich", chips: 5000 });
        expect(User.balance(_id)).toBe(5000);
    });
});

describe("DELETE /user/:id", () => {
    test("deletes the account, then reports it as already gone", async () => {
        const { token, _id } = await login();
        await request(app).delete(`${API}/user/${_id}`).set(bearer(token)).expect(200, { success: true, message: "User deleted" });
        await request(app).delete(`${API}/user/${_id}`).set(bearer(token)).expect(404, { success: true });
    });

    test("the token stays valid after the account is deleted (stateless JWT)", async () => {
        const { token, _id } = await login();
        await request(app).delete(`${API}/user/${_id}`).set(bearer(token));
        await request(app).get(`${API}/user/${_id}`).set(bearer(token)).expect(404);
    });

    test("cannot delete another player's account", async () => {
        const alice = await login("alice-device", "Alice");
        const bob = await login("bob-device", "Bob");
        await request(app).delete(`${API}/user/${alice._id}`).set(bearer(bob.token)).expect(403, { error: "Forbidden" });
        expect(User._users.has(alice._id)).toBe(true);
    });
});

describe("web pages", () => {
    test.each(["/web/login", "/web/main", "/web/search", "/web/gameplay"])("GET %s renders HTML", async (url) => {
        const res = await request(app).get(url).expect(200);
        expect(res.headers["content-type"]).toMatch(/text\/html/);
        expect(res.text).toMatch(/<html/i);
    });

    test("POST /web/login echoes the submitted identity", async () => {
        await request(app).post("/web/login").send({ did: "d", sName: "n", extra: 1 }).expect(200, { success: true, did: "d", sName: "n" });
    });

    test("POST /web/login with no body still answers", async () => {
        await request(app).post("/web/login").expect(200, { success: true });
    });

    test.each(["/web/login", "/web/main", "/web/search", "/web/gameplay"])("a render failure on %s is a 500", async (url) => {
        jest.spyOn(express.response, "render").mockImplementation(() => {
            throw new Error("template exploded");
        });
        await request(app).get(url).expect(500, "Error");
    });
});

describe("global error handler", () => {
    // Routes registered before app.config run ahead of its middleware, so an
    // error they raise travels through both of its error handlers.
    const appThrowing = (err) => {
        const a = express();
        a.get("/boom", (req, res, next) => next(err));
        require("../../config/app.config")(a);
        return a;
    };

    test("uses the error's status and message", async () => {
        const err = Object.assign(new Error("Nope"), { status: 418 });
        await request(appThrowing(err)).get("/boom").expect(418, { error: "Nope" });
        expect(logger.warn).toHaveBeenCalledWith(err);
    });

    test("defaults to 400 and merges err.data into the body", async () => {
        const err = { error: "custom_error", data: { field: "did" } };
        await request(appThrowing(err)).get("/boom").expect(400, { error: "custom_error", field: "did" });
    });

    test("a thrown string becomes the message and isn't logged", async () => {
        await request(appThrowing("plain_string")).get("/boom").expect(400, { error: "plain_string" });
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test("falls back to 'something_went_wrong'", async () => {
        await request(appThrowing({})).get("/boom").expect(400, { error: "something_went_wrong" });
    });
});

describe("app plumbing", () => {
    test("serves static assets from /public", async () => {
        const res = await request(app).get("/js/constants.js").expect(200);
        expect(res.headers["content-type"]).toMatch(/javascript/);
    });

    test("static serving can't escape the public folder", async () => {
        await request(app).get("/../package.json").expect(404);
        await request(app).get("/%2e%2e/package.json").expect(404);
    });

    test("CORS allows any origin and exposes Authorization", async () => {
        const res = await request(app).get("/web/login").set("Origin", "https://evil.example").expect(200);
        expect(res.headers["access-control-allow-origin"]).toBe("*");
        expect(res.headers["access-control-expose-headers"]).toMatch(/Authorization/);
    });

    test("CORS preflight is answered", async () => {
        const res = await request(app)
            .options(`${API}/user`)
            .set("Origin", "https://x.example")
            .set("Access-Control-Request-Method", "PUT")
            .expect(204);
        expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/);
    });

    test("unknown routes fall through to Express's 404", async () => {
        await request(app).get("/nope").expect(404);
        await request(app).get("/api/v2/auth/guest").expect(404);
    });
});
