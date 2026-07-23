"use strict";
const userService = require('../services/user.services');

//function to get user by id
async function fnGetUser(req, res) {
    try {
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
      //destructuring the id, sName, and sImage from the request body to update them in the user document in the database
      //same as:
      //const sName = req.body.sName;
        const { _id, sName, sImage, chips } = req.body;
        //call the service function to update the user document in the database
        //using the new provided id, sName, sImage, and/or chips values
        const user = await userService.fnUpdateUser(_id, { sName, sImage, chips });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, data: user });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Client-side error' }); 
    }
}

async function fnDeleteUser(req, res) {
    try {
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
