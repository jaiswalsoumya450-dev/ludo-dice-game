"use strict";

const _ = require('lodash');

const fnGetPlayerSchema = (data = {}) => {
  const playerData = Object.create(null);
  if (data._id) {
    playerData._id = data._id.toString();
  }

  playerData.sName = data.sName || null;
  playerData.sImage = data.sImage || null;
  if (data.chips != null) {
    playerData.chips = data.chips.toString();
  }
  return _.pick(playerData, ['_id', 'sName', 'sImage', 'chips']);
};

module.exports = { fnGetPlayerSchema };
