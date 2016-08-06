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
var urlMod = require('url');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();
var app = require('express')();
var fs = require('fs');
var privateKey = fs.readFileSync('/var/www/web/fake-keys/privatekey.key').toString();
var certificate = fs.readFileSync('/var/www/web/fake-keys/certificate.pem').toString();
var credentials = { key: privateKey, cert: certificate };
var https = require('https').Server(credentials, app);
var io = require('socket.io')(https);
var PHPUnserialize = require('php-unserialize');
var parseCookie = require('cookie-parser');
var mysql = require('mysql');
var uuid = require('node-uuid');
var dbHost = process.env.DATABASE_HOST;
var dbUser = process.env.DATABASE_USER;
var dbPass = process.env.DATABASE_PASSWORD;
var my_sql_pool = mysql.createPool({
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: 'Online_Comms'
});
var med_io = io.of('/media');
var bor_io = io.of('/board');
app.use(parseCookie('7e501ffeb426888ea59e63aa15b931a7f9d28d24'));
var mediaConnData = {};
var connMediaUsers = {};
var notifyUser = function (client, socket, connection) {
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            console.log('Querying ' + client);
            connection.query('USE Online_Comms');
            connection.query('SELECT User_Id, Username, Socket_ID FROM Room_Participants WHERE Socket_ID = ?', [client], function (err, rows) {
                if (!err) {
                    if (rows[0]) {
                        socket.emit('JOIN', rows[0].User_Id, rows[0].Username, rows[0].Socket_ID);
                    }
                    else {
                        console.log('MEDIA: HERE. Error querying session participants.');
                        return;
                    }
                }
                else {
                    console.log('MEDIA: Error querying session participants.' + err);
                    return;
                }
                connection.release();
            });
        }
        else {
            console.log('MEDIA: Error getting connection from pool: ' + err);
        }
    });
};
var processJoinMed = function (socket, connection) {
    med_io.to(mediaConnData[socket.id].roomId.toString()).emit('JOIN', mediaConnData[socket.id].userId, mediaConnData[socket.id].username, socket.id);
    if (med_io.adapter.rooms[mediaConnData[socket.id].roomId]) {
        var clients = med_io.adapter.rooms[mediaConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients) {
            (function (client) { setTimeout(notifyUser(client, socket, connection), 0); })(client);
        }
    }
    connection.release();
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
    if (!err) {
        if (rows[0]) {
            if (rows[0].Start_Time && rows[0].Session_Length) {
                if (rows[0].Host_Join_Time) {
                    mediaConnData[socket.id].startTime = rows[0].Start_Time;
                    mediaConnData[socket.id].sessLength = rows[0].Session_Length * 1000;
                    processJoinMed(socket, connection);
                }
            }
            else {
                socket.emit('ERROR', 'Session failed to start.');
                console.log('MEDIA: Session failed to start.');
                socket.disconnect();
                connection.release();
                return;
            }
        }
        else {
            socket.emit('ERROR', 'DATABASE ERROR: Unexpected Result.');
            console.log('MEDIA: Session time produced an unexpected result.');
            socket.disconnect();
            connection.release();
            return;
        }
    }
    else {
        socket.emit('ERROR', 'DATABASE ERROR: Session Check. ' + err);
        console.log('MEDIA: Error while performing session query. ' + err);
        socket.disconnect();
        connection.release();
        return;
    }
};
var chkParticipantMed = function (err, rows, fields, socket, connection) {
    if (!err) {
        if (rows[0]) {
            connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [mediaConnData[socket.id].roomId], function (err, rows, fields) {
                chkSessionMed(err, rows, fields, socket, connection);
            });
        }
        else {
            socket.emit('ERROR', 'User not allowed.');
            console.log('MEDIA: User not permitted to this session.');
            socket.disconnect();
            connection.release();
            return;
        }
    }
    else {
        socket.emit('ERROR', 'DATABASE ERROR: Participant Check. ' + err);
        console.log('MEDIA: Error while performing participant query. ' + err);
        socket.disconnect();
        connection.release();
        return;
    }
};
var findRoomMed = function (err, rows, fields, socket, connection, roomToken) {
    if (!err) {
        if (rows[0]) {
            mediaConnData[socket.id].roomId = rows[0].Room_ID;
            connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [mediaConnData[socket.id].roomId, mediaConnData[socket.id].userId], function (err, rows, fields) {
                chkParticipantMed(err, rows, fields, socket, connection);
            });
        }
        else {
            socket.emit('ERROR', 'Room does not exist.');
            console.log('MEDIA: Room ' + connection.escape(roomToken) + ' does not exist.');
            socket.disconnect();
            connection.release();
            return;
        }
    }
    else {
        socket.emit('ERROR', 'DATABASE ERROR: Room Check. ' + err);
        console.log('MEDIA: Error while performing room query. ' + err);
        socket.disconnect();
        connection.release();
        return;
    }
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
    mediaConnData[socket.id].joinTimeout = setTimeout(function () {
        console.log('MEDIA: Connection Timeout.');
        socket.disconnect();
    }, 60000);
    my_sql_pool.getConnection(function (err, connection) {
        connection.query('USE Users');
        connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [sessId], function (err, rows) {
            if (!err) {
                if (rows[0]) {
                    var sessBuff = new Buffer(rows[0].Session_Data);
                    var sessData = sessBuff.toString('utf-8');
                    sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
                    sessData = sessData.slice(0, sessData.indexOf(';'));
                    mediaConnData[socket.id].userId = parseInt(sessData);
                    if (connMediaUsers[mediaConnData[socket.id].userId]) {
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
                        if (!err) {
                            if (rows[0] && rows[0].Username) {
                                mediaConnData[socket.id].username = rows[0].Username;
                                connection.query('USE Online_Comms');
                                connection.query('UPDATE Room_Participants SET Socket_ID = ?, Username = ? WHERE User_ID = ?', [socket.id, mediaConnData[socket.id].username, mediaConnData[socket.id].userId], function (err, rows) {
                                    if (!err) {
                                        socket.emit('READY', mediaConnData[socket.id].userId);
                                        connection.release();
                                        console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' passed initial connection.');
                                    }
                                    else {
                                        connection.release();
                                        socket.disconnect();
                                        console.log('MEDIA: Error setting socket ID in database.');
                                        return;
                                    }
                                });
                            }
                            else {
                                connection.release();
                                socket.disconnect();
                                console.log('MEDIA: User ' + connection.escape(mediaConnData[socket.id].userId) + ' not found.');
                                return;
                            }
                        }
                        else {
                            connection.release();
                            socket.disconnect();
                            console.log('MEDIA: Error while performing user Query. ' + err);
                            return;
                        }
                    });
                }
                else {
                    connection.release();
                    socket.disconnect();
                    console.log('MEDIA: Session not found.');
                    return;
                }
            }
            else {
                connection.release();
                socket.disconnect();
                console.log('MEDIA: Error while performing session Query. ' + err);
                return;
            }
        });
    });
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
var sendStyle = function (nodeData, textId, socket) {
    console.log('Sending user stylenode.');
    var msg = {
        serverId: textId, num: nodeData.Seq_Num, text: nodeData.Text_Data, colour: nodeData.Colour, weight: nodeData.Weight, decoration: nodeData.Decoration,
        style: nodeData.Style, start: nodeData.Start, end: nodeData.End, userId: 0, editId: 0
    };
    socket.emit('STYLENODE', msg);
};
var sendText = function (textData, socket) {
    var msg = { userId: 0, serverId: textData.Entry_ID, editId: 0, num_nodes: textData.Num_Style_Nodes, editTime: textData.Edit_Time };
    socket.emit('EDIT-TEXT', msg);
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            connection.query('USE Online_Comms');
            connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?', [textData.Entry_ID], function (perr, prows, pfields) {
                if (perr) {
                    console.log('BOARD: Error while performing existing style nodes query. ' + perr);
                }
                else {
                    var i;
                    for (i = 0; i < prows.length; i++) {
                        (function (data, textId) { setTimeout(function () { sendStyle(data, textId, socket); }, 100); })(prows[i], textData.Entry_ID);
                    }
                }
                connection.release();
            });
        }
        else {
            console.log('BOARD: Error while getting database connection to send curve. ' + err);
            connection.release();
        }
    });
};
var sendPoint = function (pointData, socket) {
    var msg = { serverId: pointData.Entry_ID, num: pointData.Seq_Num, x: pointData.X_Loc, y: pointData.Y_Loc };
    socket.emit('POINT', msg);
};
var sendCurve = function (curveData, socket) {
    var msg = {
        serverId: curveData.Entry_ID, num_points: curveData.Num_Control_Points, colour: curveData.Colour, userId: curveData.User_ID, size: curveData.Size,
        x: curveData.X_Loc, y: curveData.Y_Loc, width: curveData.Width, height: curveData.Height, editTime: curveData.Edit_Time
    };
    socket.emit('CURVE', msg);
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            connection.query('USE Online_Comms');
            connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [curveData.Entry_ID], function (perr, prows, pfields) {
                if (perr) {
                    console.log('BOARD: Error while performing existing control point query. ' + perr);
                }
                else {
                    var i;
                    for (i = 0; i < prows.length; i++) {
                        (function (data) { setTimeout(function () { sendPoint(data, socket); }, 0); })(prows[i]);
                    }
                }
                connection.release();
            });
        }
        else {
            console.log('BOARD: Error while getting database connection to send curve. ' + err);
            connection.release();
        }
    });
};
var sendDataBor = function (socket) {
    my_sql_pool.getConnection(function (err, connection) {
        connection.query('USE Online_Comms');
        connection.query('SELECT * FROM Whiteboard_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function (err, rows, fields) {
            if (err) {
                connection.release();
                console.log('BOARD: Error while performing existing curve query. ' + err);
            }
            else {
                var i;
                var data = rows;
                for (i = 0; i < rows.length; i++) {
                    (function (data, i) { setTimeout(function () { sendCurve(data[i], socket); }, i * 5); })(data, i);
                }
                connection.query('SELECT * FROM Text_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function (err, rows, fields) {
                    if (err) {
                        connection.release();
                        console.log('BOARD: Error while performing existing text query. ' + err);
                    }
                    else {
                        for (i = 0; i < rows.length; i++) {
                            var msg = {
                                serverId: rows[i].Entry_ID, userId: rows[i].User_ID, size: rows[i].Size, x: rows[i].Pos_X, editCount: 0,
                                y: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, editLock: rows[i].Edit_Lock, justified: rows[i].Justified,
                                editTime: rows[i].Edit_Time
                            };
                            socket.emit('TEXTBOX', msg);
                            (function (data, i) { setTimeout(function () { sendText(data[i], socket); }, i * 5 + 100); })(rows, i);
                        }
                        connection.query('SELECT * FROM Upload_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function (err, rows, fields) {
                            if (err) {
                                connection.release();
                                console.log('BOARD: Error while performing existing file query. ' + err);
                            }
                            else {
                                for (i = 0; i < rows.length; i++) {
                                    var fExt = '';
                                    if (rows[i].Content_URL) {
                                        fExt = rows[i].Content_URL.split('.').pop();
                                    }
                                    var msg = {
                                        serverId: rows[i].Entry_ID, userId: rows[i].User_ID, x: rows[i].Pos_X, fileDesc: rows[i].File_Description,
                                        y: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, url: rows[i].Content_URL, fileType: rows[i].File_Type,
                                        extension: fExt, rotation: rows[i].Rotation, editTime: rows[i].Edit_Time
                                    };
                                    socket.emit('FILE-START', msg);
                                }
                                connection.release();
                            }
                        });
                    }
                });
            }
        });
    });
};
var chkHost = function (err, rows, fields, socket, connection) {
    if (err) {
        console.log('BOARD: Error while performing tutor id query. ' + err);
    }
    else {
        if (rows[0]) {
            boardConnData[socket.id].isHost = true;
        }
        var currTime = new Date();
        setTimeout(function () {
            console.log('BOARD: Session over.');
            socket.disconnect();
        }, (boardConnData[socket.id].startTime.getTime() + boardConnData[socket.id].sessLength + 600000) - currTime.getTime());
        boardConnData[socket.id].isConnected = true;
        socket.emit('CONNOK');
        clearTimeout(boardConnData[socket.id].joinTimeout);
        clearTimeout(boardConnData[socket.id].disconnectTimeout);
        console.log('BOARD: User ' + boardConnData[socket.id].userId + ' successfully joined room ' + boardConnData[socket.id].roomId + '.');
        setTimeout(function () { sendDataBor(socket); }, 0);
    }
    connection.release();
};
var notifyBoardUser = function (client, socket) {
    var msg = { userId: boardConnData[client].userId, colour: roomUserList[boardConnData[client].roomId][boardConnData[client].userId] };
    socket.emit('JOIN', msg);
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
    var msg = { userId: boardConnData[socket.id].userId, colour: colour };
    bor_io.to(boardConnData[socket.id].roomId.toString()).emit('JOIN', msg);
    if (bor_io.adapter.rooms[boardConnData[socket.id].roomId]) {
        var clients = bor_io.adapter.rooms[boardConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients) {
            (function (client) { setTimeout(notifyBoardUser(client, socket), 0); })(client);
        }
    }
    if (boardConnData[socket.id].currentUploads.length > 0) {
        console.log('BOARD: Found incomplete uploads. Attempting to resume.');
        for (var i = 0; i < boardConnData[socket.id].currentUploads.length; i++) {
            var fileId = boardConnData[socket.id].currentUploads[i];
            var place = boardConnData[socket.id].files[fileId].downloaded / 65536;
            var percent = (boardConnData[socket.id].files[fileId].downloaded / boardConnData[socket.id].files[fileId].fileSize) * 100;
            var dataMsg = { serverId: fileId, place: place, percent: percent };
            console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(boardConnData[socket.id].files[fileId].fileSize / 65536) + 1));
            socket.emit('FILE-DATA', dataMsg);
        }
    }
    connection.query('USE Tutoring');
    connection.query('SELECT Tutor_ID FROM Tutor_Session WHERE Room_ID = ? AND Tutor_ID = ?', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId], function (err, rows, fields) {
        chkHost(err, rows, fields, socket, connection);
    });
    socket.join(boardConnData[socket.id].roomId.toString());
};
var chkSessionBor = function (err, rows, fields, socket, connection) {
    if (!err) {
        if (rows[0]) {
            if (rows[0].Start_Time && rows[0].Session_Length) {
                boardConnData[socket.id].startTime = rows[0].Start_Time;
                boardConnData[socket.id].sessLength = rows[0].Session_Length * 1000;
                if (rows[0].Host_Join_Time) {
                    processJoinBor(socket, connection);
                }
            }
            else {
                socket.emit('ERROR', 'Session failed to start.');
                console.log('BOARD: Session failed to start.');
                connection.release();
                socket.disconnect();
            }
        }
        else {
            socket.emit('ERROR', 'DATABASE ERROR: Unexpected Result.');
            console.log('BOARD: Session time produced an unexpected result.');
            connection.release();
            socket.disconnect();
        }
    }
    else {
        socket.emit('ERROR', 'DATABASE ERROR: Session Check. ' + err);
        console.log('BOARD: Error while performing session query. ' + err);
        connection.release();
        socket.disconnect();
    }
};
var chkParticipantBor = function (err, rows, fields, socket, connection) {
    if (!err) {
        if (rows[0]) {
            connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [boardConnData[socket.id].roomId], function (err, rows, fields) {
                chkSessionBor(err, rows, fields, socket, connection);
            });
        }
        else {
            socket.emit('ERROR', 'User not allowed.');
            console.log('BOARD: User not permitted to this session.');
            connection.release();
            socket.disconnect();
        }
    }
    else {
        socket.emit('ERROR', 'DATABASE ERROR: Participant Check. ' + err);
        console.log('BOARD: Error while performing participant query. ' + err);
        connection.release();
        socket.disconnect();
    }
};
var findRoomBor = function (err, rows, fields, socket, connection, roomToken) {
    if (!err) {
        if (rows[0]) {
            boardConnData[socket.id].roomId = rows[0].Room_ID;
            connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId], function (err, rows, fields) {
                chkParticipantBor(err, rows, fields, socket, connection);
            });
        }
        else {
            socket.emit('ERROR', 'Room does not exist.');
            console.log('BOARD: Room ' + connection.escape(roomToken) + ' does not exist.');
            connection.release();
            socket.disconnect();
        }
    }
    else {
        socket.emit('ERROR', 'DATABASE ERROR: Room Check. ' + err);
        console.log('BOARD: Error while performing room query. ' + err);
        connection.release();
        socket.disconnect();
    }
};
var missedText = function (textId, editId, socket) {
    for (var i = 0; i < boardConnData[socket.id].numNodes[textId]; i++) {
        if (!boardConnData[socket.id].recievedNodes[textId][i]) {
            boardConnData[socket.id].nodeRetries[textId]++;
            if (boardConnData[socket.id].nodeRetries[textId] > 10 || boardConnData[socket.id].cleanUp) {
                clearInterval(boardConnData[socket.id].textTimeouts[textId]);
                boardConnData[socket.id].recievedNodes[textId] = [];
                if (boardConnData[socket.id].isConnected) {
                    socket.emit('DROPPED-TEXT', { id: editId });
                }
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [textId], function (err, result) {
                            if (!err) {
                                connection.query('DELETE FROM Text_Space WHERE Entry_ID = ?', [textId], function (err, result) {
                                    if (err) {
                                        console.log('BOARD: Error while removing badly formed text. ' + err);
                                    }
                                    connection.release();
                                });
                            }
                            else {
                                console.log('BOARD: Error while removing badly formed text. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        connection.release();
                        console.log('BOARD: Error while getting database connection to remove malformed text. ' + err);
                    }
                });
                return;
            }
            else {
                if (boardConnData[socket.id].isConnected) {
                    var msg = { serverId: textId, editId: editId };
                    socket.emit('MISSED-TEXT', msg);
                }
            }
        }
    }
};
var missedPoints = function (curveId, socket) {
    for (var i = 0; i < boardConnData[socket.id].numPoints[curveId]; i++) {
        if (!boardConnData[socket.id].recievedPoints[curveId][i]) {
            boardConnData[socket.id].pointRetries[curveId]++;
            if (boardConnData[socket.id].pointRetries[curveId] > 10 || boardConnData[socket.id].cleanUp) {
                clearInterval(boardConnData[socket.id].curveTimeouts[curveId]);
                boardConnData[socket.id].recievedPoints[curveId] = [];
                if (boardConnData[socket.id].isConnected) {
                    socket.emit('DROPPED-CURVE', curveId);
                }
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('DELETE FROM Control_Points WHERE Entry_ID = ?', [curveId], function (err, result) {
                            if (!err) {
                                connection.query('DELETE FROM Whiteboard_Space WHERE Entry_ID = ?', [curveId], function (err, result) {
                                    if (err) {
                                        console.log('BOARD: Error while removing badly formed curve. ' + err);
                                    }
                                    connection.release();
                                });
                            }
                            else {
                                console.log('BOARD: Error while removing badly formed curve. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        connection.release();
                        console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    }
                });
                return;
            }
            else {
                if (boardConnData[socket.id].isConnected) {
                    var msg = { serverId: curveId, num: i };
                    socket.emit('MISSED-CURVE', msg);
                }
            }
        }
    }
};
var sendMissingCurve = function (data, socket) {
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            console.log('BOARD: Looking for Curve ID: ' + data.serverId + ' sequence number: ' + data.seq_num);
            connection.query('USE Online_Comms');
            connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? ', [data.serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing control point query.' + err);
                }
                else {
                    if (rows[0]) {
                        connection.query('SELECT X_Loc, Y_Loc FROM Control_Points WHERE Entry_ID = ? AND Seq_Num = ?', [data.serverId, data.seq_num], function (err, rows, fields) {
                            if (err) {
                                console.log('BOARD: Error while performing control point query.' + err);
                            }
                            else {
                                if (rows[0]) {
                                    var retData = { serverId: data.serverId, num: data.seq_num, x: rows[0].X_Loc, y: rows[0].Y_Loc };
                                    socket.emit('POINT', retData);
                                }
                            }
                        });
                    }
                    else {
                        socket.emit('IGNORE-CURVE', data.serverId);
                    }
                }
                connection.release();
            });
        }
        else {
            connection.release();
            console.log('BOARD: Error while getting database connection to send missing data. ' + err);
        }
    });
};
var sendMissingText = function (data, socket) {
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            console.log('BOARD: Looking for Text ID: ' + data.serverId + ' sequence number: ' + data.seq_num);
            connection.query('USE Online_Comms');
            connection.query('SELECT Entry_ID FROM Text_Space WHERE Entry_ID = ? ', [data.serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing text node query.' + err);
                }
                else {
                    if (rows[0]) {
                        connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ? AND Seq_Num = ?', [data.serverId, data.seq_num], function (err, rows, fields) {
                            if (err) {
                                console.log('BOARD: Error while performing text node query.' + err);
                            }
                            else {
                                if (rows[0]) {
                                    sendStyle(rows[0], data.serverId, socket);
                                }
                            }
                        });
                    }
                    else {
                        socket.emit('IGNORE-TEXT', data.serverId);
                    }
                }
                connection.release();
            });
        }
        else {
            connection.release();
            console.log('BOARD: Error while getting database connection to send missing data. ' + err);
        }
    });
};
var addNode = function (textNode, textId, editId, socket) {
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            connection.query('USE Online_Comms');
            connection.query('INSERT INTO Text_Style_Node(Entry_ID, Seq_Num, Text_Data, Colour, Weight, Decoration, Style, Start, End) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)', [textId, textNode.num, textNode.text, textNode.colour, textNode.weight, textNode.decoration, textNode.style, textNode.start, textNode.end], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing new style node query. ' + err);
                }
                else {
                    var msg = {
                        editId: editId, userId: boardConnData[socket.id].userId, weight: textNode.weight, decoration: textNode.decoration, num: textNode.num,
                        style: textNode.style, colour: textNode.colour, start: textNode.start, end: textNode.end, text: textNode.text, serverId: textId
                    };
                    socket.to(boardConnData[socket.id].roomId.toString()).emit('STYLENODE', msg);
                }
                connection.release();
            });
        }
        else {
            console.log('BOARD: Error while getting database connection to add new style node. ' + err);
            connection.release();
        }
    });
};
var comleteEdit = function (editId, socket) {
    var i;
    var textId = boardConnData[socket.id].editIds[editId].textId;
    clearTimeout(boardConnData[socket.id].textTimeouts[editId]);
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            connection.query('USE Online_Comms');
            connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [textId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing remove old nodes query. ' + err);
                    connection.release();
                }
                else {
                    for (i = 0; i < boardConnData[socket.id].recievedNodes[editId].length; i++) {
                        (function (nodeData, textId, editId) { setTimeout(addNode(nodeData, textId, editId, socket), 0); })(boardConnData[socket.id].recievedNodes[editId][i], textId, editId);
                    }
                    connection.query('UPDATE Text_Space SET Num_Style_Nodes = ? WHERE Entry_ID = ?', [boardConnData[socket.id].recievedNodes[editId].length, textId], function (err, rows, fields) {
                        if (err) {
                            console.log('BOARD: Error updating the number of style nodes. ' + err);
                        }
                        connection.release();
                    });
                }
            });
        }
        else {
            console.log('BOARD: Error while getting database connection to remove old nodes. ' + err);
            connection.release();
        }
    });
};
var cleanUpload = function (socketID, fileId) {
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            connection.query('USE Online_Comms');
            connection.query('UPDATE Upload_Space SET isDeleted = 1 WHERE Entry_ID = ?', [fileId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error cleaning connection. ERROR: ' + err);
                }
                connection.release();
            });
        }
        else {
            console.log('BOARD: Error getting connection to clean connection. ERROR: ' + err);
        }
    });
    boardConnData[socketID].files[fileId] = null;
    bor_io.to(boardConnData[socketID].roomId.toString()).emit('ABANDON-FILE', fileId);
};
var cleanConnection = function (socketID) {
    console.log('BOARD: Cleaning Connection....');
    boardConnData[socketID].cleanUp = true;
    if (boardConnData[socketID].isConnected) {
        my_sql_pool.getConnection(function (err, connection) {
            if (!err) {
                connection.query('USE Online_Comms');
                connection.query('UPDATE Text_Space SET Edit_Lock = 0 WHERE Edit_Lock = ?', [boardConnData[socketID].userId], function (err, rows, fields) {
                    if (err) {
                        console.log('BOARD: Error cleaning connection. ERROR: ' + err);
                    }
                    connection.release();
                });
            }
            else {
                console.log('BOARD: Error getting connection to clean connection. ERROR: ' + err);
            }
        });
    }
};
var endConnection = function (socketID) {
    console.log('BOARD: Ending Connection....');
    boardConnData[socketID].isConnected = false;
    if (boardConnData[socketID].currentUploads.length > 0) {
        for (var i = boardConnData[socketID].currentUploads.length - 1; i >= 0; i--) {
            var fileId = boardConnData[socketID].currentUploads[i];
            boardConnData[socketID].currentUploads.pop();
            cleanUpload(socketID, fileId);
        }
        boardConnData[socketID].files = null;
    }
};
var checkUpload = function (data, connection, socket) {
    connection.query('USE Online_Comms');
    connection.query('SELECT Image FROM File_Types WHERE Type = ?', [data.fileType], function (err, rows) {
        if (!err) {
            if (rows[0]) {
                startUpload(data, connection, socket);
            }
            else {
                socket.emit('FILE-BADTYPE', data.localId);
            }
        }
        else {
            console.log('BOARD: Error while performing file type query.' + err);
        }
    });
};
var startUpload = function (data, connection, socket) {
    var fUUID = uuid.v4();
    connection.query('SELECT UUID FROM Upload_Space WHERE UUID = ?', [fUUID], function (err, rows) {
        if (!rows || !rows[0]) {
            connection.query('INSERT INTO Upload_Space(Room_ID, User_ID, Edit_Time, Pos_X, Pos_Y, Width, Height, UUID, Source, Rotation) VALUES(?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, 0)', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.x, data.y, data.width, data.height, fUUID, 'User'], function (err, result) {
                if (err) {
                    console.log('BOARD: Error while performing new file upload query.' + err);
                }
                else {
                    var fName = fUUID + '.' + data.fileName.split('.').pop();
                    ;
                    var fileId = result.insertId;
                    boardConnData[socket.id].files[fileId] =
                        {
                            fileDesc: '',
                            fileName: fName,
                            fileSize: data.fileSize,
                            data: new ArrayBuffer(0),
                            downloaded: 0,
                            type: data.fileType
                        };
                    boardConnData[socket.id].currentUploads.push(fileId);
                    var place = 0;
                    var idMsg = { serverId: fileId, localId: data.localId };
                    socket.emit('FILEID', idMsg);
                    var dataMsg = { serverId: result.insertId, place: place, percent: 0 };
                    socket.emit('FILE-DATA', dataMsg);
                    var uploadMsg = {
                        serverId: result.insertId, userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width,
                        height: data.height, fileDesc: data.fileName, fileType: data.fileType, extension: data.extension, rotation: 0, editTime: new Date()
                    };
                    socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('FILE-START', uploadMsg);
                }
            });
        }
        else {
            startUpload(data, connection, socket);
        }
    });
};
var startRemDownload = function (data, connection, socket, tempId, fType) {
    var fUUID = uuid.v4();
    connection.query('USE Online_Comms');
    connection.query('SELECT UUID FROM Upload_Space WHERE UUID = ?', [fUUID], function (err, rows) {
        if (!err) {
            if (!rows[0]) {
                connection.query('INSERT INTO Upload_Space(Room_ID, User_ID, Edit_Time, Pos_X, Pos_Y, Width, Height, UUID, Source, Rotation) VALUES(?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, 0)', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.x, data.y, data.width, data.height, fUUID, data.fileURL], function (err, result) {
                    if (err) {
                        console.log('BOARD: Error while performing new remote file query.' + err);
                    }
                    else {
                        var fName = fUUID + '.' + data.fileURL.split('?')[0].split('.').pop();
                        var fileId = result.insertId;
                        boardConnData[socket.id].tmpFileIds[tempId] = { serverId: fileId, uuid: fName };
                        var idMsg = { serverId: fileId, localId: data.localId };
                        socket.emit('FILEID', idMsg);
                        var uploadMsg = {
                            serverId: result.insertId, userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width, rotation: 0,
                            height: data.height, fileDesc: data.fileDesc, fileType: fType, extension: data.fileURL.split('?')[0].split('.').pop(),
                            editTime: new Date()
                        };
                        socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('FILE-START', uploadMsg);
                    }
                });
            }
            else {
                return startRemDownload(data, connection, socket, tempId, fType);
            }
        }
        else {
            console.log('BOARD: Error while performing new remote file query.' + err);
        }
    });
};
var completeRemFile = function (fileId, socket, upArray, fileType, origin, waitCount) {
    if (waitCount === void 0) { waitCount = 0; }
    if (!boardConnData[socket.id].tmpFileIds[fileId]) {
        if (waitCount > 10) {
            console.log('BOARD: Failed to complete upload, file data not set.');
        }
        else {
            setTimeout(completeRemFile, 100, fileId, socket, upArray, fileType, origin, ++waitCount);
        }
    }
    else {
        var buffer = new Buffer(upArray.byteLength);
        for (var i = 0; i < buffer.length; ++i) {
            buffer[i] = upArray[i];
        }
        var params = {
            Body: buffer, Metadata: { Origin: origin }, ContentType: fileType,
            Bucket: 'whiteboard-storage', Key: boardConnData[socket.id].tmpFileIds[fileId].uuid, ACL: 'public-read'
        };
        var upload = new AWS.S3.ManagedUpload({ params: params, service: s3 });
        upload.send(function (err, upData) {
            if (err) {
                console.log('BOARD: Error sending file: ' + err);
            }
            else {
                var fileURL_1 = 'https://whiteboard-storage.s3.amazonaws.com/' + boardConnData[socket.id].tmpFileIds[fileId].uuid;
                console.log('BOARD: Received All File Data.');
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Upload_Space SET isComplete = 1, Content_URL = ?, File_Type = ? WHERE Entry_ID = ?', [fileURL_1, fileType, boardConnData[socket.id].tmpFileIds[fileId].serverId], function (err, rows) {
                            if (!err) {
                                var doneMsg = { serverId: boardConnData[socket.id].tmpFileIds[fileId].serverId, fileURL: fileURL_1 };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('FILE-DONE', doneMsg);
                                socket.emit('FILE-DONE', doneMsg);
                            }
                            else {
                                console.log('BOARD: Error while performing complete upload query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection for complete upload query. ' + err);
                    }
                });
            }
        });
    }
};
bor_io.on('connection', function (socket) {
    if (!boardConnData[socket.id]) {
        boardConnData[socket.id] = {
            editCount: 1, isHost: false, isConnected: false, isJoining: false, curveTimeouts: [], textTimeouts: [], recievedPoints: [], pointRetries: [],
            numRecieved: [], numPoints: [], numNodes: [], recievedNodes: [], nodeRetries: [], editIds: [], cleanUp: false, sessId: 0, roomId: 0, userId: 0,
            joinTimeout: null, startTime: null, sessLength: 0, username: '', files: [], currentUploads: [], colour: 0, tmpFileIds: [], tmpCount: 0
        };
    }
    console.log('BOARD: User Connecting.....');
    boardConnData[socket.id].sessId = socket.handshake.query.sessId;
    boardConnData[socket.id].cleanUp = false;
    if (!boardConnData[socket.id].sessId) {
        console.error('BOARD: ERROR: No session ID found in handshake.');
        return;
    }
    boardConnData[socket.id].joinTimeout = setTimeout(function () {
        console.log('BOARD: Connection Timeout.');
        socket.disconnect();
    }, 60000);
    console.log('Setting up listeners');
    socket.on('disconnect', function () {
        try {
            clearTimeout(boardConnData[socket.id].joinTimeout);
            console.log('Setting connection clean callback.');
            cleanConnection(socket.id);
            boardConnData[socket.id].disconnectTimeout = setTimeout(endConnection, 5000, socket.id);
            console.log('BOARD: User disconnected.');
        }
        catch (e) {
        }
        finally {
        }
    });
    socket.on('JOIN-ROOM', function (roomToken) {
        try {
            console.log('BOARD: User ' + boardConnData[socket.id].userId + ' joining room ' + roomToken + '.......');
            if (!boardConnData[socket.id].isJoining) {
                boardConnData[socket.id].isJoining = true;
                my_sql_pool.getConnection(function (err, connection) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function (err, rows, fields) {
                        findRoomBor(err, rows, fields, socket, connection, roomToken);
                    });
                });
            }
        }
        catch (e) {
            socket.emit('ERROR');
            socket.disconnect();
            console.log('BOARD: Error while attempting join-room, Details: ' + e);
        }
        finally {
        }
    });
    socket.on('LEAVE', function () {
        if (boardConnData[socket.id].isConnected) {
            try {
                socket.leave(boardConnData[socket.id].roomId.toString());
            }
            catch (e) {
            }
            finally {
            }
        }
    });
    socket.on('CURVE', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('BOARD: Received curve.');
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    if (typeof (data.localId) != 'undefined' && data.num_points && data.colour) {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Whiteboard_Space(Room_ID, User_ID, Local_ID, Edit_Time, Num_Control_Points, Colour, Size, X_Loc, Y_Loc, Width, Height) VALUES(?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.localId, data.num_points, data.colour, data.size, data.x, data.y, data.width, data.height], function (err, result) {
                            if (err) {
                                console.log('BOARD: Error while performing new curve query.' + err);
                            }
                            else {
                                boardConnData[socket.id].numRecieved[result.insertId] = 0;
                                boardConnData[socket.id].numPoints[result.insertId] = data.num_points;
                                boardConnData[socket.id].recievedPoints[result.insertId] = [];
                                boardConnData[socket.id].pointRetries[result.insertId] = 0;
                                console.log('BOARD: Sending curve ID: ' + result.insertId);
                                var idMsg = { serverId: result.insertId, localId: data.localId };
                                socket.emit('CURVEID', idMsg);
                                var curveMsg = {
                                    serverId: result.insertId, userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width,
                                    height: data.height, size: data.size, colour: data.colour, num_points: data.num_points, editTime: new Date()
                                };
                                socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('CURVE', curveMsg);
                                boardConnData[socket.id].curveTimeouts[result.insertId] = setInterval(function () { missedPoints(result.insertId, socket); }, 5000);
                            }
                        });
                    }
                }
                else {
                    console.log('BOARD: Error while getting database connection to add new curve. ' + err);
                }
                connection.release();
            });
        }
    });
    socket.on('POINT', function (data) {
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    if (!boardConnData[socket.id].recievedPoints[data.serverId][data.num]) {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES(?, ?, ?, ?)', [data.serverId, data.num, data.x, data.y], function (err, rows, fields) {
                            if (err) {
                                console.log('ID: ' + data.serverId);
                                console.log('Seq_Num: ' + data.num);
                                console.log('BOARD: Error while performing new control point query. ' + err);
                            }
                            else {
                                var msg = { serverId: data.serverId, num: data.num, x: data.x, y: data.y };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('POINT', msg);
                                boardConnData[socket.id].recievedPoints[data.serverId][data.num] = true;
                                boardConnData[socket.id].numRecieved[data.serverId]++;
                                if (boardConnData[socket.id].numRecieved[data.serverId] == boardConnData[socket.id].numPoints[data.serverId]) {
                                    clearInterval(boardConnData[socket.id].curveTimeouts[data.serverId]);
                                    socket.emit('CURVE-COMPLETE', data.serverId);
                                }
                            }
                            connection.release();
                        });
                    }
                }
                else {
                    console.log('BOARD: Error while getting database connection to add new control point. ' + err);
                    connection.release();
                }
            });
        }
    });
    socket.on('DELETE-CURVE', function (curveId) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Delete Curve Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [curveId], function (err, rows) {
                            if (!err) {
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-CURVE', curveId);
                            }
                            else {
                                console.log('BOARD: Error while performing erase curve query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to delete curve. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [curveId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [curveId], function (err, rows) {
                                        if (!err) {
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-CURVE', curveId);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing erase curve query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing erase:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to delete curve. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('MOVE-CURVE', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Move Curve Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT X_Loc, Y_Loc FROM Whiteboard_Space WHERE Entry_ID = ?', [data.serverId], function (err, rows) {
                            if (!err && rows[0]) {
                                var X_change_1 = data.x - rows[0].X_Loc;
                                var Y_change_1 = data.y - rows[0].Y_Loc;
                                connection.query('START TRANSACTION', function (err) {
                                    if (!err) {
                                        connection.query('UPDATE Whiteboard_Space SET X_Loc = ?, Y_Loc = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function (err, rows) {
                                            if (!err) {
                                                connection.query('UPDATE Control_Points SET X_Loc = (X_Loc + ?), Y_Loc = (Y_Loc + ?) WHERE Entry_ID = ?', [X_change_1, Y_change_1, data.serverId], function (err, rows) {
                                                    if (!err) {
                                                        connection.query('COMMIT', function (err) {
                                                            if (!err) {
                                                                var msg = {
                                                                    serverId: data.serverId, x: data.x, y: data.y, editTime: new Date()
                                                                };
                                                                socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-CURVE', msg);
                                                            }
                                                            else {
                                                                console.log('BOARD: Error while performing move curve query. ' + err);
                                                            }
                                                        });
                                                    }
                                                    else {
                                                        console.log('BOARD: Error while performing move curve query. ' + err);
                                                    }
                                                    connection.release();
                                                });
                                            }
                                            else {
                                                console.log('BOARD: Error while performing move curve query. ' + err);
                                            }
                                        });
                                    }
                                    else {
                                        console.log('BOARD: Error while performing move curve query. ' + err);
                                    }
                                });
                            }
                            else {
                                console.log('BOARD: Error while performing move curve query. ' + err);
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to move curve. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Control_Points SET X_Loc = (X_Loc + ?), Y_Loc = (Y_Loc + ?), Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function (err, rows) {
                                        if (!err) {
                                            var msg = { serverId: data.serverId, x: data.x, y: data.y, editTime: new Date() };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-CURVE', msg);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing move curve query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing move:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to move curve. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('MISSING-CURVE', function (data) {
        console.log('BOARD: Received missing message.');
        if (boardConnData[socket.id].isConnected) {
            setTimeout(function () { sendMissingCurve(data, socket); }, 0);
        }
    });
    socket.on('UNKNOWN-CURVE', function (curveId) {
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [curveId, boardConnData[socket.id].roomId], function (err, rows, fields) {
                        if (err) {
                            console.log('BOARD: Error while performing curve query.' + err);
                        }
                        else {
                            if (rows[0]) {
                                var retData = {
                                    serverId: curveId, userId: rows[0].User_ID, num_points: rows[0].Num_Control_Points,
                                    colour: rows[0].Colour, size: rows[0].Size, x: rows[0].X_Loc, y: rows[0].Y_Loc,
                                    width: rows[0].Width, height: rows[0].Height, editTime: rows[0].Edit_Time
                                };
                                socket.emit('CURVE', retData);
                            }
                        }
                        connection.release();
                    });
                }
                else {
                    connection.release();
                    console.log('BOARD: Error while getting database connection to send missing curve ID. ' + err);
                }
            });
        }
    });
    socket.on('TEXTBOX', function (data) {
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    if (typeof (data.localId) != 'undefined') {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Text_Space(Room_ID, User_ID, Local_ID, Edit_Time, Num_Style_Nodes, Size, Pos_X, Pos_Y, Width, Height, Edit_Lock, Justified) VALUES(?, ?, ?, CURRENT_TIMESTAMP, 0, ?, ?, ?, ?, ?, ?, ?)', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.localId, data.size, data.x, data.y, data.width, data.height, boardConnData[socket.id].userId, data.justified], function (err, result) {
                            if (err) {
                                console.log('BOARD: Error while performing new textbox query.' + err);
                            }
                            else {
                                var idMsg = { serverId: result.insertId, localId: data.localId };
                                socket.emit('TEXTID', idMsg);
                                var textMsg = {
                                    serverId: result.insertId, userId: boardConnData[socket.id].userId, editLock: boardConnData[socket.id].userId,
                                    x: data.x, y: data.y, width: data.width, height: data.height, size: data.size, justified: data.justified, editCount: 0,
                                    editTime: new Date()
                                };
                                socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('TEXTBOX', textMsg);
                            }
                        });
                    }
                    else {
                        console.log('Uh Oh, some malformed data appeared.');
                    }
                }
                else {
                    console.log('BOARD: Error while getting database connection to add new textbox. ' + err);
                }
                connection.release();
            });
        }
    });
    socket.on('EDIT-TEXT', function (data) {
        if (boardConnData[socket.id].isConnected) {
            boardConnData[socket.id].editIds[boardConnData[socket.id].editCount] = { textId: data.serverId, localId: data.localId };
            boardConnData[socket.id].recievedNodes[boardConnData[socket.id].editCount] = [];
            boardConnData[socket.id].numNodes[boardConnData[socket.id].editCount] = data.num_nodes;
            boardConnData[socket.id].nodeRetries[boardConnData[socket.id].editCount] = 0;
            var idMsg = { editId: boardConnData[socket.id].editCount, bufferId: data.bufferId, localId: data.localId };
            socket.emit('EDITID-TEXT', idMsg);
            var editMsg = {
                serverId: data.serverId, userId: boardConnData[socket.id].userId, editId: boardConnData[socket.id].editCount, num_nodes: data.num_nodes,
                editTime: new Date()
            };
            socket.to(boardConnData[socket.id].roomId.toString()).emit('EDIT-TEXT', editMsg);
            boardConnData[socket.id].textTimeouts[boardConnData[socket.id].editCount] = (function (textId, editId) {
                setTimeout(function () { missedText(textId, editId, socket); }, 60000);
            })(data.serverId, boardConnData[socket.id].editCount);
            boardConnData[socket.id].editCount++;
        }
    });
    socket.on('STYLENODE', function (data) {
        if (boardConnData[socket.id].isConnected) {
            if (!boardConnData[socket.id].recievedNodes[data.editId]) {
                console.error('Bad data. Socket ID: ' + socket.id + ' EditID: ' + data.editId);
            }
            var newNode = {
                start: data.start, end: data.end, text: data.text, num: data.num, weight: data.weight, decoration: data.decoration, style: data.style,
                colour: data.colour
            };
            boardConnData[socket.id].recievedNodes[data.editId].push(newNode);
            if (boardConnData[socket.id].recievedNodes[data.editId].length == boardConnData[socket.id].numNodes[data.editId]) {
                comleteEdit(data.editId, socket);
            }
        }
    });
    socket.on('JUSTIFY-TEXT', function (data) {
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function (err, rows, fields) {
                        if (err) {
                            console.log('BOARD: Error getting textbox justify state. ' + err);
                            connection.release();
                        }
                        else {
                            if (rows[0].Edit_Lock == boardConnData[socket.id].userId) {
                                connection.query('UPDATE Text_Space SET Justified = ? WHERE Entry_ID = ?', [data.newState, data.serverId], function (err, rows, fields) {
                                    if (err) {
                                        console.log('BOARD: Error while updating textbox justify state. ' + err);
                                    }
                                    else {
                                        var msg = { serverId: data.serverId, newState: data.newState };
                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('JUSTIFY-TEXT', msg);
                                    }
                                    connection.release();
                                });
                            }
                        }
                    });
                }
                else {
                    console.log('BOARD: Error while getting database connection to change textbox justify state. ' + err);
                    connection.release();
                }
            });
        }
    });
    socket.on('LOCK-TEXT', function (data) {
        if (boardConnData[socket.id].isConnected) {
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function (err, rows, fields) {
                            if (err) {
                                console.log('BOARD: Error getting textbox lock state. ' + err);
                                connection.release();
                            }
                            else {
                                if (!rows[0].Edit_Lock) {
                                    connection.query('UPDATE Text_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData[socket.id].userId, data.serverId], function (err, rows, fields) {
                                        if (err) {
                                            console.log('BOARD: Error while updating textbox loxk state. ' + err);
                                        }
                                        else {
                                            var idMsg = { serverId: data.serverId };
                                            socket.emit('LOCKID-TEXT', idMsg);
                                            var lockMsg = { serverId: data.serverId, userId: boardConnData[socket.id].userId };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('LOCK-TEXT', lockMsg);
                                        }
                                        connection.release();
                                    });
                                }
                                else {
                                    var refMsg = { serverId: data.serverId };
                                    socket.emit('REFUSED-TEXT', refMsg);
                                    connection.release();
                                }
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to edit style node. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function (err, rows, fields) {
                                        if (err) {
                                            console.log('BOARD: Error getting textbox lock state. ' + err);
                                            connection.release();
                                        }
                                        else {
                                            if (!rows[0].Edit_Lock) {
                                                connection.query('UPDATE Text_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData[socket.id].userId, data.serverId], function (err, rows, fields) {
                                                    if (err) {
                                                        console.log('BOARD: Error while updating textbox loxk state. ' + err);
                                                    }
                                                    else {
                                                        var idMsg = { serverId: data.serverId };
                                                        socket.emit('LOCKID-TEXT', idMsg);
                                                        var lockMsg = { serverId: data.serverId, userId: boardConnData[socket.id].userId };
                                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('LOCK-TEXT', lockMsg);
                                                    }
                                                    connection.release();
                                                });
                                            }
                                            else {
                                                var refMsg = { serverId: data.serverId };
                                                socket.emit('REFUSED-TEXT', refMsg);
                                                connection.release();
                                            }
                                        }
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing textLock:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to lock text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('RELEASE-TEXT', function (data) {
        console.log('Received release for: ' + data.serverId);
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function (err, rows, fields) {
                        if (err) {
                            console.log('BOARD: Error releasing textbox lock state. ' + err);
                            connection.release();
                        }
                        else {
                            if (!rows[0]) {
                                console.log('No row. Data ID: ' + data.serverId);
                                connection.release();
                            }
                            else if (rows[0].Edit_Lock == boardConnData[socket.id].userId) {
                                connection.query('UPDATE Text_Space SET Edit_Lock = 0 WHERE Entry_ID = ?', [data.serverId], function (err, rows, fields) {
                                    if (err) {
                                        console.log('BOARD: Error while updating textbox lock state. ' + err);
                                    }
                                    else {
                                        var msg = { serverId: data.serverId };
                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('RELEASE-TEXT', msg);
                                    }
                                    connection.release();
                                });
                            }
                            else {
                                connection.release();
                            }
                        }
                    });
                }
                else {
                    console.log('BOARD: Error while getting database connection to release text lock. ' + err);
                    connection.release();
                }
            });
        }
    });
    socket.on('MOVE-TEXT', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Move Text Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Text_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function (err, rows) {
                            if (!err) {
                                var msg = { serverId: data.serverId, x: data.x, y: data.y, editTime: new Date() };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-TEXT', msg);
                            }
                            else {
                                console.log('BOARD: Error while performing move text query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to move text. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Text_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function (err, rows) {
                                        if (!err) {
                                            var msg = { serverId: data.serverId, x: data.x, y: data.y, editTime: new Date() };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-TEXT', msg);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing move text query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing move text:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to move text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('RESIZE-TEXT', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Resize Text Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Text_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function (err, rows) {
                            if (!err) {
                                var msg = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-TEXT', msg);
                            }
                            else {
                                console.log('BOARD: Error while performing resize text query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to resize text. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Text_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function (err, rows) {
                                        if (!err) {
                                            var msg = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-TEXT', msg);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing resize text query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing resize text:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to resize text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('DELETE-TEXT', function (textId) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Delete Text Event. Text ID: ' + textId);
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Text_Space SET isDeleted = 1 WHERE Entry_ID = ?', [textId], function (err, rows) {
                            if (!err) {
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-TEXT', textId);
                            }
                            else {
                                console.log('BOARD: Error while performing erase text query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to delete text. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID', [textId, boardConnData[socket.id].userId], function (err, rows) {
                            console.log('Cleared User.');
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Text_Space SET isDeleted = 1 WHERE Entry_ID = ?', [textId], function (err, rows) {
                                        if (!err) {
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-TEXT', textId);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing erase text query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing erase text:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to delete text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('MISSING-TEXT', function (data) {
        console.log('BOARD: Received missing message.');
        if (boardConnData[socket.id].isConnected) {
            setTimeout(function () { sendMissingText(data, socket); }, 0);
        }
    });
    socket.on('UNKNOWN-TEXT', function (textId) {
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [textId], function (err, rows, fields) {
                        if (err) {
                            connection.release();
                            console.log('BOARD: Error while performing existing text query. ' + err);
                        }
                        else {
                            if (rows[0]) {
                                var msg = {
                                    serverId: rows[0].Entry_ID, userId: rows[0].User_ID, size: rows[0].Size,
                                    x: rows[0].Pos_X, y: rows[0].Pos_Y, width: rows[0].Width, height: rows[0].Height,
                                    editLock: rows[0].Edit_Lock, justified: rows[0].isJustified, editCount: 0, editTime: rows[0].Edit_Time
                                };
                                socket.emit('TEXTBOX', msg);
                                (function (data) { setTimeout(function () { sendText(data, socket); }, 100); })(rows[0]);
                            }
                            connection.release();
                        }
                    });
                }
                else {
                    console.log('BOARD: Error while getting database connection for unknown text. ' + err);
                    connection.release();
                }
            });
        }
    });
    socket.on('UNKNOWN-EDIT', function (editId) {
        if (boardConnData[socket.id].isConnected) {
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [editId], function (err, rows, fields) {
                        if (err) {
                            connection.release();
                            console.log('BOARD: Error while performing existing text query. ' + err);
                        }
                        else {
                            if (rows[0]) {
                                (function (data) { setTimeout(function () { sendText(data, socket); }, 100); })(rows[0]);
                            }
                            connection.release();
                        }
                    });
                }
                else {
                    console.log('BOARD: Error while getting database connection for unknown edit. ' + err);
                    connection.release();
                }
            });
        }
    });
    socket.on('HIGHLIGHT', function (data) {
        console.log('BOARD: Recieved Highlight.');
        console.log('BOARD: Sending colour as: ' + boardConnData[socket.id].colour);
        var highMsg = { userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width, height: data.height, colour: boardConnData[socket.id].colour };
        socket.to(boardConnData[socket.id].roomId.toString()).emit('HIGHLIGHT', highMsg);
    });
    socket.on('CLEAR-HIGHTLIGHT', function () {
    });
    socket.on('FILE-START', function (data) {
        console.log('BOARD: Received file start.');
        if (boardConnData[socket.id].isConnected) {
            if (data.fileSize > 10485760) {
                console.log('BOARD: User attempted upload larger than 10MB.');
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        checkUpload(data, connection, socket);
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to upload new file. ' + err);
                    }
                    connection.release();
                });
            }
        }
    });
    socket.on('FILE-DATA', function (data) {
        console.log('BOARD: Received file data.');
        console.log('BOARD: Piece Size: ' + data.piece.length);
        console.log('BOARD: Previous total: ' + boardConnData[socket.id].files[data.serverId].downloaded);
        boardConnData[socket.id].files[data.serverId].downloaded += data.piece.length;
        var tmpArray = new Uint8Array(boardConnData[socket.id].files[data.serverId].downloaded);
        tmpArray.set(new Uint8Array(boardConnData[socket.id].files[data.serverId].data), 0);
        tmpArray.set(new Uint8Array(data.piece), boardConnData[socket.id].files[data.serverId].data.byteLength);
        boardConnData[socket.id].files[data.serverId].data = tmpArray.buffer;
        if (boardConnData[socket.id].files[data.serverId].downloaded == boardConnData[socket.id].files[data.serverId].fileSize) {
            console.log('BOARD: File Upload complete.');
            var index = boardConnData[socket.id].currentUploads.indexOf(data.serverId);
            boardConnData[socket.id].currentUploads.splice(index, 1);
            var upArray = new Uint8Array(boardConnData[socket.id].files[data.serverId].data);
            var buffer = new Buffer(upArray.byteLength);
            for (var i = 0; i < buffer.length; ++i) {
                buffer[i] = upArray[i];
            }
            var params = {
                Body: buffer, ContentType: boardConnData[socket.id].files[data.serverId].type, Metadata: { Origin: 'USER: ' + boardConnData[socket.id].userId },
                Bucket: 'whiteboard-storage', Key: boardConnData[socket.id].files[data.serverId].fileName, ACL: 'public-read'
            };
            var upload = new AWS.S3.ManagedUpload({ params: params, service: s3 });
            upload.send(function (err, upData) {
                if (err) {
                    console.log('BOARD: Error uploading file to bucker: ' + err);
                }
                else {
                    var fileURL_2 = 'https://whiteboard-storage.s3.amazonaws.com/' + boardConnData[socket.id].files[data.serverId].fileName;
                    var fType_1 = boardConnData[socket.id].files[data.serverId].type;
                    boardConnData[socket.id].files[upData.fileId] = null;
                    console.log('Received All File Data.');
                    my_sql_pool.getConnection(function (err, connection) {
                        if (!err) {
                            connection.query('USE Online_Comms');
                            connection.query('UPDATE Upload_Space SET isComplete = 1, Content_URL = ?, File_Type = ? WHERE Entry_ID = ?', [fileURL_2, fType_1, data.serverId], function (err, rows) {
                                if (!err) {
                                    var doneMsg = { serverId: data.serverId, fileURL: fileURL_2 };
                                    socket.to(boardConnData[socket.id].roomId.toString()).emit('FILE-DONE', doneMsg);
                                    socket.emit('FILE-DONE', doneMsg);
                                }
                                else {
                                    console.log('BOARD: Error while performing complete upload query. ' + err);
                                }
                                connection.release();
                            });
                        }
                        else {
                            console.log('BOARD: Error while getting database connection for complete upload query. ' + err);
                        }
                    });
                }
            });
        }
        else if (boardConnData[socket.id].files[data.serverId].data.byteLength > 10485760) {
            console.log('BOARD: User uploaded a file larger than 10MB, it should have been less than.');
            socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('ABANDON-FILE', data.serverId);
        }
        else {
            var place = boardConnData[socket.id].files[data.serverId].downloaded / 65536;
            var percent = (boardConnData[socket.id].files[data.serverId].downloaded / boardConnData[socket.id].files[data.serverId].fileSize) * 100;
            var dataMsg = { serverId: data.serverId, place: place, percent: percent };
            console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(boardConnData[socket.id].files[data.serverId].fileSize / 65536) + 1));
            socket.emit('FILE-DATA', dataMsg);
        }
    });
    socket.on('STOP-FILE', function (serverId) {
    });
    socket.on('REMOTE-FILE', function (data) {
        console.log('BOARD: Received remote file.');
        if (boardConnData[socket.id].isConnected) {
            var tmpId_1 = boardConnData[socket.id].tmpCount++;
            var urlObj = urlMod.parse(data.fileURL);
            var userReq_1 = urlObj;
            my_sql_pool.getConnection(function (err, connection) {
                if (!err) {
                    var options = { method: 'HEAD', host: userReq_1.host, port: 443, path: userReq_1.path };
                    var req = require('https').request(options, function (res) {
                        startRemDownload(data, connection, socket, tmpId_1, res.headers['content-type']);
                    });
                    req.end();
                }
                else {
                    console.log('BOARD: Error while getting database connection to download remote file. ' + err);
                }
                connection.release();
            });
            require('https').get(userReq_1, function (response) {
                if (response.statusCode == 301 || response.statusCode == 302) {
                }
                else if (response.headers['content-length'] > 10485760) {
                    console.log('Image too large.');
                }
                else if (!~[200, 304].indexOf(response.statusCode)) {
                    console.log('Received an invalid status code. Code is: ' + response.statusCode);
                }
                else if (!response.headers['content-type'].match(/image/)) {
                    console.log('Not an image.');
                }
                else {
                    console.log('BOARD: Getting Data');
                    var body = new Uint8Array(0);
                    response.on('error', function (err) {
                        console.log(err);
                    });
                    response.on('data', function (chunk) {
                        var tmpArray = new Uint8Array(body.byteLength + chunk.length);
                        tmpArray.set(new Uint8Array(body), 0);
                        tmpArray.set(new Uint8Array(chunk), body.byteLength);
                        body = tmpArray;
                    });
                    response.on('end', function () {
                        completeRemFile(tmpId_1, socket, body, response.headers['content-type'], data.fileURL);
                    });
                }
            });
        }
    });
    socket.on('MOVE-FILE', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Move File Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Upload_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function (err, rows) {
                            if (!err) {
                                var msg = { serverId: data.serverId, x: data.x, y: data.y, editTime: new Date() };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-FILE', msg);
                            }
                            else {
                                console.log('BOARD: Error while performing move file query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to move file. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('USE Online_Comms');
                                    connection.query('UPDATE Upload_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function (err, rows) {
                                        if (!err) {
                                            var msg = { serverId: data.serverId, x: data.x, y: data.y, editTime: new Date() };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-FILE', msg);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing move file query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing move file:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to move file. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('RESIZE-FILE', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Resize File Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Upload_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function (err, rows) {
                            if (!err) {
                                var msg = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-FILE', msg);
                            }
                            else {
                                console.log('BOARD: Error while performing resize file query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to resize file. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Upload_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function (err, rows) {
                                        if (!err) {
                                            var msg = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-FILE', msg);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing resize file query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing resize file:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to resize file. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('ROTATE-FILE', function (data) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Rotate File Event.');
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Upload_Space SET Rotation = ? WHERE Entry_ID = ?', [data.rotation, data.serverId], function (err, rows) {
                            if (!err) {
                                var msg = { serverId: data.serverId, rotation: data.rotation };
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('ROTATE-FILE', msg);
                            }
                            else {
                                console.log('BOARD: Error while performing rotate file query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to rotate file. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID', [data.serverId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Upload_Space SET Rotation = ? WHERE Entry_ID = ?', [data.rotation, data.serverId], function (err, rows) {
                                        if (!err) {
                                            var msg = { serverId: data.serverId, rotation: data.rotation };
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-FILE', msg);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing resize file query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing resize file:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to resize file. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    socket.on('DELETE-FILE', function (fileId) {
        if (boardConnData[socket.id].isConnected) {
            console.log('Received Delete File Event. File ID: ' + fileId);
            if (boardConnData[socket.id].isHost) {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Upload_Space SET isDeleted = 1 WHERE Entry_ID = ?', [fileId], function (err, rows) {
                            if (!err) {
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-FILE', fileId);
                            }
                            else {
                                console.log('BOARD: Error while performing erase file query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to delete file. ' + err);
                        connection.release();
                    }
                });
            }
            else {
                my_sql_pool.getConnection(function (err, connection) {
                    if (!err) {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID', [fileId, boardConnData[socket.id].userId], function (err, rows) {
                            if (!err) {
                                if (rows[0]) {
                                    connection.query('UPDATE Text_Space SET isDeleted = 1 WHERE Entry_ID = ?', [fileId], function (err, rows) {
                                        if (!err) {
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-FILE', fileId);
                                        }
                                        else {
                                            console.log('BOARD: Error while performing erase file query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else {
                                console.log('BOARD: Error while performing erase file:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else {
                        console.log('BOARD: Error while getting database connection to delete file. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });
    console.log('Finished with listeners.');
    my_sql_pool.getConnection(function (err, connection) {
        console.log('Tried getting connection.');
        if (!err) {
            connection.query('USE Users');
            connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [boardConnData[socket.id].sessId], function (err, rows) {
                if (!err) {
                    if (rows[0]) {
                        var sessBuff = new Buffer(rows[0].Session_Data);
                        var sessData = sessBuff.toString('utf-8');
                        sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
                        sessData = sessData.slice(0, sessData.indexOf(';'));
                        boardConnData[socket.id].userId = parseInt(sessData);
                        if (connBoardUsers[boardConnData[socket.id].userId]) {
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
                            if (!err) {
                                if (rows[0] && rows[0].Username) {
                                    boardConnData[socket.id].username = rows[0].Username;
                                    socket.emit('READY', boardConnData[socket.id].userId);
                                    console.log('BOARD: User ' + boardConnData[socket.id].userId + ' passed initial connection.');
                                    connection.release();
                                }
                                else {
                                    connection.release();
                                    socket.disconnect();
                                    console.log('BOARD: User ' + connection.escape(boardConnData[socket.id].userId) + ' not found.');
                                    return;
                                }
                            }
                            else {
                                connection.release();
                                socket.disconnect();
                                console.log('BOARD: Error while performing user Query. ' + err);
                                return;
                            }
                        });
                    }
                    else {
                        connection.release();
                        socket.disconnect();
                        console.log('BOARD: Session not found.');
                        return;
                    }
                }
                else {
                    connection.release();
                    socket.disconnect();
                    console.log('BOARD: Error while performing session Query. ' + err);
                    return;
                }
            });
        }
        else {
            socket.disconnect();
            console.log('BOARD: Error getting connection from pool. ' + err);
            return;
        }
    });
});
var reqOpt = {
    host: '169.254.169.254',
    port: 80,
    path: '/latest/meta-data/public-hostname'
};
var endPointAddr;
var zone;
var checkServers = function (err, rows, connection) {
    if (!err) {
        if (!rows[0]) {
            connection.query('INSERT INTO Tutorial_Servers(End_Point, Zone) VALUES(?, ?) ', [endPointAddr, zone], function (err, rows) {
                if (err) {
                    console.log('Error registering server in list. ' + err);
                }
                connection.release();
            });
        }
        else {
            console.log('Server already in list.');
            connection.release();
        }
    }
    else {
        console.log('Error registering server in list. ' + err);
    }
};
var getServerData = function (chunk) {
    console.log('Zone: ' + chunk);
    zone = chunk;
    my_sql_pool.getConnection(function (err, connection) {
        if (!err) {
            var qStr;
            console.log('Adding to server list.......');
            connection.query('USE Online_Comms');
            connection.query('SELECT * FROM Tutorial_Servers WHERE End_Point = ?', [endPointAddr], function (err, rows) {
                if (err) {
                    console.log('Error registering server in list. ' + err);
                    connection.release();
                }
                else {
                    checkServers(err, rows, connection);
                }
            });
        }
        else {
            console.log('BOARD: Error getting connection from pool. ' + err);
            return;
        }
    });
};
require('http').get(reqOpt, function (res) {
    console.log("Got response for end point request: " + res.statusCode);
    res.on('data', function (chunk) {
        if (res.statusCode == 200) {
            console.log('End Point: ' + chunk);
            endPointAddr = chunk;
            reqOpt = {
                host: '169.254.169.254',
                port: 80,
                path: '/latest/meta-data/placement/availability-zone'
            };
            require('http').get(reqOpt, function (res) {
                console.log("Got response for zone: " + res.statusCode);
                if (res.statusCode == 200) {
                    res.on('data', getServerData);
                }
            }).on('error', function (e) {
                console.log("Error retrieving server endpoint: " + e.message);
            });
        }
    });
}).on('error', function (e) {
    console.log("Error retrieving server endpoint: " + e.message);
});
https.listen(9001, function () {
    console.log("Server listening at", "*:" + 9001);
});
