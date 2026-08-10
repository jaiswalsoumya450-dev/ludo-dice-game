"use strict";

const fnPubSearch = ({eventName, maxPlayer, lobbyId}) => {
    const data = fnAesEncrypt({
        maxPlayer,
        lobbyId
    });
    socket.emit(eventName, { data }, (response) => {
        response = fnAesDecrypt(response);
        const status = response.status || 404;

        if (status == 200) {
            const _gameId = response._gameId || null;
            if (_gameId) {
                $("#modal-pub").modal('hide');
                $('#popup-name').text(localStorage.getItem('sName'));

                scene = 'search';
                fnChangeScene();

                const timer = (response.waitingTimer || 30000) + 10000;
                localStorage.setItem('waiting_time_left', timer);
                _fnStartWaitingTimer(timer);
                return;
            }
        }

        const sType = getStatusText(status);
        const sText = response.message || 'Something went wrong';
        myNotification(sType, sText);
    });
};

const fnPriSearch = ({
    eventName,
    vPrivateCode,
    maxPlayer = 4,
    lobbyId = 100,
}) => {
    const data = fnAesEncrypt({ vPrivateCode, maxPlayer, lobbyId });

    socket.emit(eventName, { data }, (response) => {
        response = fnAesDecrypt(response);
        const status = response.status || 404;
        console.log(response);
        if (status == 200) {
            const _tableId = response._tableId || null;
            if (_tableId) {
                $('#popup-name').text(localStorage.getItem('sName'));
                scene = 'search';
                fnChangeScene();
                $("#modal-pri").modal('hide');
                const timer = (response.waitingTimer || 30000) + 10000;
                localStorage.setItem('waiting_time_left', timer);
                _fnStartWaitingTimer(timer);
                return;
            }
        }
        const sType = getStatusText(status);
        const sText = response.message || 'Something went wrong';
        myNotification(sType, sText);
    });
};

const _fnStartWaitingTimer = (b = 40000, _hostId = null) => {
    try {
        const tempTimerInterval = 5000;
        _fnClearWaitingTimer();
        _fnWaitingTimer();
        waiting_timer = setInterval(_fnWaitingTimer, tempTimerInterval);

        function _fnWaitingTimer() {
            try {
                localStorage.setItem('waiting_time_left', b);
                b -= tempTimerInterval;
                _fnRefreshDisplayTimer(b);
                if (b > 0) return _fnWaitingTimer;
                localStorage.removeItem('waiting_time_left');
                _fnClearWaitingTimer();

                if (_hostId) {
                    _fnTmntStartBtn();
                }
                else {
                    scene = 'home';
                    fnChangeScene();
                }

            } catch (err) {
                console.log(err);
            }
        };
    } catch (err) {
        console.log(err);
    }
};