"use strict";
const User = require('../models/user.model');
const cache = require('../utils/redis/cache');

//returns the user document from the database based on the provided id
async function fnGetUser(id){
    return await User.findById(id);
}

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

async function fnGetUser(id) {
    const cached = await cache.getUser(id);
    if (cached) return cached;
    const user = await User.findById(id);
    if (user) await cache.setUser(user);
    return user;
}

async function fnUpdateUser(_id, { sName, sImage, chips }) {
    const updateFields = {};
    if (sName  !== undefined) updateFields.sName  = sName;
    if (sImage !== undefined) updateFields.sImage = sImage;
    if (chips  !== undefined) updateFields.chips  = chips;
    const user = await User.findByIdAndUpdate(_id, updateFields, { returnDocument: 'after', runValidators: true });
    if (user) await cache.setUser(user);
    return user;
}

async function fnDeleteUser(_id) {
    const user = await User.findByIdAndDelete(_id);
    if (user) await cache.delUser(_id);
    return user;
}

module.exports = { fnGetUser, fnUpdateUser, fnDeleteUser };
