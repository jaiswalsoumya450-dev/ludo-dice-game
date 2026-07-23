function fnGuestLogin(req, res) {
    try {
        const { did, sName } = req.body;
        console.log('Device ID:', did);
        console.log('Name:', sName);
        res.json({ success: true, did, sName });
    } catch (err) {
        res.json({ success: false, message: 'Something went wrong' });
    }
}

module.exports = { fnGuestLogin };