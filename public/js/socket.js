"use strict";

const fnSocketConnect = ({token}) => {
    socket = io(SOCKET_BASE_URL, {
        path: SOCKET_PATH,
        forceNew: true,
        upgrade: true,
        transports: ["websocket"],
        query: { t: token }
    });

    socket.on('connect', () => {
        if (!socket.connected) return;
        online = 1;
        console.log("Socket connected successfully");
        $('#player-online').removeClass('text-danger').addClass("text-success");
    });

    socket.on('disconnect', () => {
        console.log("Socket disconnected");
        online = 0;
        $('#player-online').removeClass('text-success').addClass("text-danger");
    });

    socket.on("connect_error", (err) => {
        if (err && err.data && err.data.type == "authentication_error") window.location.href = "/web/login";
    });

    socket.on("userData", (data) => {
        console.log("userdata", data);
        fnSetPlayerData(data);
        if(!data._gameId){
            const localGameData = fnGetLocalGameData();
            if(localGameData && localGameData._id) data._gameId = localGameData._id;
        }

        scene = "home";
        fnChangeScene();
    });

    socket.on("gameInit", (gameData) => {
        try { 
            console.log("gameInit", gameData);
            const localGameData = fnGetLocalGameData();
            
            if(localGameData && localGameData._id == gameData._id) {
                if(localGameData.eStatus == "Finished" || localGameData.eStatus == "Destroyed" || localGameData.eStatus == "Abandoned") throw `already_game_$(localGameData.eStatus)`;
                else if (!localGameData) {
                if (tableData.eStatus == 'Finished' || tableData.eStatus == 'Destroyed' || tableData.eStatus == "Abandoned") throw `already_game_${localGameData.eStatus}`;
            }
            else {
                fnFlushLocalGameData();
            }

            const myId = localStorage.getItem("_id");

            if(gameData.eStatus == "Running") {
                if (scene != "gameplay"){
                    freshGameScene = 0;
                    scene = "gameplay";
                    _fnClearWaitingTimer();
                    fnChangeScene();
                }

                _fnSetGameHeaders(gameData);
                _fnSetPlayerPlacement(gameData, myId);
                _fnRematchButton(gameData.eStatus)
            }
            //when the game in searching for players
            else if (gameData.eStatus == "Waiting") {
                freshGameScene = 0;
                let host;
                if (scene != "search") {
                    scene = "search";
                    fnChangeScene();
                }

                //set game headers, the time, and the host and room mode
                _fnSetGameHeaders(gameData);

                if(!waiting_timer) {
                    const timer = fnGetWaitingTimer(tableData.eGameType, tableData.eRoomMode);
                    _fnStartWaitingTimer(timer);
                }

                if (tableData.host) host = fnRecuringJSONParse(tableData.host);

                if (tableData.eRoomMode == 'Private') {
                    $('#lk-pvt-code').html(`<span class="lk-pvt-code" >${tableData.vPrivateCode}</span>`);
                    if (tableData.iTotalPlayer >= 2 && (tableData._ownerId == myId || (host && host._userId == myId))) {
                        $('#lk-pvt-play').html(`<button class="btn btn-success" id="start-pvt-table"> Start </button>`);
                    } else {
                        $('#lk-pvt-play').text('');
                    }
                } else {
                    $('#lk-pvt-play').text('');
                    $('#lk-pvt-code').text('');
                }

                _fnSetSearchingPlayers(gameData.aPlayers, host);
                fnSetLocalPlayerData(gameData);

            }
            else if (gameData.eStatus == "Finished") {
                _fnSetPlayerPlacement(gameData, myId);
                fnSetLocalPlayerData(gameData);

            }
            else if (gameData.eStatus == "Destroyed" || gameData.eStatus == "Abandoned") {
                throw `game_$(gameData.eStatus)`;
            }
            }
        }
        catch (err) {
            console.log("err", err);
            scene = "home";
            fnChangeScene();
            _fnClearWaitingTimer();
            fnFlushLocalGameData();
        }
    })
}

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

const _fnClearWaitingTimer = (b = 40000, _hostId = null) => {
    try {
         const tempTimerInterval = 5000;
         _fnClearWaitingTimer();
         _fnWaitingTimer();
         waiting_timer = setTimer(_fnWaitingTimer, tempTimerInterval);

         function _fnWaitingTimer() {
            try {
                localStorage.setItem("waiting_time_left", b);
                b -= tempTimerInterval;
                _fnRefreshDisplayTimer(b);
                if (b > 0) return _fnWaitingTimer;
                localStorage.removeItem("waiting_time_left");
                _fnClearWaitingTimer();

                scene = "home";
                fnChangeScene();
            }
            catch (err) {
                console.log(err);
            }
         }
    }
    catch (err) {
        console.log(err);
    }
};

const _fnRefreshDisplayTimer = (time) => {
    tme = Math.floor(time/1000);
    const minutes = Math.floor(time/60);
    const seconds = time % 60;
    const timeText = `${(minutes < 10 ? "0" + minutes : minutes)}:${(seconds < 10 ? "0" + seconds : seconds)}`;
    $(`#scene-${scene} #lk-search-timer`).text(timeText);
}