"use strict";
/*
 *  Board socket, used for communicating whiteboard data.
 *
 *
 *
 *
 *
 */
var _this = this;
Object.defineProperty(exports, "__esModule", { value: true });
var colourTable = [
    0xFF0000, 0x00FF00, 0x0000FF, 0xFF00FF, 0xFF7F00,
    0x8C1717, 0x70DB93, 0x00FFFF, 0x5959AB, 0xDB9370,
    0x871F78, 0x238E23, 0x38B0DE, 0xCC3299, 0xB5A642,
    0x8E2323, 0x2F4F2F, 0x5F9F9F, 0x9932CD, 0xB87333,
    0x4F2F4F, 0x238E68, 0x236B8E, 0xDB70DB, 0xCFB53B,
    0x2F2F4F, 0x00FF7F, 0x007FFF, 0x8E236B, 0xDBDB70,
    0x9F9F5F, 0x99CC32, 0xADEAEA, 0xEBC79E, 0xCD7F32,
    0x527F76
];
var allowedFileTypes = [];
var app = require('express')();
var fs = require('fs');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var PHPUnserialize = require('php-unserialize');
var parseCookie = require('cookie-parser');
var mysql = require('mysql');
var typeCheck = require('check-types');
var dbHost = process.env.DATABASE_HOST;
var dbUser = process.env.DATABASE_USER;
var dbPass = process.env.DATABASE_PASSWORD;
if (dbHost == null || dbHost == undefined) {
    dbHost = '146.148.89.71';
    dbUser = 'whiteboard';
    dbPass = 'u;Fq>5QPqVvAhsCy';
}
console.log(dbHost);
var my_sql_pool = mysql.createPool({
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: 'Online_Comms',
    supportBigNumbers: true
});
var med_io = io.of('/media');
var bor_io = io.of('/board');
var PORT = process.argv[2];
if (PORT == null || PORT == undefined) {
    throw new Error('No port given.');
}
io.set('origins', 'http://127.0.0.1:8000');
app.use(parseCookie('7e501ffeb426888ea59e63aa15b931a7f9d28d24'));
/***************************************************************************************************************************************************************
 *  Media signalling server
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
var mediaConnData = {};
var connMediaUsers = {};
var notifyUser = function (client, socket, connection) {
    my_sql_pool.getConnection(function (err, connection) {
        if (err) {
            console.log('MEDIA: Error getting connection from pool: ' + err);
            return connection.release();
        }
        console.log('Querying ' + client);
        // Tell the new user about everyone else
        connection.query('USE Online_Comms', function (err) {
            if (err) {
                console.log('BOARD: Error while setting database schema. ' + err);
                return connection.release();
            }
            connection.query('SELECT User_Id, Username, Socket_ID FROM Room_Participants WHERE Socket_ID = ?', [client], function (err, rows) {
                if (err) {
                    console.log('MEDIA: Error querying session participants.' + err);
                    return connection.release();
                }
                if (rows[0] == null || rows[0] == undefined) {
                    console.log('MEDIA: Error querying session participants.');
                    return connection.release();
                }
                socket.emit('JOIN', rows[0].User_Id, rows[0].Username, rows[0].Socket_ID);
                return connection.release();
            });
        });
    });
};
var processJoinMed = function (socket, connection) {
    //Tell all those in the room that a new user joined
    med_io.to(mediaConnData[socket.id].roomId.toString()).emit('JOIN', mediaConnData[socket.id].userId, mediaConnData[socket.id].username, socket.id);
    if (med_io.adapter.rooms[mediaConnData[socket.id].roomId]) {
        var clients = med_io.adapter.rooms[mediaConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients) {
            (function (client) { setTimeout(notifyUser(client, socket, connection), 0); })(client);
        }
    }
    connection.release();
    //New user joins the specified room
    socket.join(mediaConnData[socket.id].roomId);
    mediaConnData[socket.id].isConnected = true;
    var currTime = new Date();
    setTimeout(function () {
        console.log('Session ending.');
        console.log((mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 600000) - currTime.getTime());
        socket.emit('SESSEND');
        socket.disconnect();
    }, (mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 600000) - currTime.getTime());
    setTimeout(function () {
        socket.emit('SESSWARN', 'Session ending in 5 minutes.');
    }, (mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 300000) - currTime.getTime());
    setTimeout(function () {
        socket.emit('SESSEND', 'Session ending in 1 minute.');
    }, (mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 540000) - currTime.getTime());
    socket.emit('CONNOK');
    clearTimeout(mediaConnData[socket.id].joinTimeout);
    console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' successfully joined room ' + mediaConnData[socket.id].roomId + '.');
};
var chkSessionMed = function (err, rows, fields, socket, connection) {
    if (err) {
        socket.emit('ERROR', 'DATABASE ERROR: Session Check. ' + err);
        console.log('MEDIA: Error while performing session query. ' + err);
        return connection.release();
    }
    if (rows[0] == null || rows[0] == undefined) {
        socket.emit('ERROR', 'DATABASE ERROR: Unexpected Result.');
        console.log('MEDIA: Session time produced an unexpected result.');
        return connection.release();
    }
    if (rows[0].Start_Time == null || rows[0].Start_Time == undefined || rows[0].Session_Length == null || rows[0].Session_Length == undefined) {
        socket.emit('ERROR', 'Session failed to start.');
        console.log('MEDIA: Session failed to start.');
        return connection.release();
    }
    // TODO: Add time checks.
    if (rows[0].Host_Join_Time) {
        mediaConnData[socket.id].startTime = rows[0].Start_Time;
        mediaConnData[socket.id].sessLength = rows[0].Session_Length * 1000;
        processJoinMed(socket, connection);
    }
    else {
        return connection.release();
    }
};
var chkParticipantMed = function (err, rows, fields, socket, connection) {
    if (err) {
        socket.emit('ERROR', 'DATABASE ERROR: Participant Check. ' + err);
        console.log('MEDIA: Error while performing participant query. ' + err);
        return connection.release();
    }
    if (rows[0] == null || rows[0] == undefined) {
        socket.emit('ERROR', 'User not allowed.');
        console.log('MEDIA: User not permitted to this session.');
        return connection.release();
    }
    connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [mediaConnData[socket.id].roomId], function (err, rows, fields) {
        chkSessionMed(err, rows, fields, socket, connection);
    });
};
var findRoomMed = function (err, rows, fields, socket, connection, roomToken) {
    if (err) {
        socket.emit('ERROR', 'DATABASE ERROR: Room Check. ' + err);
        console.log('MEDIA: Error while performing room query. ' + err);
        return connection.release();
    }
    if (rows[0] == null || rows[0] == undefined) {
        socket.emit('ERROR', 'Room does not exist.');
        console.log('MEDIA: Room ' + connection.escape(roomToken) + ' does not exist.');
        return connection.release();
    }
    mediaConnData[socket.id].roomId = rows[0].Room_ID;
    connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [mediaConnData[socket.id].roomId, mediaConnData[socket.id].userId], function (err, rows, fields) {
        chkParticipantMed(err, rows, fields, socket, connection);
    });
};
med_io.on('connection', function (socket) {
    var params = socket.handshake.query;
    if (!mediaConnData[socket.id]) {
        mediaConnData[socket.id] = {
            extra: [], isHost: false, isConnected: false, isJoining: false, ScalableBroadcast: false, roomId: 0, userId: 0, joinTimeout: null, startTime: null,
            sessLength: 0, username: ''
        };
    }
    console.log('MEDIA: User Connecting.....');
    var sessId = socket.handshake.query.sessId;
    if (!sessId) {
        console.error('MEDIA: ERROR: No session ID found in handshake.');
        return;
    }
    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    mediaConnData[socket.id].joinTimeout = setTimeout(function () {
        console.log('MEDIA: Connection Timeout.');
        socket.disconnect();
    }, 60000);
    my_sql_pool.getConnection(function (err, connection) {
        connection.query('USE Users');
        connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [sessId], function (err, rows) {
            if (err) {
                console.log('MEDIA: Error while performing session Query. ' + err);
                return connection.release();
            }
            if (rows[0] == null || rows[0] == undefined) {
                console.log('MEDIA: Session not found.');
                return connection.release();
            }
            var sessBuff = new Buffer(rows[0].Session_Data);
            var sessData = sessBuff.toString('utf-8');
            sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
            sessData = sessData.slice(0, sessData.indexOf(';'));
            mediaConnData[socket.id].userId = parseInt(sessData);
            if (connMediaUsers[mediaConnData[socket.id].userId]) {
                // TDOD Send message indicating reason
                if (connMediaUsers[mediaConnData[socket.id].userId] != socket.id) {
                    if (med_io.connected[connMediaUsers[mediaConnData[socket.id].userId]]) {
                        med_io.connected[connMediaUsers[mediaConnData[socket.id].userId]].disconnect();
                    }
                    connMediaUsers[mediaConnData[socket.id].userId] = socket.id;
                }
            }
            else {
                connMediaUsers[mediaConnData[socket.id].userId] = socket.id;
            }
            connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [mediaConnData[socket.id].userId], function (err, rows) {
                if (err) {
                    console.log('MEDIA: Error while performing user Query. ' + err);
                    return connection.release();
                }
                if (rows[0] == null || rows[0] == undefined || rows[0].Username == null || rows[0].Username == undefined) {
                    console.log('MEDIA: User ' + connection.escape(mediaConnData[socket.id].userId) + ' not found.');
                    return connection.release();
                }
                mediaConnData[socket.id].username = rows[0].Username;
                connection.query('USE Online_Comms');
                connection.query('UPDATE Room_Participants SET Socket_ID = ?, Username = ? WHERE User_ID = ?', [socket.id, mediaConnData[socket.id].username, mediaConnData[socket.id].userId], function (err, rows) {
                    if (err) {
                        console.log('MEDIA: Error setting socket ID in database.');
                        return connection.release();
                    }
                    socket.emit('READY', mediaConnData[socket.id].userId);
                    connection.release();
                    console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' passed initial connection.');
                });
            });
        });
    });
    /*
    if (params.enableScalableBroadcast)
    {
        if (!mediaConnData[socket.id].ScalableBroadcast)
        {
            mediaConnData[socket.id].ScalableBroadcast = require('./Scalable-Broadcast.js');
        }
        mediaConnData[socket.id].singleBroadcastAttendees = params.singleBroadcastAttendees;
        ScalableBroadcast(socket, mediaConnData[socket.id].singleBroadcastAttendees);
    }
    */
    socket.on('disconnect', function () {
        try {
            mediaConnData[socket.id].isConnected = false;
            clearTimeout(mediaConnData[socket.id].joinTimeout);
            console.log('MEDIA: User disconnected.');
        }
        catch (e) {
        }
        finally {
        }
    });
    socket.on('GETID', function (extra) {
        try {
            console.log('Notifying user ' + mediaConnData[socket.id].userId + ' of their ID.');
            socket.emit('USERID', mediaConnData[socket.id].userId);
        }
        catch (e) {
        }
    });
    socket.on('LEAVE', function () {
        if (mediaConnData[socket.id].isConnected) {
            try {
                var clients = io.sockets.adapter.rooms[mediaConnData[socket.id].roomId];
                for (var clientId in clients) {
                    var clientSocket = io.sockets.connected[clientId];
                    //Tell the new user about everyone else
                    clientSocket.emit('LEAVE', mediaConnData[socket.id].userId);
                }
                socket.leave(mediaConnData[socket.id].roomId.toString());
            }
            catch (e) {
            }
            finally {
            }
        }
    });
    socket.on('RTC-Message', function (message, callback) {
        if (mediaConnData[socket.id].isConnected) {
            try {
                console.log(socket.id + ' Fowarding message to ' + message.remoteId + " User ID: " + message.payload.userId);
                socket.broadcast.to(message.remoteId).emit(message.type, message.payload);
            }
            catch (e) {
            }
        }
    });
    socket.on('JOIN-ROOM', function (roomToken) {
        try {
            console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' joining room ' + roomToken + '.......');
            if (!mediaConnData[socket.id].isJoining) {
                mediaConnData[socket.id].isJoining = true;
                my_sql_pool.getConnection(function (err, connection) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function (err, rows, fields) {
                        findRoomMed(err, rows, fields, socket, connection, roomToken);
                    });
                });
            }
        }
        catch (e) {
            socket.emit('ERROR');
            socket.disconnect();
            console.log('MEDIA: Error while attempting join-room, Details: ' + e);
        }
        finally {
        }
    });
});
var boardConnData = {};
var connBoardUsers = {};
var roomUserList = [];
var roomUserCount = [];
var modes = [];
var components = [];
var registerComponent = function (modeName, ModeClass) {
    console.log('REGISTERING COMPONENT: ' + modeName);
    modes.push(modeName);
    components[modeName] = new ModeClass(roomUserList);
};
var normalizedPath = require("path").join(__dirname, "components");
var ComponentBase = require("./ComponentBase");
require("fs").readdirSync(normalizedPath).forEach(function (file) {
    if (file.endsWith('.js')) {
        require("./components/" + file)(registerComponent);
    }
});
var sendDataBor = function (socket) {
    my_sql_pool.getConnection(function (err, connection) {
        if (err) {
            console.log('BOARD: Error while getting pool connection. ' + err);
            return connection.release();
        }
        connection.query('USE Online_Comms', function (err) {
            if (err) {
                console.log('BOARD: Error while setting database schema. ' + err);
                return connection.release();
            }
            connection.query('SELECT * FROM Whiteboard_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while getting session elements. ' + err);
                    return connection.release();
                }
                // Send connecting user all data to date.
                var data = rows;
                var _loop_1 = function (i) {
                    my_sql_pool.getConnection(function (err, connection) {
                        if (err) {
                            console.log('BOARD: Error while getting pool connection. ' + err);
                            return connection.release();
                        }
                        connection.query('USE Online_Comms', function (err) {
                            if (err) {
                                console.log('BOARD: Error while setting database schema. ' + err);
                                return connection.release();
                            }
                            components[data[i].Type].sendData(data[i], socket, connection, boardConnData[socket.id]);
                        });
                    });
                };
                for (var i = 0; i < rows.length; i++) {
                    _loop_1(i);
                }
                return connection.release();
            });
        });
    });
};
var chkHost = function (err, rows, fields, socket, connection) {
    if (err) {
        console.log('BOARD: Error while performing tutor id query. ' + err);
        return connection.release();
    }
    if (rows[0] != null && rows[0] != undefined) {
        boardConnData[socket.id].isHost = true;
    }
    var currTime = new Date();
    // TODO: Remove debug code.
    var timeoutTime = (boardConnData[socket.id].startTime.getTime() + boardConnData[socket.id].sessLength + 600000) - currTime.getTime();
    console.log('Session length is: ' + boardConnData[socket.id].sessLength);
    console.log('Timeout set for: ' + timeoutTime);
    setTimeout(function () {
        console.log('BOARD: Session over.');
        socket.disconnect();
    }, (boardConnData[socket.id].startTime.getTime() + boardConnData[socket.id].sessLength + 600000) - currTime.getTime());
    boardConnData[socket.id].isConnected = true;
    socket.emit('CONNOK');
    clearTimeout(boardConnData[socket.id].joinTimeout);
    console.log('BOARD: User ' + boardConnData[socket.id].userId + ' successfully joined room ' + boardConnData[socket.id].roomId + '.');
    setTimeout(function () { sendDataBor(socket); }, 0);
    return connection.release();
};
var notifyBoardUser = function (client, socket) {
    var msg = { userId: boardConnData[client].userId, colour: roomUserList[boardConnData[client].roomId][boardConnData[client].userId] };
    socket.emit('JOIN', msg);
};
var endSession = function (id) {
    for (var i = 0; i < modes.length; i++) {
        var component = components[modes[i]];
        component.sessionEnd(boardConnData[id]);
    }
};
var processJoinBor = function (socket, connection) {
    var colour;
    if (!roomUserList[boardConnData[socket.id].roomId]) {
        roomUserList[boardConnData[socket.id].roomId] = [];
        roomUserCount[boardConnData[socket.id].roomId] = 0;
    }
    if (!roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId]) {
        colour = colourTable[roomUserCount[boardConnData[socket.id].roomId]++];
        console.log('BOARD: Room User Colour: ' + colour.toString(16));
        roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId] = colour;
    }
    else {
        colour = roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId];
    }
    boardConnData[socket.id].colour = colour;
    clearTimeout(boardConnData[socket.id].sessionTimeout);
    boardConnData[socket.id].sessionTimeout = setTimeout(endSession, boardConnData[socket.id].sessLength + 10000, socket.id);
    var msg = { userId: boardConnData[socket.id].userId, colour: colour };
    bor_io.to(boardConnData[socket.id].roomId.toString()).emit('JOIN', msg);
    if (bor_io.adapter.rooms[boardConnData[socket.id].roomId]) {
        var clients = bor_io.adapter.rooms[boardConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients) {
            (function (client) { setTimeout(notifyBoardUser(client, socket), 0); })(client);
        }
    }
    for (var i = 0; i < modes.length; i++) {
        var component = components[modes[i]];
        component.userJoin(socket, boardConnData[socket.id]);
    }
    my_sql_pool.getConnection(function (err, connection) {
        connection.query('USE Online_Comms', function (err) {
            if (err) {
                console.error("BOARD: Unable to log user connection. " + err);
                return connection.release();
            }
            connection.query('INSERT INTO Connection_Logs(User_ID, Room_ID, Type, Source) VALUES (?, ?, ?, ?)', [boardConnData[socket.id].userId, boardConnData[socket.id].roomId, 'CONNECT', 'BOARD'], function (err) {
                if (err) {
                    console.error("BOARD: Unable to log user connection. " + err);
                }
                connection.release();
            });
        });
    });
    connection.query('USE Tutoring', function (err) {
        if (err) {
            console.log('BOARD: Error while setting database schema. ' + err);
            return connection.release();
        }
        connection.query('SELECT Tutor_ID FROM Tutor_Session WHERE Room_ID = ? AND Tutor_ID = ?', [boardConnData[socket.id].roomId,
            boardConnData[socket.id].userId], function (err, rows, fields) {
            chkHost(err, rows, fields, socket, connection);
        });
    });
    //New user joins the specified room
    socket.join(boardConnData[socket.id].roomId.toString());
};
var chkSessionBor = function (err, rows, fields, socket, connection) {
    if (err) {
        socket.emit('ERROR', 'DATABASE ERROR: Session Check. ' + err);
        console.log('BOARD: Error while performing session query. ' + err);
        connection.release();
        socket.disconnect();
        return;
    }
    if (rows[0] == null || rows[0] == undefined) {
        socket.emit('ERROR', 'DATABASE ERROR: Unexpected Result.');
        console.log('BOARD: Session time produced an unexpected result.');
        connection.release();
        socket.disconnect();
        return;
    }
    if (rows[0].Start_Time == null || rows[0].Start_Time == undefined || rows[0].Session_Length == null || rows[0].Session_Length == undefined) {
        socket.emit('ERROR', 'Session failed to start.');
        console.log('BOARD: Session failed to start.');
        connection.release();
        socket.disconnect();
        return;
    }
    boardConnData[socket.id].startTime = rows[0].Start_Time;
    boardConnData[socket.id].sessLength = rows[0].Session_Length * 1000;
    // TODO: Add time checks.
    if (rows[0].Host_Join_Time) {
        processJoinBor(socket, connection);
    }
};
var chkParticipantBor = function (err, rows, fields, socket, connection) {
    if (err) {
        socket.emit('ERROR', 'DATABASE ERROR: Participant Check. ' + err);
        console.log('BOARD: Error while performing participant query. ' + err);
        connection.release();
        socket.disconnect();
        return;
    }
    if (rows[0] == null || rows[0] == undefined) {
        socket.emit('ERROR', 'User not allowed.');
        console.log('BOARD: User not permitted to this session.');
        connection.release();
        socket.disconnect();
        return;
    }
    connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [boardConnData[socket.id].roomId], function (err, rows, fields) {
        chkSessionBor(err, rows, fields, socket, connection);
    });
};
var findRoomBor = function (err, rows, fields, socket, connection, roomToken) {
    if (err) {
        socket.emit('ERROR', 'DATABASE ERROR: Room Check. ' + err);
        console.log('BOARD: Error while performing room query. ' + err);
        connection.release();
        socket.disconnect();
        return;
    }
    if (rows[0] == null || rows[0] == undefined) {
        socket.emit('ERROR', 'Room does not exist.');
        console.log('BOARD: Room ' + connection.escape(roomToken) + ' does not exist.');
        connection.release();
        socket.disconnect();
        return;
    }
    boardConnData[socket.id].roomId = rows[0].Room_ID;
    connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId], function (err, rows, fields) {
        chkParticipantBor(err, rows, fields, socket, connection);
    });
};
var cleanConnection = function (socketID, socket) {
    console.log('BOARD: Cleaning Connection....');
    boardConnData[socketID].cleanUp = true;
    for (var i = 0; i < modes.length; i++) {
        var component = components[modes[i]];
        component.handleClean(boardConnData[socketID], socket, my_sql_pool);
    }
};
var endConnection = function (socketID, socket) {
    console.log('BOARD: Ending Connection....');
    cleanConnection(socketID, socket);
    boardConnData[socketID].isConnected = false;
};
var handleDeleteMessages = function (serverIds, socket, connection, boardConnData) {
    var commitFunc = function (serverIds, connection, socket, boardConnData) {
        connection.commit(function (err) {
            if (err) {
                return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
            }
            var payload = [];
            for (var i = 0; i < serverIds.length; i++) {
                payload.push(serverIds[i]);
            }
            var msg = { header: ComponentBase.BaseMessageTypes.DELETE, payload: payload };
            var msgCont = {
                serverId: null, userId: boardConnData.userId, type: 'ANY', payload: msg
            };
            socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
            connection.release();
        });
    };
    var updateFunc = function (serverIds, connection, socket, boardConnData, commitCallback, index) {
        if (index === void 0) { index = 0; }
        if (index < serverIds.length) {
            connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverIds[index]], function (err, rows) {
                if (err) {
                    return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
                }
                updateFunc(serverIds, connection, socket, boardConnData, commitCallback, ++index);
            });
        }
        else {
            commitCallback(serverIds, connection, socket, boardConnData);
        }
    };
    if (boardConnData.isHost || boardConnData.allowAllEdit) {
        connection.beginTransaction(function (err) {
            if (err) {
                return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
            }
            updateFunc(serverIds, connection, socket, boardConnData, commitFunc);
        });
    }
    else if (boardConnData.allowUserEdit) {
        var selectFunc_1 = function (serverIds, updateList, connection, socket, boardConnData, index, resolvedList) {
            if (index === void 0) { index = 0; }
            if (resolvedList === void 0) { resolvedList = []; }
            if (index < serverIds.length) {
                connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverIds[index]], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing delete:findUser query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] != null && rows[0] != undefined) {
                        resolvedList.push(serverIds[index]);
                    }
                    selectFunc_1(serverIds, updateList, connection, socket, boardConnData, ++index, resolvedList);
                });
            }
            else {
                connection.beginTransaction(function (err) {
                    if (err) {
                        return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
                    }
                    updateFunc(resolvedList, connection, socket, boardConnData, commitFunc);
                });
            }
        };
    }
};
var handleRestoreMessages = function (serverIds, socket, connection, boardConnData) {
    var commitFunc = function (serverIds, connection, socket, boardConnData) {
        connection.commit(function (err) {
            if (err) {
                return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
            }
            var payload = [];
            for (var i = 0; i < serverIds.length; i++) {
                payload.push(serverIds[i]);
            }
            var msg = { header: ComponentBase.BaseMessageTypes.RESTORE, payload: payload };
            var msgCont = {
                serverId: null, userId: boardConnData.userId, type: 'ANY', payload: msg
            };
            socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
            connection.release();
        });
    };
    var updateFunc = function (serverIds, connection, socket, boardConnData, commitCallback, index) {
        if (index === void 0) { index = 0; }
        if (index < serverIds.length) {
            connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverIds[index]], function (err, rows) {
                if (err) {
                    return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
                }
                updateFunc(serverIds, connection, socket, boardConnData, commitCallback, ++index);
            });
        }
        else {
            commitCallback(serverIds, connection, socket, boardConnData);
        }
    };
    if (boardConnData.isHost || boardConnData.allowAllEdit) {
        connection.beginTransaction(function (err) {
            if (err) {
                return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
            }
            updateFunc(serverIds, connection, socket, boardConnData, commitFunc);
        });
    }
    else if (boardConnData.allowUserEdit) {
        var selectFunc_2 = function (serverIds, updateList, connection, socket, boardConnData, index, resolvedList) {
            if (index === void 0) { index = 0; }
            if (resolvedList === void 0) { resolvedList = []; }
            if (index < serverIds.length) {
                connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverIds[index]], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing restore:findUser query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] != null && rows[0] != undefined) {
                        resolvedList.push(serverIds[index]);
                    }
                    selectFunc_2(serverIds, updateList, connection, socket, boardConnData, ++index, resolvedList);
                });
            }
            else {
                connection.beginTransaction(function (err) {
                    if (err) {
                        return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
                    }
                    updateFunc(resolvedList, connection, socket, boardConnData, commitFunc);
                });
            }
        };
    }
};
var handleMoveMessages = function (messages, socket, connection, boardConnData) {
    var self = _this;
    console.log('Received Move Curves Event.');
    var updateList = [];
    for (var i = 0; i < messages.length; i++) {
        var item = [messages[i].x, messages[i].y, messages[i].id];
        updateList.push(item);
    }
    if (boardConnData.isHost || boardConnData.allowAllEdit) {
        handleMoves(updateList, connection, socket, boardConnData);
    }
    else if (boardConnData.allowUserEdit) {
        var selectFunc_3 = function (messages, updateList, connection, socket, boardConnData, index, resolvedList) {
            if (index === void 0) { index = 0; }
            if (resolvedList === void 0) { resolvedList = []; }
            if (index < messages.length) {
                connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [messages[index].id], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing move:findUser query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] != null && rows[0] != undefined) {
                        resolvedList.push(updateList[index]);
                    }
                    selectFunc_3(messages, updateList, connection, socket, boardConnData, ++index, resolvedList);
                });
            }
            else {
                handleMoves(resolvedList, connection, socket, boardConnData);
            }
        };
    }
};
var handleMoves = function (updates, connection, socket, boardConnData) {
    var commitFunc = function (updates, connection, socket, boardConnData) {
        connection.commit(function (err) {
            if (err) {
                return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
            }
            var payload = [];
            for (var i = 0; i < updates.length; i++) {
                payload.push({ id: updates[i][2], x: updates[i][0], y: updates[i][1], editTime: new Date() });
            }
            var msg = { header: ComponentBase.BaseMessageTypes.MOVE, payload: payload };
            var msgCont = {
                serverId: null, userId: boardConnData.userId, type: 'ANY', payload: msg
            };
            socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
            connection.release();
        });
    };
    var updateFunc = function (updates, connection, socket, boardConnData, commitCallback, index) {
        if (index === void 0) { index = 0; }
        if (index < updates.length) {
            connection.query('UPDATE Whiteboard_Space SET X_Loc = ?, Y_Loc = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', updates[index], function (err, rows) {
                if (err) {
                    return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
                }
                updateFunc(updates, connection, socket, boardConnData, commitCallback, ++index);
            });
        }
        else {
            commitCallback(updates, connection, socket, boardConnData);
        }
    };
    connection.beginTransaction(function (err) {
        if (err) {
            return connection.rollback(function () { console.error('BOARD: ' + err); connection.release(); });
        }
        updateFunc(updates, connection, socket, boardConnData, commitFunc);
    });
};
/***************************************************************************************************************************************************************
 *  Board socket, used for communicating whiteboard data.
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
bor_io.on('connection', function (socket) {
    if (!boardConnData[socket.id]) {
        boardConnData[socket.id] = {
            isHost: false, isConnected: false, isJoining: false, allowUserEdit: true, cleanUp: false, sessId: 0, roomId: 0, userId: 0,
            joinTimeout: null, startTime: null, sessLength: 0, username: '', colour: 0, allowAllEdit: false, sessionTimeout: null
        };
    }
    console.log('BOARD: User Connecting.....');
    boardConnData[socket.id].sessId = socket.handshake.query.sessId;
    boardConnData[socket.id].cleanUp = false;
    if (!boardConnData[socket.id].sessId) {
        console.error('BOARD: ERROR: No session ID found in handshake.');
        return;
    }
    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    boardConnData[socket.id].joinTimeout = setTimeout(function () {
        console.log('BOARD: Connection Timeout.');
        socket.disconnect();
    }, 60000);
    console.log('Setting up listeners');
    socket.on('disconnect', function () {
        try {
            clearTimeout(boardConnData[socket.id].joinTimeout);
            my_sql_pool.getConnection(function (err, connection) {
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.error("BOARD: Unable to log user disconnect. " + err);
                        return connection.release();
                    }
                    connection.query('INSERT INTO Connection_Logs(User_ID, Room_ID, Type, Source) VALUES (?, ?, ?, ?)', [boardConnData[socket.id].userId, boardConnData[socket.id].roomId, 'DISCONNECT', 'BOARD'], function (err) {
                        if (err) {
                            console.error("BOARD: Unable to log user disconnect. " + err);
                        }
                        connection.release();
                    });
                });
            });
            if (boardConnData[socket.id].isConnected) {
                console.log('Setting connection clean callback.');
                boardConnData[socket.id].disconnectTimeout = setTimeout(endConnection, 5000, socket.id, socket);
                // Let components handle disconnect.
                for (var i = 0; i < modes.length; i++) {
                    var component = components[modes[i]];
                    component.handleDisconnect(boardConnData[socket.id], my_sql_pool);
                }
            }
            console.log('BOARD: User disconnected.');
        }
        catch (e) {
            console.error('BOARD: Error disconnecting: ' + e);
        }
        finally {
        }
    });
    socket.on('JOIN-ROOM', function (roomToken) {
        try {
            console.log('BOARD: User ' + boardConnData[socket.id].userId + ' joining room ' + roomToken + '.......');
            if (boardConnData[socket.id].isConnected) {
                clearTimeout(boardConnData[socket.id].disconnectTimeout);
                // Let components handle reconnect.
                for (var i = 0; i < modes.length; i++) {
                    var component = components[modes[i]];
                    component.handleReconnect(boardConnData[socket.id], socket, my_sql_pool);
                }
            }
            else {
                if (boardConnData[socket.id].isJoining) {
                    return;
                }
                boardConnData[socket.id].isJoining = true;
                my_sql_pool.getConnection(function (err, connection) {
                    connection.query('USE Online_Comms', function (err) {
                        if (err) {
                            console.log('BOARD: Error while setting database schema. ' + err);
                            return connection.release();
                        }
                        connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function (err, rows, fields) {
                            findRoomBor(err, rows, fields, socket, connection, roomToken);
                        });
                    });
                });
            }
        }
        catch (e) {
            socket.emit('ERROR', 'Failed to join session due to server error.');
            socket.disconnect();
            console.log('BOARD: Error while attempting join-room, Details: ' + e);
        }
        finally {
        }
    });
    socket.on('LEAVE', function () {
        if (boardConnData[socket.id].isConnected) {
            try {
                console.log('Received leave.');
                endConnection(socket.id, socket);
                socket.leave(boardConnData[socket.id].roomId.toString());
            }
            catch (e) {
            }
            finally {
            }
        }
    });
    socket.on('NEW-ELEMENT', function (data) {
        if (typeof (data.payload.localId) == 'undefined' || !boardConnData[socket.id].allowUserEdit) {
            return;
        }
        my_sql_pool.getConnection(function (err, connection) {
            if (err) {
                console.log('BOARD: Error getting database connection.');
                return;
            }
            connection.query('USE Online_Comms', function (err) {
                if (err) {
                    console.log('BOARD: Error while setting database schema. ' + err);
                    return connection.release();
                }
                connection.beginTransaction(function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing new element query.' + err);
                        return connection.rollback(function () { connection.release(); });
                    }
                    var message = data.payload;
                    var insertData = [
                        data.type, boardConnData[socket.id].roomId, boardConnData[socket.id].userId,
                        message.localId, message.x, message.y, message.width, message.height, 0,
                        message.editLock ? boardConnData[socket.id].userId : null
                    ];
                    connection.query('INSERT INTO Whiteboard_Space(' + ComponentBase.SQLElementInsertQuery + ') ' +
                        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', insertData, function (err, result) {
                        if (err) {
                            console.log('BOARD: Error while performing new element query.' + err);
                            return connection.rollback(function () { connection.release(); });
                        }
                        if (components[data.type]) {
                            components[data.type].handleNew(message, result.insertId, socket, connection, boardConnData[socket.id], my_sql_pool);
                        }
                        else {
                            console.log('BOARD: Unrecognized componenet type.');
                            return connection.rollback(function () { connection.release(); });
                        }
                    });
                });
            });
        });
    });
    socket.on('MSG-COMPONENT', function (data) {
        if (components[data.type] == undefined || components[data.type] == null) {
            console.log('BOARD: Unrecognized componenet type.');
            return;
        }
        my_sql_pool.getConnection(function (err, connection) {
            if (err) {
                console.log('BOARD: Error getting database connection.');
                return;
            }
            connection.query('USE Online_Comms', function (err) {
                if (err) {
                    console.log('BOARD: Error while setting database schema. ' + err);
                    return connection.release();
                }
                if (data.type == 'ANY') {
                    var message = data.payload;
                    switch (message.header) {
                        case ComponentBase.BaseMessageTypes.DELETE:
                            var delServerIds = message.payload;
                            if (delServerIds.length > 0) {
                                handleDeleteMessages(delServerIds, socket, connection, boardConnData[socket.id]);
                            }
                            break;
                        case ComponentBase.BaseMessageTypes.RESTORE:
                            var resServerIds = message.payload;
                            if (resServerIds.length > 0) {
                                handleRestoreMessages(resServerIds, socket, connection, boardConnData[socket.id]);
                            }
                            break;
                        case ComponentBase.BaseMessageTypes.MOVE:
                            var moveMessages = message.payload;
                            handleMoveMessages(moveMessages, socket, connection, boardConnData[socket.id]);
                            break;
                        default:
                            break;
                    }
                }
                else {
                    components[data.type].handleMessage(data.payload, data.id, socket, connection, boardConnData[socket.id], my_sql_pool);
                }
            });
        });
    });
    socket.on('UNKNOWN-ELEMENT', function (data) {
        my_sql_pool.getConnection(function (err, connection) {
            if (err) {
                console.log('BOARD: Error getting database connection.');
                return;
            }
            connection.query('USE Online_Comms', function (err) {
                if (err) {
                    console.log('BOARD: Error while setting database schema. ' + err);
                    return connection.release();
                }
                components[data.type].handleUnknownMessage(data.id, socket, connection, boardConnData[socket.id]);
            });
        });
    });
    console.log('Finished with listeners.');
    my_sql_pool.getConnection(function (err, connection) {
        console.log('Tried getting connection.');
        if (err) {
            console.log('BOARD: Error getting connection from pool. ' + err);
            return;
        }
        connection.query('USE Users', function (err) {
            if (err) {
                console.log('BOARD: Error while setting database schema. ' + err);
                return connection.release();
            }
            connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [boardConnData[socket.id].sessId], function (err, rows) {
                if (err) {
                    console.log('BOARD: Error while performing session Query. ' + err);
                    return connection.release();
                }
                if (rows[0] == null || rows[0] == undefined) {
                    console.log('BOARD: Session not found.');
                    return connection.release();
                }
                var sessBuff = new Buffer(rows[0].Session_Data);
                var sessData = sessBuff.toString('utf-8');
                sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
                sessData = sessData.slice(0, sessData.indexOf(';'));
                boardConnData[socket.id].userId = parseInt(sessData);
                if (connBoardUsers[boardConnData[socket.id].userId]) {
                    // TDOD Send message indicating reason
                    if (connBoardUsers[boardConnData[socket.id].userId] != socket.id) {
                        if (bor_io.connected[connBoardUsers[boardConnData[socket.id].userId]]) {
                            bor_io.connected[connBoardUsers[boardConnData[socket.id].userId]].disconnect();
                        }
                        connBoardUsers[boardConnData[socket.id].userId] = socket.id;
                    }
                }
                else {
                    connBoardUsers[boardConnData[socket.id].userId] = socket.id;
                }
                connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [boardConnData[socket.id].userId], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing user Query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] == null || rows[0] == undefined || rows[0].Username == null || rows[0].Username == undefined) {
                        console.log('BOARD: User ' + connection.escape(boardConnData[socket.id].userId) + ' not found.');
                        return connection.release();
                    }
                    boardConnData[socket.id].username = rows[0].Username;
                    socket.emit('READY', boardConnData[socket.id].userId);
                    console.log('BOARD: User ' + boardConnData[socket.id].userId + ' passed initial connection.');
                    connection.release();
                });
            });
        });
    });
});
// Amazon Code
/*
let reqOpt = '169.254.169.254/latest/meta-data/public-hostname';
*/
// Google code
var reqOpt = 'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip';
var endPointAddr;
var zone;
var checkServers = function (err, rows, connection) {
    if (err) {
        console.log('Error registering server in list. ' + err);
        return;
    }
    if (rows[0] == null || rows[0] == undefined) {
        connection.query('INSERT INTO Tutorial_Servers(End_Point, Zone, Port) VALUES(?, ?, ?) ', [endPointAddr, zone, PORT], function (err, rows) {
            if (err) {
                console.log('Error registering server in list. ' + err);
                return connection.release();
            }
            http.listen(PORT, function () {
                console.log("Server listening at", "*:" + PORT);
            });
            http.on('request', function (req, res) {
                console.log("Got request.");
                if (parseInt(req.url.split('ServerCheck=').pop().split('&')[0]) == 1) {
                    console.log("Got check message.");
                    res.setHeader("Server-Check", "1");
                    res.end();
                }
            });
            connection.release();
        });
        return;
    }
    console.log('Server already in list.');
    http.listen(PORT, function () {
        console.log("Server listening at", "*:" + PORT);
    });
    http.on('request', function (req, res) {
        console.log("Got server check request.");
        if (parseInt(req.url.split('ServerCheck=').pop().split('&')[0]) == 1) {
            console.log("Got check message.");
            res.setHeader("server-check", "1");
            res.end();
        }
    });
    connection.release();
};
var getServerData = function (chunk) {
    var chunkString = chunk + '';
    console.log('Zone: ' + chunkString.split('/').pop());
    zone = chunkString.split('/').pop();
    my_sql_pool.getConnection(function (err, connection) {
        if (err) {
            console.log('BOARD: Error getting connection from pool. ' + err);
            return;
        }
        var qStr;
        console.log('Adding to server list.......');
        connection.query('USE Online_Comms', function (err) {
            if (err) {
                console.log('BOARD: Error while setting database schema. ' + err);
                return connection.release();
            }
            connection.query('SELECT * FROM Tutorial_Servers WHERE End_Point = ? AND Port = ?', [endPointAddr, PORT], function (err, rows) {
                if (err) {
                    console.log('Error registering server in list. ' + err);
                    return connection.release();
                }
                checkServers(err, rows, connection);
            });
        });
    });
};
var options = {
    hostname: 'metadata.google.internal',
    port: 80,
    path: '/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip',
    method: 'GET',
    headers: {
        'Metadata-Flavor': 'Google'
    }
};
var req = require('http').request(options, function (res) {
    console.log("Got response for end point request: " + res.statusCode);
    res.on('data', function (chunk) {
        if (res.statusCode == 200) {
            console.log('End Point: ' + chunk);
            endPointAddr = chunk;
            // Amazon Code
            /*
            reqOpt = '169.254.169.254/latest/meta-data/placement/availability-zone';
            */
            // Google code
            options = {
                hostname: 'metadata.google.internal',
                port: 80,
                path: '/computeMetadata/v1/instance/zone',
                method: 'GET',
                headers: {
                    'Metadata-Flavor': 'Google'
                }
            };
            var req2 = require('http').request(options, function (res) {
                console.log("Got response for zone: " + res.statusCode);
                if (res.statusCode == 200) {
                    res.on('data', getServerData);
                }
                else {
                    // TODO: Error out.
                }
            });
            req2.on('error', function (e) {
                console.log("Error retrieving server zone: " + e.message);
            });
            req2.end();
        }
    });
});
req.on("error", function (e) {
    console.error("Error retrieving server end point: " + e.message);
});
req.end();
