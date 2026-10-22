"use strict";

const jwt = require("jsonwebtoken");
const authMiddleware = require("../../../middleware/auth");

const SECRET = process.env.JWT_SECRET || "dev_secret_change_in_prod";
const payload = { _id: "u1", did: "d1", sName: "Alice" };

const mockRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

const run = (headers) => {
    const req = { headers };
    const res = mockRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    return { req, res, next };
};

describe("authMiddleware", () => {
    test("accepts a valid Bearer token and attaches the decoded payload", () => {
        const token = jwt.sign(payload, SECRET);
        const { req, res, next } = run({ authorization: `Bearer ${token}` });
        expect(next).toHaveBeenCalledWith();
        expect(req.user).toMatchObject(payload);
        expect(res.status).not.toHaveBeenCalled();
    });

    test.each([
        ["no Authorization header", {}],
        ["an empty header", { authorization: "" }],
        ["'Bearer ' with no token", { authorization: "Bearer " }],
    ])("401 'No token provided' for %s", (_, headers) => {
        const { res, next } = run(headers);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: "No token provided" });
        expect(next).not.toHaveBeenCalled();
    });

    test.each([
        ["garbage", "Bearer not.a.jwt"],
        ["wrong secret", `Bearer ${jwt.sign(payload, "some-other-secret")}`],
        ["expired", `Bearer ${jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET)}`],
        ["not yet valid", `Bearer ${jwt.sign(payload, SECRET, { notBefore: 3600 })}`],
        ["unsigned (alg none)", `Bearer ${jwt.sign(payload, null, { algorithm: "none" })}`],
        ["tampered payload", `Bearer ${(() => {
            const [h, , s] = jwt.sign(payload, SECRET).split(".");
            const forged = Buffer.from(JSON.stringify({ ...payload, _id: "admin" })).toString("base64url");
            return `${h}.${forged}.${s}`;
        })()}`],
        ["lower-case scheme (prefix isn't stripped)", `bearer ${jwt.sign(payload, SECRET)}`],
        ["double space after Bearer", `Bearer  ${jwt.sign(payload, SECRET)}`],
    ])("401 'Invalid or expired token' for a %s token", (_, authorization) => {
        const { res, next } = run({ authorization });
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
        expect(next).not.toHaveBeenCalled();
    });

    test("a raw token without the Bearer prefix is also accepted", () => {
        const { next, req } = run({ authorization: jwt.sign(payload, SECRET) });
        expect(next).toHaveBeenCalled();
        expect(req.user._id).toBe("u1");
    });

    test("only the header name in lower case is read (Node lower-cases incoming headers)", () => {
        const { res } = run({ Authorization: `Bearer ${jwt.sign(payload, SECRET)}` });
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
