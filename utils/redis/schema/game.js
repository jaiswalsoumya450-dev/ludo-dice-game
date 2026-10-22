"use strict";

const _ = require('lodash');

// running/playing, waiting, destroyed, abandoned, completed/finished

const fnGetGameSchema = (data = {}) => {
  const gameData = Object.create(null);
  gameData._id = data._id ? data._id.toString() : null;
  gameData.sName = data.sName || null;
  gameData.sImage = data.sImage || null;
  gameData.status = data.status || "waiting";
  return _.pick(gameData, ['_id', 'sName', 'sImage', 'status']);
};

const fnSetGameSchema = (gameData, data = {}) => {
    const patch = _.pick(data, ['_id', 'sName', 'sImage', 'status']);
    if (patch._id != null) {
        gameData._id = patch._id.toString();
    }
    if (patch.sName != null) {
        gameData.sName = patch.sName;
    }
    if (patch.sImage != null) {
        gameData.sImage = patch.sImage;
    }
    if (patch.status != null) {
        gameData.status = patch.status;
    }
    return gameData;
}

module.exports = { fnGetGameSchema, fnSetGameSchema };