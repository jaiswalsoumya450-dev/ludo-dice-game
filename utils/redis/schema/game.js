"use strict";

// running/playing, waiting, destroyed, abandoned, completed/finished

const fnGetGameSchema = (data = {}) => {
  let gameData = Object.create(null);
  gameData._id = data._id.toString() || null;
  gameData.sName = data.sName || null;
  gameData.sImage = data.sImage || null;
  gameData.status = data.status || "waiting";
  return _.pick(gameData, ['_id', 'sName', 'sImage', 'status']);
};

const fnSetGameSchema = (gameData, data = {}) => {
    data = _.pick(gameData, ['_id', 'sName', 'sImage', 'status']);
    if(gameData._id) {
        gameData._id = data._id.toString();
    }
    if(gameData.sName) {
        gameData.sName = data.sName;
    }
    if(gameData.sImage) {
        gameData.sImage = data.sImage;
    }
    if(gameData.status) {
        gameData.status = data.status;
    }   
    return gameData;
}

module.exports = { fnGetGameSchema, fnSetGameSchema };