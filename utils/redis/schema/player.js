"use strict";

const fnGetPlayerSchema = (data = {}) => {
  let playerData = Object.create(null);
  if (playerData._id) {
    playerData._id = data._id.toString() || null;
  }

  playerData.sName = data.sName || null;
  playerData.sImage = data.sImage || null;
  if (playerData.chips) {
    playerData.chips = data.chips.toString() || 0;
  }
  return _.pick(data, ['_id', 'sName', 'sImage', 'chips']);
};

module.exports = { fnGetPlayerSchema };
