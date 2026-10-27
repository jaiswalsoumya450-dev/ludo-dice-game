"use strict";

jest.mock("../../../services/user.services");

const userService = require("../../../services/user.services");
const userController = require("../../../controllers/user.controllers");
const controllers = require("../../../controllers");

const mockRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

const user = { _id: "u1", sName: "Alice", chips: 10 };
const self = { _id: "u1" }; // decoded JWT, as set by the auth middleware

beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
});

test("controllers/index exposes the auth and user controllers", () => {
    expect(controllers.userController).toBe(userController);
    expect(controllers.authController).toBe(require("../../../controllers/auth.controllers"));
});

describe.each(["fnGetUser", "fnDeleteUser"])("%s ownership", (fn) => {
    test("403 for another user's id, without touching the service", async () => {
        const res = mockRes();
        await userController[fn]({ params: { id: "someone-else" }, user: self }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
        expect(userService[fn]).not.toHaveBeenCalled();
    });

    test("compares against a non-string token _id by value", async () => {
        userService[fn].mockResolvedValue(user);
        const res = mockRes();
        await userController[fn]({ params: { id: "u1" }, user: { _id: { toString: () => "u1" } } }, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });
});

describe("fnGetUser", () => {
    test("200 with the user", async () => {
        userService.fnGetUser.mockResolvedValue(user);
        const res = mockRes();
        await userController.fnGetUser({ params: { id: "u1" }, user: self }, res);
        expect(userService.fnGetUser).toHaveBeenCalledWith("u1");
        expect(res.json).toHaveBeenCalledWith({ success: true, data: user });
    });

    test("404 when not found", async () => {
        userService.fnGetUser.mockResolvedValue(null);
        const res = mockRes();
        await userController.fnGetUser({ params: { id: "u1" }, user: self }, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: "User not found" });
    });

    test("400 on a service error (e.g. malformed id)", async () => {
        userService.fnGetUser.mockRejectedValue(Object.assign(new Error("cast"), { name: "CastError" }));
        const res = mockRes();
        await userController.fnGetUser({ params: { id: "bad" }, user: { _id: "bad" } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "Client-side error" });
    });
});

describe("fnUpdateUser", () => {
    test("updates the token's user with the editable fields from the body", async () => {
        userService.fnUpdateUser.mockResolvedValue(user);
        const res = mockRes();
        await userController.fnUpdateUser({ body: { sName: "B", sImage: 2, did: "ignored" }, user: self }, res);
        expect(userService.fnUpdateUser).toHaveBeenCalledWith("u1", { sName: "B", sImage: 2 });
        expect(res.json).toHaveBeenCalledWith({ success: true, data: user });
    });

    test("ignores an _id in the body (can't target another account)", async () => {
        userService.fnUpdateUser.mockResolvedValue(user);
        await userController.fnUpdateUser({ body: { _id: "victim", sName: "pwned" }, user: self }, mockRes());
        expect(userService.fnUpdateUser).toHaveBeenCalledWith("u1", { sName: "pwned", sImage: undefined });
    });

    test("never forwards chips (balances only change via the wallet)", async () => {
        userService.fnUpdateUser.mockResolvedValue(user);
        await userController.fnUpdateUser({ body: { chips: 1e9 }, user: self }, mockRes());
        expect(userService.fnUpdateUser.mock.calls[0][1]).not.toHaveProperty("chips");
    });

    test("omitted fields are forwarded as undefined", async () => {
        userService.fnUpdateUser.mockResolvedValue(user);
        await userController.fnUpdateUser({ body: {}, user: self }, mockRes());
        expect(userService.fnUpdateUser).toHaveBeenCalledWith("u1", { sName: undefined, sImage: undefined });
    });

    test("404 when the user doesn't exist", async () => {
        userService.fnUpdateUser.mockResolvedValue(null);
        const res = mockRes();
        await userController.fnUpdateUser({ body: {}, user: self }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test("400 on a validation error", async () => {
        userService.fnUpdateUser.mockRejectedValue(new Error("ValidationError"));
        const res = mockRes();
        await userController.fnUpdateUser({ body: { sName: "" }, user: self }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test("400 when there is no body at all", async () => {
        const res = mockRes();
        await userController.fnUpdateUser({ user: self }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(userService.fnUpdateUser).not.toHaveBeenCalled();
    });
});

describe("fnDeleteUser", () => {
    test("200 with a message when deleted", async () => {
        userService.fnDeleteUser.mockResolvedValue(user);
        const res = mockRes();
        await userController.fnDeleteUser({ params: { id: "u1" }, user: self }, res);
        expect(userService.fnDeleteUser).toHaveBeenCalledWith("u1");
        expect(res.json).toHaveBeenCalledWith({ success: true, message: "User deleted" });
    });

    test("404 but success:true when the user was already gone", async () => {
        userService.fnDeleteUser.mockResolvedValue(null);
        const res = mockRes();
        await userController.fnDeleteUser({ params: { id: "u1" }, user: self }, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    test("400 on a service error", async () => {
        userService.fnDeleteUser.mockRejectedValue(new Error("x"));
        const res = mockRes();
        await userController.fnDeleteUser({ params: { id: "u1" }, user: self }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});
