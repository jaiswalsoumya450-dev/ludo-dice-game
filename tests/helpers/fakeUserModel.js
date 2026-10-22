"use strict";

const { Types } = require("mongoose");

/**
 * In-memory stand-in for the mongoose `User` model (models/user.model.js).
 * Supports exactly the query shapes the services use:
 *   findOne({ did }), create({ did, sName }),
 *   findOneAndUpdate({ did } | { _id, chips: { $gte } }, { field } | { $inc }),
 *   findById, findByIdAndUpdate(id, { field } | { $inc }), findByIdAndDelete.
 *
 * Mirrors the mongoose behaviours that matter for edge cases: schema defaults
 * (sImage 37, chips 5000), the unique `did` index (E11000), CastError for
 * malformed ObjectIds, and `runValidators` rejecting an empty required sName.
 */
function createFakeUserModel() {
    const users = new Map();

    const clone = (u) => (u ? { ...u } : null);

    const castId = (id) => {
        const str = id == null ? id : String(id);
        if (str !== undefined && str !== null && !Types.ObjectId.isValid(str)) {
            const err = new Error(`Cast to ObjectId failed for value "${str}"`);
            err.name = "CastError";
            throw err;
        }
        return str;
    };

    const matches = (u, filter) =>
        Object.entries(filter).every(([k, cond]) => {
            if (cond && typeof cond === "object" && "$gte" in cond) return u[k] >= cond.$gte;
            return String(u[k]) === String(cond);
        });

    const validate = (u) => {
        if (typeof u.sName !== "string" || u.sName.length === 0) {
            const err = new Error("User validation failed: sName: Path `sName` is required.");
            err.name = "ValidationError";
            throw err;
        }
        for (const f of ["sImage", "chips"]) {
            if (Number.isNaN(Number(u[f]))) {
                const err = new Error(`Cast to Number failed for value "${u[f]}" at path "${f}"`);
                err.name = "ValidationError";
                throw err;
            }
            u[f] = Number(u[f]);
        }
    };

    const applyUpdate = (u, update, opts = {}) => {
        const next = { ...u };
        if (update.$inc) {
            for (const [k, v] of Object.entries(update.$inc)) next[k] = (next[k] || 0) + v;
        } else {
            for (const [k, v] of Object.entries(update)) if (v !== undefined) next[k] = v;
        }
        if (opts.runValidators) validate(next);
        next.updatedAt = new Date();
        return next;
    };

    const model = {
        _users: users,

        reset() {
            users.clear();
        },

        seed(fields = {}) {
            const _id = fields._id ? String(fields._id) : new Types.ObjectId().toString();
            const doc = { _id, did: `did-${_id}`, sName: "Player", sImage: 37, chips: 5000, ...fields, _id };
            users.set(_id, doc);
            return clone(doc);
        },

        balance(id) {
            const u = users.get(String(id));
            return u ? u.chips : undefined;
        },

        async findOne(filter) {
            for (const u of users.values()) if (matches(u, filter)) return clone(u);
            return null;
        },

        async create({ did, sName, sImage, chips }) {
            for (const u of users.values()) {
                if (u.did === did) {
                    const err = new Error(`E11000 duplicate key error collection: users index: did_1 dup key: { did: "${did}" }`);
                    err.code = 11000;
                    throw err;
                }
            }
            const doc = { _id: new Types.ObjectId().toString(), did, sName, sImage: sImage ?? 37, chips: chips ?? 5000 };
            validate(doc);
            doc.createdAt = doc.updatedAt = new Date();
            users.set(doc._id, doc);
            return clone(doc);
        },

        async findOneAndUpdate(filter, update, opts = {}) {
            if (filter._id !== undefined) castId(filter._id);
            for (const [id, u] of users) {
                if (!matches(u, filter)) continue;
                const next = applyUpdate(u, update, opts);
                users.set(id, next);
                return clone(opts.returnDocument === "after" ? next : u);
            }
            return null;
        },

        async findById(id) {
            id = castId(id);
            return clone(users.get(id));
        },

        async findByIdAndUpdate(id, update, opts = {}) {
            id = castId(id);
            const u = users.get(id);
            if (!u) return null;
            const next = applyUpdate(u, update, opts);
            users.set(id, next);
            return clone(opts.returnDocument === "after" ? next : u);
        },

        async findByIdAndDelete(id) {
            id = castId(id);
            const u = users.get(id);
            users.delete(id);
            return clone(u);
        },
    };

    return model;
}

module.exports = { createFakeUserModel };
