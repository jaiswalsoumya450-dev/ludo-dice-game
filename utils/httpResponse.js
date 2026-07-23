const fnPreConditionFailed = (res, err = null) => {
    if (err) console.warn(err);
    return res.sendStatus(412);
};

module.exports = {
    fnPreConditionFailed
};