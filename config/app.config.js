"use strict";
const express = require('express'),
    cors = require('cors'),
    httpResponse = require('../utils/httpResponse');

module.exports = (app) => {

    // Parse application/json
    app.use(express.json({ limit: '1mb' }));

    // Default empty body if missing
    app.use((req, res, next) => {
        req.body ||= Object.create(null);
        next();
    });

    // Parse application/x-www-form-urlencoded
    app.use(express.urlencoded({
        limit: '1mb',
        extended: true,
        parameterLimit: 500
    }));

    app.use(express.static('public'));
    app.set('view engine', 'ejs');

    //app.use(require('../routes/health'));

    app.use(cors({
        'origin': '*',
        'allowedHeaders': ['Origin', 'Set-Cookie', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
        'exposedHeaders': ['Authorization', 'Set-Cookie']
    }));

    //Pre check body
    app.use((err, req, res, next) => {
        if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
            return httpResponse.fnBadRequest(res);
        }
        return next();
    });

    // App routes
    app.use(require('../routes'));

    //Route Not Found
    //app.use((req, res) => httpResponse.fnNotFound(res));

    //Express App Error Handling
    app.use((err, req, res, next) => {
        const statusCode = err.status || 400;
        const msg = err.message || err.error || (typeof err == "string" ? err : 'something_went_wrong');
        const data = err.data || null;
        const output = {
            error: msg
        };
        Object.assign(output, data);
        if (typeof err != "string") logger.warn(err);
        return res.status(statusCode).jsonp(output);
    });
};