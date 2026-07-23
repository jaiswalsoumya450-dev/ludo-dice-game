"use strict";

const _ = require('lodash');

const { check, validationResult } = require('express-validator');
const httpResponse = require('../utils/httpResponse.js');

const fnValidationResult = (req, res, next) => {
    const validationError = validationResult(req).mapped();
    if (_.keys(validationError).length > 0) return httpResponse.fnPreConditionFailed(res);
    return next();
};

//checks if the required fields are present in the request body and if they are of the correct type
const guestLogin = [
    check('did', 'Device ID is required').notEmpty(),
    check('sName', 'Name is required').notEmpty()
];

//checks if the fields to be updated are of the correct type
const updateUser = [
    check('sName', 'Name must be a string').optional(),
    check('sImage', 'sImage must be a number').optional().isNumeric(),
    check('chips', 'chips must be a number').optional().isNumeric()
];

module.exports = {
    fnValidationResult,
    guestLogin,
    updateUser
};