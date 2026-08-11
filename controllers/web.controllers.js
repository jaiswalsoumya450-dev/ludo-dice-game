"use strict";
const express = require('express');
const router = express.Router();

module.exports = function () {
    router.get('/login', fnLogin);
    router.post('/login', fnPostLogin);
    router.get('/main', fnMain);
    router.get('/search', fnSearch);
    return router;
};

const fnLogin = (req, res) => {
    try {
        res.render('../public/views/game/login', {
            "MISC_BASE_URL": "http://127.0.0.1:3001",
            "NODE_ENV": "development"
        });
    } catch (err) {
        res.status(500).send('Error');
    }
};

const fnPostLogin = (req, res) => {
    try {
        const { did, sName } = req.body;
        console.log('Device ID:', did);
        console.log('Name:', sName);
        res.json({ success: true, did, sName });
    } catch (err) {
        res.json({ success: false, message: 'Something went wrong' });
    }
};

const fnMain = (req, res) => {
    try {
        res.render('../public/views/game/main', {
            "MISC_BASE_URL": "http://127.0.0.1:3001",
            "NODE_ENV": "development"
        });
    } catch (err) {
        res.status(500).send('Error');
    }
};

// for the search page
const fnSearch = (req, res) => {
    try {
        res.render('../public/views/scene/search', {
            "MISC_BASE_URL": "http://127.0.0.1:3001",
            "NODE_ENV": "development"
        });
    } catch (err) {
        res.status(500).send('Error');
    }
};