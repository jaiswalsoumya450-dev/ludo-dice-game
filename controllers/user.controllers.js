"use strict";
const userService = require('../services/user.services');

//users may only read or delete their own account: the id in the url must match the id in their verified token
//(the profile includes did, which is the guest login credential, so exposing it to others would let them log in as you)
function fnIsSelf(req) {
    return req.params.id === String(req.user._id);
}

//function to get user by id
async function fnGetUser(req, res) {
    try {
        if (!fnIsSelf(req)) return res.status(403).json({ error: 'Forbidden' });
      //user will store the user document returned from the database using the provided id in the request parameters
        const user = await userService.fnGetUser(req.params.id);
        //return 404 error if user is null
        if (!user) return res.status(404).json({ error: 'User not found' });
        //return the user document and actual data in the response 
        res.json({ success: true, data: user });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Client-side error' }); 
    }
}
//usercontroller, pull params from body, userauth
async function fnUpdateUser(req, res) {
    try {
      //the user being updated always comes from the verified token, never from the body,
      //so nobody can edit someone else's account by sending their _id
      //chips are deliberately not editable here: balances only change through the wallet service (stakes, payouts, refunds)
        const { sName, sImage } = req.body;
        //call the service function to update the user document in the database
        //using the new provided sName and/or sImage values
        const user = await userService.fnUpdateUser(req.user._id, { sName, sImage });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, data: user });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Client-side error' }); 
    }
}

async function fnDeleteUser(req, res) {
    try {
        if (!fnIsSelf(req)) return res.status(403).json({ error: 'Forbidden' });
      //get id from url, ask fnDeleteUser to delete user from database
      //if user is null return 404 error, else return success message
        const user = await userService.fnDeleteUser(req.params.id);
        if (!user) return res.status(404).json({ success: true }); //success cuz user already doesn't exist, no need to return error
        //sends message, not data cuz user is deleted, so no data to send back
        res.json({ success: true, message: 'User deleted' });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Client-side error' }); 
    }
}

module.exports = { fnGetUser, fnUpdateUser, fnDeleteUser };
