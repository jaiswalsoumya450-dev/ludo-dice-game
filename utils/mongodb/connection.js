const mongoose = require('mongoose');
const fnMongoDBConnection = () => {
    return new Promise((resolve, reject) => {
        const options = {};


        mongoose.connect('mongodb://127.0.0.1:27017/db_practice', options)
            .then(() => {
                resolve();
            })
            .catch((error) => {
                reject(error);
            });

    });

};

module.exports = {fnMongoDBConnection};