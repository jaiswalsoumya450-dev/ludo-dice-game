"use strict";
const express = require('express');
const router = express.Router();
const apiRouteBasePath = `/api/${constants.CODE_VERSION}`;

router.use(`${apiRouteBasePath}/auth`, require('./auth'));
router.use(`${apiRouteBasePath}/user`, require('./user'));
router.use('/web', require('../controllers/web.controllers')());

module.exports = router;