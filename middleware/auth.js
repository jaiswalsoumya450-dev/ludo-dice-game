"use strict";
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';

function authMiddleware(req, res, next) {
    //get the token from the Authorization header 
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.replace('Bearer ', '');

    //if no token is provided, return a 401 error
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    //verify the token using the secret key
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
        //if the token is valid, attach the user info to the request object and call next() to proceed to the next middleware or route handler
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

//export the middleware function to be used in routes
module.exports = authMiddleware;
