"use strict";
const User = require('../models/user.model');
const client = require('../utils/redis/connections');
const { fnRedisHMSETEX, fnRedisHGETALL } = require('../utils/redis/redis.ops');

const TTL = 7 * 24 * 60 * 60; // 7 days — matches JWT expiry
const key  = (id) => `user:${id}`;

function userToHash(user) {
    const obj = user.toObject ? user.toObject() : { ...user };
    const hash = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== null && v !== undefined) hash[k] = String(v);
    }
    return hash;
}

//returns the user document from the database based on the provided id
async function fnGetUser(id){
    return await User.findById(id);
}

//updates the user document in the database based on the provided id and the new sName and/or sImage values
//updates the user document in the database based on the provided id and the new sName and/or sImage values
async function fnUpdateUser(_id, { sName, sImage, chips }) {
    const updateFields = {};
    if(sName !== undefined) updateFields.sName = sName;
    if(sImage !== undefined) updateFields.sImage = sImage;
    if(chips !== undefined) updateFields.chips = chips;
    //return the updated user document after the update 
    //the 'after' parameter ensures that the updated document is returned instead of the original document
    //because findByIdAndUpdate returns the original document by default
    //and runValidators ensures that the update operation respects the schema validation rules defined in the User model
    //which means name has to be required and image has to be a number if they are provided in the update request
    return await User.findByIdAndUpdate(_id, updateFields, { returnDocument: 'after', runValidators: true });
}

//deletes the user document from the database based on the provided id
async function fnDeleteUser(_id) {
    return await User.findByIdAndDelete(_id);
}

async function fnRedisGetUser(id) {
    const cached = await fnRedisHGETALL(client, key(id));
    if (cached) return cached;

    const user = await User.findById(id);
    if (user) await fnRedisHMSETEX(client, key(user._id), userToHash(user), TTL);
    return user;
}

async function fnRedisUpdateUser(_id, { sName, sImage, chips }) {
    const updateFields = {};
    if (sName  !== undefined) updateFields.sName  = sName;
    if (sImage !== undefined) updateFields.sImage = sImage;
    if (chips  !== undefined) updateFields.chips  = chips;
    const user = await User.findByIdAndUpdate(_id, updateFields, { returnDocument: 'after', runValidators: true });
    if (user) await fnRedisHMSETEX(client, key(user._id), userToHash(user), TTL);
    return user;
}

async function fnRedisDeleteUser(id) {
    const user = await User.findByIdAndDelete(id);
    if (user) await client.del(key(id));
    return user;
}

module.exports = { fnGetUser, fnUpdateUser, fnDeleteUser, fnRedisGetUser, fnRedisUpdateUser, fnRedisDeleteUser };
