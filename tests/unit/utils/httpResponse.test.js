"use strict";

const httpResponse = require("../../../utils/httpResponse");

const mockRes = () => ({ sendStatus: jest.fn(function () { return this; }) });

describe("httpResponse", () => {
    let warn;
    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    test.each([
        ["fnPreConditionFailed", 412],
        ["fnBadRequest", 400],
    ])("%s sends %i and returns the response", (fn, status) => {
        const res = mockRes();
        expect(httpResponse[fn](res)).toBe(res);
        expect(res.sendStatus).toHaveBeenCalledWith(status);
        expect(warn).not.toHaveBeenCalled();
    });

    test.each(["fnPreConditionFailed", "fnBadRequest"])("%s logs the error when one is given", (fn) => {
        const err = new Error("why");
        httpResponse[fn](mockRes(), err);
        expect(warn).toHaveBeenCalledWith(err);
    });
});
