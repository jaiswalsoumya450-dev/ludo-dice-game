const fnPreConditionFailed = (res, err = null) => {
    if (err) console.warn(err);
    return res.sendStatus(412);
};

const fnBadRequest = (res, err = null) => {
    if (err) console.warn(err);
    return res.sendStatus(400);
};

module.exports = {
    fnPreConditionFailed,
    fnBadRequest
};