"use strict";

const TTL = 7 * 24 * 60 * 60; // 7 days — matches JWT expiry
const key  = (id) => `user:${id}`;

async function setUser(user) {
    try {
        await client.setex(key(user._id), TTL, JSON.stringify(user));
    } catch (err) {
        console.error("Redis setUser error:", err);
    }
}

async function getUser(id) {
    try {
        const data = await client.get(key(id));
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error("Redis getUser error:", err);
        return null;
    }
}

async function delUser(id) {
    try {
        await client.del(key(id));
    } catch (err) {
        console.error("Redis delUser error:", err);
    }
}

module.exports = { setUser, getUser, delUser };
