"use strict";

jest.mock("../../../services/wallet.services");

const wallet = require("../../../services/wallet.services");
const { fnSettleGamePot } = require("../../../services/payout.services");

const room = (overrides = {}) => ({
    gameId: "g1",
    status: "finished",
    lobbyChips: 100,
    winnerId: "a",
    players: [{ userId: "a" }, { userId: "b" }],
    ...overrides,
});

beforeEach(() => {
    wallet.fnCreditChips.mockResolvedValue(1);
});

describe("fnSettleGamePot", () => {
    test("pays the whole pot (stake x players) to the winner", async () => {
        await fnSettleGamePot(room());
        expect(wallet.fnCreditChips).toHaveBeenCalledTimes(1);
        expect(wallet.fnCreditChips).toHaveBeenCalledWith("a", 200);
    });

    test("pot scales with the number of players", async () => {
        await fnSettleGamePot(room({ players: [{ userId: "a" }, { userId: "b" }, { userId: "c" }, { userId: "d" }] }));
        expect(wallet.fnCreditChips).toHaveBeenCalledWith("a", 400);
    });

    test("the pot includes a player who forfeited (they stay in `players`)", async () => {
        await fnSettleGamePot(room({ winnerId: "b" }));
        expect(wallet.fnCreditChips).toHaveBeenCalledWith("b", 200);
    });

    test("refunds every player's stake on a draw / abandoned game", async () => {
        await fnSettleGamePot(room({ winnerId: null, abandoned: true }));
        expect(wallet.fnCreditChips.mock.calls).toEqual([["a", 100], ["b", 100]]);
    });

    test.each([undefined, ""])("treats winnerId %p as a draw", async (winnerId) => {
        await fnSettleGamePot(room({ winnerId }));
        expect(wallet.fnCreditChips).toHaveBeenCalledTimes(2);
    });

    test.each(["waiting", "playing", undefined])("does nothing while the room is %p", async (status) => {
        await fnSettleGamePot(room({ status }));
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test.each([null, undefined])("does nothing for a %p room", async (r) => {
        await expect(fnSettleGamePot(r)).resolves.toBeUndefined();
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test.each([0, undefined, null])("does nothing for a free game (lobbyChips=%p)", async (lobbyChips) => {
        await fnSettleGamePot(room({ lobbyChips }));
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test("a draw with no players is a no-op", async () => {
        await fnSettleGamePot(room({ winnerId: null, players: [] }));
        expect(wallet.fnCreditChips).not.toHaveBeenCalled();
    });

    test("refunds run in parallel and any failure rejects the settlement", async () => {
        wallet.fnCreditChips.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("mongo down"));
        await expect(fnSettleGamePot(room({ winnerId: null }))).rejects.toThrow("mongo down");
        expect(wallet.fnCreditChips).toHaveBeenCalledTimes(2);
    });

    test("a failed winner credit rejects", async () => {
        wallet.fnCreditChips.mockRejectedValueOnce(new Error("mongo down"));
        await expect(fnSettleGamePot(room())).rejects.toThrow("mongo down");
    });
});
