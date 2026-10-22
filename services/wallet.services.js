"use strict";

const User = require("../models/user.model");

/**
 * Debits `amount` chips from a user, but only if they can afford it — the
 * `chips: { $gte: amount }` guard makes this a single atomic conditional
 * update at the database level, so two concurrent debits can't both
 * succeed and push a balance negative. Returns the updated balance, or
 * null if the user doesn't have enough chips (or doesn't exist).
 */
async function fnDebitChips(userId, amount) {
  if (!amount) return true;
  const user = await User.findOneAndUpdate(
    { _id: userId, chips: { $gte: amount } },
    { $inc: { chips: -amount } },
    { returnDocument: "after" },
  );
  return user ? user.chips : null;
}

/**
 * Credits `amount` chips to a user (refunds, winnings). Not conditional —
 * crediting can never fail on a balance check.
 */
async function fnCreditChips(userId, amount) {
  if (!amount) return true;
  const user = await User.findByIdAndUpdate(userId, { $inc: { chips: amount } }, { returnDocument: "after" });
  return user ? user.chips : null;
}

module.exports = { fnDebitChips, fnCreditChips };
