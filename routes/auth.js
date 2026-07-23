"use strict";
const express = require('express');
const validator = require('../middleware/validator');
const authController = require('../controllers/auth.controllers');
const router = express.Router();

router.post('/guest', [validator.guestLogin, validator.fnValidationResult], authController.fnGuestLogin);

module.exports = router;