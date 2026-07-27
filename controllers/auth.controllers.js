"use strict";
const jwt = require('jsonwebtoken');
const authService = require('../services/auth.services');
const redisCache = require('../services/user.services');

//to stamp the JWT token with a secret key, we need to define a secret key. 
// In production, this should be set as an environment variable for security reasons. 
// Here, we provide a default value for development purposes.
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod'; 

async function fnGuestLogin(req, res) {
    try {
      //hands the did and the sname
        const { did, sName } = req.body;
        //if either parameter is missing, return 404 error
        if (!did || !sName) {
            return res.status(400).json({ error: 'did and sName are required' });
        }

        //call function to find or create user in the database
        const user = await authService.fnGuestLogin({ did, sName });

        //cache user in Redis immediately after login
        await redisCache.fnRedisGetUser(user);

        //create a JWT token for the user
        const token = jwt.sign(
          //JWT payload (content) contains the user's id, device id, and name
            { _id: user._id, did: user.did, sName: user.sName },
            //JWT secret key and expiration time
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        //return the token and user info to the client
        res.json({ success: true, token, _id: user._id, sName: user.sName, did: user.did, chips: user.chips });
    } catch (err) {
      // Log the error and return a 500 error
        console.error(err);
        res.status(400).json({ error: 'Client-side error' }); 
    }
}

module.exports = { fnGuestLogin };