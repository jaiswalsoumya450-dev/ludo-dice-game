"use strict";

jest.mock("../../../models/user.model", () => require("../../helpers/fakeUserModel").createFakeUserModel());

const User = require("../../../models/user.model");
const authService = require("../../../services/auth.services");

beforeEach(() => User.reset());

describe("fnGuestLogin", () => {
    test("creates a new user with schema defaults on first login", async () => {
        const user = await authService.fnGuestLogin({ did: "device-1", sName: "Alice" });
        expect(user).toMatchObject({ did: "device-1", sName: "Alice", sImage: 37, chips: 5000 });
        expect(user._id).toBeTruthy();
        expect(User._users.size).toBe(1);
    });

    test("returns the existing user (no writes) when the device and name match", async () => {
        const existing = User.seed({ did: "device-1", sName: "Alice", chips: 42 });
        const create = jest.spyOn(User, "create");
        const update = jest.spyOn(User, "findOneAndUpdate");

        const user = await authService.fnGuestLogin({ did: "device-1", sName: "Alice" });
        expect(user._id).toBe(existing._id);
        expect(user.chips).toBe(42);
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    test("renames an existing user when the same device logs in with a new name", async () => {
        const existing = User.seed({ did: "device-1", sName: "Alice", chips: 42 });
        const update = jest.spyOn(User, "findOneAndUpdate");

        const user = await authService.fnGuestLogin({ did: "device-1", sName: "Bob" });
        expect(update).toHaveBeenCalledWith({ did: "device-1" }, { sName: "Bob" }, { returnDocument: "after" });
        expect(user).toMatchObject({ _id: existing._id, sName: "Bob", chips: 42 });
    });

    test("name comparison is case-sensitive", async () => {
        User.seed({ did: "device-1", sName: "alice" });
        const user = await authService.fnGuestLogin({ did: "device-1", sName: "Alice" });
        expect(user.sName).toBe("Alice");
    });

    test("different devices with the same name are different users", async () => {
        const a = await authService.fnGuestLogin({ did: "d1", sName: "Same" });
        const b = await authService.fnGuestLogin({ did: "d2", sName: "Same" });
        expect(a._id).not.toBe(b._id);
    });

    test("two simultaneous first logins from one device: the loser hits the unique index", async () => {
        const results = await Promise.allSettled([
            authService.fnGuestLogin({ did: "dup", sName: "A" }),
            authService.fnGuestLogin({ did: "dup", sName: "A" }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.find((r) => r.status === "rejected").reason.code).toBe(11000);
        expect(User._users.size).toBe(1);
    });

    test("propagates database errors", async () => {
        jest.spyOn(User, "findOne").mockRejectedValueOnce(new Error("mongo down"));
        await expect(authService.fnGuestLogin({ did: "d", sName: "n" })).rejects.toThrow("mongo down");
    });
});
