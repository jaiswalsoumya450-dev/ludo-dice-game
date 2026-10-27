"use strict";

const express = require("express");
const request = require("supertest");
const validator = require("../../../middleware/validator");
const middleware = require("../../../middleware");

const appWith = (chain) => {
    const app = express();
    app.use(express.json());
    app.post("/t", chain, validator.fnValidationResult, (req, res) => res.json({ ok: true, body: req.body }));
    return app;
};

describe("middleware/index", () => {
    test("exports the validator and auth middleware", () => {
        expect(middleware.validator).toBe(validator);
        expect(middleware.userAuth).toBe(require("../../../middleware/auth"));
    });
});

describe("guestLogin validation", () => {
    const app = appWith(validator.guestLogin);

    test("passes with both fields", async () => {
        await request(app).post("/t").send({ did: "d1", sName: "A" }).expect(200);
    });

    test.each([
        ["missing did", { sName: "A" }],
        ["missing sName", { did: "d1" }],
        ["empty did", { did: "", sName: "A" }],
        ["empty sName", { did: "d1", sName: "" }],
        ["null did", { did: null, sName: "A" }],
        ["empty body", {}],
    ])("412 for %s", async (_, body) => {
        await request(app).post("/t").send(body).expect(412);
    });

    test("whitespace-only values pass (no trimming)", async () => {
        await request(app).post("/t").send({ did: " ", sName: "   " }).expect(200);
    });

    test("non-string values pass the notEmpty check", async () => {
        await request(app).post("/t").send({ did: 123, sName: true }).expect(200);
    });

    test("fields are also read from the query string", async () => {
        await request(app).post("/t?did=d1&sName=A").send({}).expect(200);
    });
});

describe("updateUser validation", () => {
    const app = appWith(validator.updateUser);

    test("an empty body is valid (everything optional)", async () => {
        await request(app).post("/t").send({}).expect(200);
    });

    test.each([
        [{ sImage: 5 }],
        [{ sImage: "5" }],
        [{ sName: "Bob", sImage: 1 }],
    ])("accepts %j", async (body) => {
        await request(app).post("/t").send(body).expect(200);
    });

    test.each([
        [{ sImage: "abc" }],
        [{ sImage: "" }],
        [{ sImage: ["x"] }],
    ])("412 for %j", async (body) => {
        await request(app).post("/t").send(body).expect(412);
    });

    test("an empty array slips past isNumeric (validators run per element)", async () => {
        await request(app).post("/t").send({ sImage: [] }).expect(200);
    });

    test("sName is not type-checked despite the 'must be a string' message", async () => {
        await request(app).post("/t").send({ sName: 12345 }).expect(200);
    });
});
