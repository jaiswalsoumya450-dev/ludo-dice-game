"use strict";
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    did:    { type: String, required: true, unique: true },
    sName:  { type: String, required: true },
    sImage: { type: Number, default: 37 },
    chips:  { type: Number, default: 5000 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
