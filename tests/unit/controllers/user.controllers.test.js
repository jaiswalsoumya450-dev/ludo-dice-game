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

beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
});

test("controllers/index exposes the auth and user controllers", () => {
    expect(controllers.userController).toBe(userController);
    expect(controllers.authController).toBe(require("../../../controllers/auth.controllers"));
});

describe("fnGetUser", () => {
    test("200 with the user", async () => {
        userService.fnGetUser.mockResolvedValue(user);
        const res = mockRes();
        await userController.fnGetUser({ params: { id: "u1" } }, res);
        expect(userService.fnGetUser).toHaveBeenCalledWith("u1");
        expect(res.json).toHaveBeenCalledWith({ success: true, data: user });
    });

    test("404 when not found", async () => {
        userService.fnGetUser.mockResolvedValue(null);
        const res = mockRes();
        await userController.fnGetUser({ params: { id: "u1" } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: "User not found" });
    });

    test("400 on a service error (e.g. malformed id)", async () => {
        userService.fnGetUser.mockRejectedValue(Object.assign(new Error("cast"), { name: "CastError" }));
        const res = mockRes();
        await userController.fnGetUser({ params: { id: "bad" } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "Client-side error" });
    });
});

describe("fnUpdateUser", () => {
    test("passes _id and the editable fields from the body", async () => {
        userService.fnUpdateUser.mockResolvedValue(user);
        const res = mockRes();
        await userController.fnUpdateUser({ body: { _id: "u1", sName: "B", sImage: 2, chips: 3, did: "ignored" } }, res);
        expect(userService.fnUpdateUser).toHaveBeenCalledWith("u1", { sName: "B", sImage: 2, chips: 3 });
        expect(res.json).toHaveBeenCalledWith({ success: true, data: user });
    });

    test("omitted fields are forwarded as undefined", async () => {
        userService.fnUpdateUser.mockResolvedValue(user);
        await userController.fnUpdateUser({ body: { _id: "u1" } }, mockRes());
        expect(userService.fnUpdateUser).toHaveBeenCalledWith("u1", { sName: undefined, sImage: undefined, chips: undefined });
    });

    test("404 when the user doesn't exist", async () => {
        userService.fnUpdateUser.mockResolvedValue(null);
        const res = mockRes();
        await userController.fnUpdateUser({ body: { _id: "u1" } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test("400 on a validation error", async () => {
        userService.fnUpdateUser.mockRejectedValue(new Error("ValidationError"));
        const res = mockRes();
        await userController.fnUpdateUser({ body: { _id: "u1", sName: "" } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test("400 when there is no body at all", async () => {
        const res = mockRes();
        await userController.fnUpdateUser({}, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(userService.fnUpdateUser).not.toHaveBeenCalled();
    });
});

describe("fnDeleteUser", () => {
    test("200 with a message when deleted", async () => {
        userService.fnDeleteUser.mockResolvedValue(user);
        const res = mockRes();
        await userController.fnDeleteUser({ params: { id: "u1" } }, res);
        expect(userService.fnDeleteUser).toHaveBeenCalledWith("u1");
        expect(res.json).toHaveBeenCalledWith({ success: true, message: "User deleted" });
    });

    test("404 but success:true when the user was already gone", async () => {
        userService.fnDeleteUser.mockResolvedValue(null);
        const res = mockRes();
        await userController.fnDeleteUser({ params: { id: "u1" } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    test("400 on a service error", async () => {
        userService.fnDeleteUser.mockRejectedValue(new Error("x"));
        const res = mockRes();
        await userController.fnDeleteUser({ params: { id: "u1" } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});
