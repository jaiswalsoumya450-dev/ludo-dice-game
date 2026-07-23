"use strict";
const User = require('../models/user.model');

async function fnGuestLogin({ did, sName }) {
    //find user by did
    //if did is the same but sName is different, update the sName also so it shows up in the document
    let user = await User.findOne({ did });
    //if user doesn't exist, create a new user with the provided did and sName
    if (!user) {
        user = await User.create({ did, sName });
        //if user exists but sName is different, update the sName
    } else if (user.sName !== sName) {
        user = await User.findOneAndUpdate({ did }, { sName }, { returnDocument: 'after' });
    }
    return user;
}

module.exports = {
    fnGuestLogin
};