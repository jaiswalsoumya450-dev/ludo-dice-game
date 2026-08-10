const mongoose = require('mongoose');
const fnMongoDBConnection = () => {
    return new Promise((resolve, reject) => {
        const options = {};


        mongoose.connect(constants.MONGO_DB_URL, options)
            .then(() => {
                resolve();
            })
            .catch((error) => {
                reject(error);
            });

    });

};

module.exports = {fnMongoDBConnection};