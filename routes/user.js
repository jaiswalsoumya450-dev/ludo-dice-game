"use strict";
const express = require('express');
const userController = require('../controllers/user.controllers');
const router = express.Router();
const { validator, userAuth } = require('../middleware');

router.get('/:id', userAuth, userController.fnGetUser);
router.put('/', userAuth, [validator.updateUser, validator.fnValidationResult], userController.fnUpdateUser);
router.delete('/:id', userAuth, userController.fnDeleteUser);

module.exports = router;
