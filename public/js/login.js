"use strict";

$(document).ready(function () {

    //if token n id are there refreshing will stay logged in
    if (localStorage.getItem('token') && localStorage.getItem('_id')) {
        window.location.href = '/web/main';
        return;
    }

    $(document).on('submit', '#guest_login', fnGuestLogin);

    function fnGuestLogin() {
        let did = $("#guest_login #did").val().trim();
        let sName = $("#guest_login #sName").val().trim();

        if (!did) {
            $('#message').css('color', 'red').text('Device ID is required.');
            return;
        }
        if (!sName) {
            $('#message').css('color', 'red').text('Name is required.');
            return;
        }

        $.ajax({
            url: `${API_BASE_URL}/api/v1/auth/guest`,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ did, sName }),
            success: function (result) {
                localStorage.setItem('token', result.token); //token from header
                localStorage.setItem('_id',   result._id);
                localStorage.setItem('sName', result.sName);
                localStorage.setItem('did',   result.did);
                localStorage.setItem('chips', result.chips);
                window.location.href = '/web/main';
            },

            error: function (err) {
                console.error("Error:", err);
                $('#message').css('color', 'red').text('Something went wrong.');
            }
        });
    }

    $('#guest_login input').keypress(function (e) {
        if (e.which == 13) fnGuestLogin();
    });

});