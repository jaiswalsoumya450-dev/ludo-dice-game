module.exports = {
    'NODE_ENV': process.env.NODE_ENV,
    'PORT': process.env.PORT,
    'LOCAL_IP': process.env.LOCAL_IP,
    'MONGO_DB_URL': process.env.MONGO_DB_URL,
    'CODE_VERSION': process.env.CODE_VERSION,
    'JWT_SECRET': process.env.JWT_SECRET || 'dev_secret_change_in_prod'
};