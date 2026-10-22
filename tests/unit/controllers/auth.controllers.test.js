"use strict";

jest.mock("../../../services/auth.services");
jest.mock("../../../services/user.services");

const jwt = require("jsonwebtoken");
const authService = require("../../../services/auth.services");
const userService = require("../../../services/user.services");
const { fnGuestLogin } = require("../../../controllers/auth.controllers");

const SECRET = process.env.JWT_SECRET || "dev_secret_change_in_prod";

const mockRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

const user = { _id: "u1", did: "d1", sName: "Alice", chips: 5000, sImage: 37, createdAt: "x" };

beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    authService.fnGuestLogin.mockResolvedValue(user);
    userService.fnRedisGetUser.mockResolvedValue(user);
});

describe("fnGuestLogin controller", () => {
    test("logs in, warms the cache, and returns a 7-day token plus the profile", async () => {
        const res = mockRes();
        await fnGuestLogin({ body: { did: "d1", sName: "Alice" } }, res);

        expect(authService.fnGuestLogin).toHaveBeenCalledWith({ did: "d1", sName: "Alice" });
        expect(userService.fnRedisGetUser).toHaveBeenCalledWith("u1");

        const body = res.json.mock.calls[0][0];
        expect(body).toEqual({ success: true, token: expect.any(String), _id: "u1", sName: "Alice", did: "d1", chips: 5000 });

        const decoded = jwt.verify(body.token, SECRET);
        expect(decoded).toMatchObject({ _id: "u1", did: "d1", sName: "Alice" });
        expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
        expect(decoded).not.toHaveProperty("chips");
        expect(res.status).not.toHaveBeenCalled();
    });

    test("ignores extra body fields (can't inject chips)", async () => {
        await fnGuestLogin({ body: { did: "d1", sName: "Alice", chips: 1e9, _id: "admin" } }, mockRes());
        expect(authService.fnGuestLogin).toHaveBeenCalledWith({ did: "d1", sName: "Alice" });
    });

    test.each([
        ["missing did", { sName: "A" }],
        ["missing sName", { did: "d" }],
        ["empty did", { did: "", sName: "A" }],
        ["empty sName", { did: "d", sName: "" }],
        ["zero did", { did: 0, sName: "A" }],
        ["empty body", {}],
    ])("400 for %s, without touching services", async (_, body) => {
        const res = mockRes();
        await fnGuestLogin({ body }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "did and sName are required" });
        expect(authService.fnGuestLogin).not.toHaveBeenCalled();
    });

    test("an undefined body is caught and reported as a 400 client error", async () => {
        const res = mockRes();
        await fnGuestLogin({}, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "Client-side error" });
    });

    test("a database error becomes a generic 400 (details are only logged)", async () => {
        authService.fnGuestLogin.mockRejectedValueOnce(new Error("E11000 duplicate key"));
        const res = mockRes();
        await fnGuestLogin({ body: { did: "d", sName: "n" } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "Client-side error" });
        expect(console.error).toHaveBeenCalled();
    });

    test("a cache failure fails the whole login and issues no token", async () => {
        userService.fnRedisGetUser.mockRejectedValueOnce(new Error("redis down"));
        const res = mockRes();
        await fnGuestLogin({ body: { did: "d", sName: "n" } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0]).not.toHaveProperty("token");
    });
});
