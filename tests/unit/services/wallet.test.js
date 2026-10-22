"use strict";

jest.mock("../../../models/user.model", () => require("../../helpers/fakeUserModel").createFakeUserModel());

const User = require("../../../models/user.model");
const wallet = require("../../../services/wallet.services");

let user;
beforeEach(() => {
    User.reset();
    user = User.seed({ chips: 500 });
});

describe("fnDebitChips", () => {
    test("deducts the amount and returns the new balance", async () => {
        await expect(wallet.fnDebitChips(user._id, 200)).resolves.toBe(300);
        expect(User.balance(user._id)).toBe(300);
    });

    test("issues a single conditional update guarded by chips >= amount", async () => {
        const spy = jest.spyOn(User, "findOneAndUpdate");
        await wallet.fnDebitChips(user._id, 50);
        expect(spy).toHaveBeenCalledWith(
            { _id: user._id, chips: { $gte: 50 } },
            { $inc: { chips: -50 } },
            { returnDocument: "after" },
        );
    });

    test("can spend the entire balance (boundary: amount === balance)", async () => {
        await expect(wallet.fnDebitChips(user._id, 500)).resolves.toBe(0);
    });

    test("returns null and leaves the balance alone when short by even one chip", async () => {
        await expect(wallet.fnDebitChips(user._id, 501)).resolves.toBeNull();
        expect(User.balance(user._id)).toBe(500);
    });

    test("returns null for an unknown user", async () => {
        await expect(wallet.fnDebitChips("64f000000000000000000000", 1)).resolves.toBeNull();
    });

    test.each([0, null, undefined, NaN, ""])("a falsy amount (%p) is a no-op that returns true", async (amount) => {
        const spy = jest.spyOn(User, "findOneAndUpdate");
        await expect(wallet.fnDebitChips(user._id, amount)).resolves.toBe(true);
        expect(spy).not.toHaveBeenCalled();
        expect(User.balance(user._id)).toBe(500);
    });

    test("concurrent debits can never take the balance negative", async () => {
        const results = await Promise.all(Array.from({ length: 10 }, () => wallet.fnDebitChips(user._id, 100)));
        expect(results.filter((r) => r !== null)).toHaveLength(5);
        expect(User.balance(user._id)).toBe(0);
    });

    test("propagates database errors", async () => {
        jest.spyOn(User, "findOneAndUpdate").mockRejectedValueOnce(new Error("mongo down"));
        await expect(wallet.fnDebitChips(user._id, 10)).rejects.toThrow("mongo down");
    });

    test("propagates a CastError for a malformed id", async () => {
        await expect(wallet.fnDebitChips("not-an-id", 10)).rejects.toMatchObject({ name: "CastError" });
    });

    // KNOWN BUG — a negative "debit" passes the `$gte: -n` guard and the
    // `$inc: { chips: +n }` mints chips. Callers currently guard with
    // `lobbyChips > 0`, but the wallet itself should refuse.
    test.failing("a negative debit never increases the balance", async () => {
        await wallet.fnDebitChips(user._id, -1000);
        expect(User.balance(user._id)).toBeLessThanOrEqual(500);
    });
});

describe("fnCreditChips", () => {
    test("adds the amount and returns the new balance", async () => {
        await expect(wallet.fnCreditChips(user._id, 250)).resolves.toBe(750);
    });

    test("issues an unconditional $inc", async () => {
        const spy = jest.spyOn(User, "findByIdAndUpdate");
        await wallet.fnCreditChips(user._id, 5);
        expect(spy).toHaveBeenCalledWith(user._id, { $inc: { chips: 5 } }, { returnDocument: "after" });
    });

    test("returns null for an unknown user", async () => {
        await expect(wallet.fnCreditChips("64f000000000000000000000", 5)).resolves.toBeNull();
    });

    test.each([0, null, undefined, NaN])("a falsy amount (%p) is a no-op that returns true", async (amount) => {
        const spy = jest.spyOn(User, "findByIdAndUpdate");
        await expect(wallet.fnCreditChips(user._id, amount)).resolves.toBe(true);
        expect(spy).not.toHaveBeenCalled();
    });

    test("concurrent credits are all applied", async () => {
        await Promise.all(Array.from({ length: 10 }, () => wallet.fnCreditChips(user._id, 10)));
        expect(User.balance(user._id)).toBe(600);
    });

    test("propagates database errors", async () => {
        jest.spyOn(User, "findByIdAndUpdate").mockRejectedValueOnce(new Error("mongo down"));
        await expect(wallet.fnCreditChips(user._id, 10)).rejects.toThrow("mongo down");
    });
});
