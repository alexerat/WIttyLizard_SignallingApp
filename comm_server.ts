interface Map<T> {
    [K: string]: T;
}
interface ConnectionData {
    roomId: number;
    userId: number;
    joinTimeout: NodeJS.Timer;
    startTime;
    sessLength: number;
    username: string;
    isConnected: boolean;
    isHost: boolean;
    isJoining: boolean;
    disconnectTimeout?: NodeJS.Timer;
}
interface MediaConnection extends ConnectionData {
    ScalableBroadcast: boolean;
    extra;
}
interface BoardConnection extends ConnectionData {
    sessId: number;
    numNodes: Array<number>;
    nodeRetries: Array<number>;
    recievedNodes: Array<Array<TextStyle>>;
    editCount: number;
    textTimeouts;
    editIds: Array<{textId: number, localId:number}>;

    numPoints: Array<number>;
    pointRetries: Array<number>;
    numRecieved: Array<number>;
    recievedPoints: Array<Array<boolean>>;
    curveTimeouts: Array<NodeJS.Timer>;

    cleanUp: boolean;
}

let colourTable : Array<number> = [
    0xFF0000, 0x00FF00, 0x0000FF, 0xFF00FF, 0xFF7F00,
    0x8C1717, 0x70DB93, 0x00FFFF, 0x5959AB, 0xDB9370,
    0x871F78, 0x238E23, 0x38B0DE, 0xCC3299, 0xB5A642,
    0x8E2323, 0x2F4F2F, 0x5F9F9F, 0x9932CD, 0xB87333,
    0x4F2F4F, 0x238E68, 0x236B8E, 0xDB70DB, 0xCFB53B,
    0x2F2F4F, 0x00FF7F, 0x007FFF, 0x8E236B, 0xDBDB70,
    0x855E42, 0x99CC32, 0xADEAEA, 0xEBC79E, 0x9F9F5F,
    0x8E6B23, 0x527F76, 0xD9D9F3, 0xF5CCB0, 0xCD7F32,
    0xC0C0C0
];

var app = require('express')();
var fs = require('fs');
var privateKey = fs.readFileSync('/var/www/web/fake-keys/privatekey.key').toString();
var certificate = fs.readFileSync('/var/www/web/fake-keys/certificate.pem').toString();
var credentials = {key: privateKey, cert: certificate};
var https = require('https').Server(credentials, app);
var io : SocketIO.Server = require('socket.io')(https);
var PHPUnserialize = require('php-unserialize');
var parseCookie = require('cookie-parser');
var mysql: MySql  = require('mysql');

var dbHost = process.env.DATABASE_HOST;
var dbUser = process.env.DATABASE_USER;
var dbPass = process.env.DATABASE_PASSWORD;

var my_sql_pool = mysql.createPool({
  host     : dbHost,
  user     : dbUser,
  password : dbPass,
  database : 'Online_Comms'
});

var med_io = io.of('/media');
var bor_io = io.of('/board');

app.use(parseCookie('7e501ffeb426888ea59e63aa15b931a7f9d28d24'));


/***************************************************************************************************************************************************************
 *  Media signalling server
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
 var mediaConnData : { [id: string] : MediaConnection } = {};
 var connMediaUsers : { [id: number] : string } = {};

var notifyUser = function(client, socket, connection)
{
    my_sql_pool.getConnection(function(err, connection)
    {
        if (!err)
        {
            console.log('Querying ' + client);
            // Tell the new user about everyone else
            connection.query('USE Online_Comms');
            connection.query('SELECT User_Id, Username, Socket_ID FROM Room_Participants WHERE Socket_ID = ?', [client], function(err, rows)
            {
                if (!err)
                {
                    if(rows[0])
                    {
                        socket.emit('JOIN', rows[0].User_Id, rows[0].Username, rows[0].Socket_ID);
                    }
                    else
                    {
                        console.log('MEDIA: HERE. Error querying session participants.');
                        return;
                    }
                }
                else
                {
                    console.log('MEDIA: Error querying session participants.' + err);
                    return;
                }

                connection.release();
            });
        }
        else
        {
            console.log('MEDIA: Error getting connection from pool: ' + err);
        }
    });
};

var processJoinMed = function(socket, connection)
{

    //Tell all those in the room that a new user joined
    med_io.to(mediaConnData[socket.id].roomId.toString()).emit('JOIN', mediaConnData[socket.id].userId, mediaConnData[socket.id].username, socket.id);

    if(med_io.adapter.rooms[mediaConnData[socket.id].roomId])
    {
        var clients = med_io.adapter.rooms[mediaConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients)
        {
            (function(client) {setTimeout(notifyUser(client, socket, connection), 0)})(client);
        }
    }

    connection.release();

    //New user joins the specified room
    socket.join(mediaConnData[socket.id].roomId);
    mediaConnData[socket.id].isConnected = true;

    var currTime = new Date();

    setTimeout(function()
    {
        console.log('Session ending.');
        console.log((mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 600000) - currTime.getTime());
        socket.emit('SESSEND');
        socket.disconnect();
    }, (mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 600000) - currTime.getTime());
    setTimeout(function()
    {
        socket.emit('SESSWARN', 'Session ending in 5 minutes.');
    }, (mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength  + 300000) - currTime.getTime());
    setTimeout(function()
    {
        socket.emit('SESSEND', 'Session ending in 1 minute.');
    }, (mediaConnData[socket.id].startTime.getTime() + mediaConnData[socket.id].sessLength + 540000) - currTime.getTime());

    socket.emit('CONNOK');
    clearTimeout(mediaConnData[socket.id].joinTimeout);

    console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' successfully joined room ' + mediaConnData[socket.id].roomId + '.');
};

var chkSessionMed = function(err, rows, fields, socket, connection)
{
    if (!err)
    {
        if (rows[0])
        {

            if (rows[0].Start_Time && rows[0].Session_Length)
            {
                // TODO: Add time checks.

                if (rows[0].Host_Join_Time)
                {
                    mediaConnData[socket.id].startTime = rows[0].Start_Time;
                    mediaConnData[socket.id].sessLength = rows[0].Session_Length  * 1000;
                    processJoinMed(socket, connection);
                }
            }
            else
            {
                socket.emit('ERROR', 'Session failed to start.');
                console.log('MEDIA: Session failed to start.');
                socket.disconnect();
                connection.release();
                return;
            }
        }
        else
        {
            socket.emit('ERROR', 'DATABASE ERROR: Unexpected Result.');
            console.log('MEDIA: Session time produced an unexpected result.');
            socket.disconnect();
            connection.release();
            return;
        }
    }
    else
    {
        socket.emit('ERROR', 'DATABASE ERROR: Session Check. ' + err);
        console.log('MEDIA: Error while performing session query. ' + err);
        socket.disconnect();
        connection.release();
        return;
    }
};

var chkParticipantMed = function(err, rows, fields, socket, connection)
{
    if (!err)
    {
        if (rows[0])
        {
            connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [mediaConnData[socket.id].roomId], function(err, rows, fields)
            {
                chkSessionMed(err, rows, fields, socket, connection);
            });
        }
        else
        {
            socket.emit('ERROR', 'User not allowed.');
            console.log('MEDIA: User not permitted to this session.');
            socket.disconnect();
            connection.release();
            return;
        }
    }
    else
    {
        socket.emit('ERROR', 'DATABASE ERROR: Participant Check. ' + err);
        console.log('MEDIA: Error while performing participant query. ' + err);
        socket.disconnect();
        connection.release();
        return;
    }

};

var findRoomMed = function(err, rows, fields, socket, connection, roomToken)
{
    if (!err)
    {
        if (rows[0])
        {
            mediaConnData[socket.id].roomId = rows[0].Room_ID;
            connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [mediaConnData[socket.id].roomId, mediaConnData[socket.id].userId], function(err, rows, fields)
            {
                chkParticipantMed(err, rows, fields, socket, connection);
            });
        }
        else
        {
            socket.emit('ERROR', 'Room does not exist.');
            console.log('MEDIA: Room ' + connection.escape(roomToken) + ' does not exist.');
            socket.disconnect();
            connection.release();
            return;
        }
    }
    else
    {
        socket.emit('ERROR', 'DATABASE ERROR: Room Check. ' + err);
        console.log('MEDIA: Error while performing room query. ' + err);
        socket.disconnect();
        connection.release();
        return;
    }
};


med_io.on('connection', function(socket)
{
    var params = socket.handshake.query;

    if(!mediaConnData[socket.id])
    {
        mediaConnData[socket.id] = {
            extra: [], isHost: false, isConnected: false, isJoining: false, ScalableBroadcast: false, roomId: 0, userId: 0, joinTimeout: null, startTime: null,
            sessLength: 0, username: ''
        };
    }

    console.log('MEDIA: User Connecting.....');
    let sessId = socket.handshake.headers.cookie.split("PHPSESSID=")[1].split(";")[0];

    if(!sessId)
    {
        console.error('MEDIA: ERROR: No session ID found in handshake.');
        return;
    }

    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    var joinTimeout = setTimeout(function()
    {
        console.log('MEDIA: Connection Timeout.');
        socket.disconnect();
    }, 60000);



    my_sql_pool.getConnection(function(err, connection)
    {
        connection.query('USE Users');
        connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [sessId], function(err, rows)
        {
            if (!err)
            {
                if (rows[0])
                {
                    let sessBuff = new Buffer(rows[0].Session_Data);
                    let sessData = sessBuff.toString('utf-8');
                    sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
                    sessData = sessData.slice(0, sessData.indexOf(';'));
                    mediaConnData[socket.id].userId = parseInt(sessData);

                    if(connMediaUsers[mediaConnData[socket.id].userId])
                    {
                        // TDOD Send message indicating reason
                        if(connMediaUsers[mediaConnData[socket.id].userId] != socket.id)
                        {
                            if(med_io.connected[connMediaUsers[mediaConnData[socket.id].userId]])
                            {
                                med_io.connected[connMediaUsers[mediaConnData[socket.id].userId]].disconnect();
                            }

                            connMediaUsers[mediaConnData[socket.id].userId] = socket.id;
                        }
                    }
                    else
                    {
                        connMediaUsers[mediaConnData[socket.id].userId] = socket.id;
                    }

                    connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [mediaConnData[socket.id].userId], function(err, rows)
                    {
                        if (!err)
                        {
                            if (rows[0] && rows[0].Username)
                            {
                                mediaConnData[socket.id].username = rows[0].Username;

                                connection.query('USE Online_Comms');
                                connection.query('UPDATE Room_Participants SET Socket_ID = ?, Username = ? WHERE User_ID = ?', [socket.id, mediaConnData[socket.id].username, mediaConnData[socket.id].userId], function(err, rows)
                                {
                                    if (!err)
                                    {
                                        socket.emit('READY', mediaConnData[socket.id].userId);
                                        connection.release();
                                        console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' passed initial connection.');
                                    }
                                    else
                                    {
                                        connection.release();
                                        socket.disconnect();
                                        console.log('MEDIA: Error setting socket ID in database.');
                                        return;
                                    }
                                });
                            }
                            else
                            {
                                connection.release();
                                socket.disconnect();
                                console.log('MEDIA: User ' + connection.escape(mediaConnData[socket.id].userId) +  ' not found.');
                                return;
                            }
                        }
                        else
                        {
                            connection.release();
                            socket.disconnect();
                            console.log('MEDIA: Error while performing user Query. ' + err);
                            return;
                        }
                    });
                }
                else
                {
                    connection.release();
                    socket.disconnect();
                    console.log('MEDIA: Session not found.');
                    return;
                }
            }
            else
            {
                connection.release();
                socket.disconnect();
                console.log('MEDIA: Error while performing session Query. ' + err);
                return;
            }


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

    socket.on('disconnect', function ()
    {
        try
        {
            mediaConnData[socket.id].isConnected = false;
            clearTimeout(mediaConnData[socket.id].joinTimeout);
            console.log('MEDIA: User disconnected.');
        }
        catch (e)
        {

        }
        finally
        {

        }
    });

    socket.on('GETID', function(extra)
    {
        try
        {
            console.log('Notifying user ' + mediaConnData[socket.id].userId + ' of their ID.');
            socket.emit('USERID', mediaConnData[socket.id].userId);
        }
        catch (e)
        {

        }
    });

    socket.on('LEAVE', function()
    {
        if(mediaConnData[socket.id].isConnected)
        {
            try
            {
                var clients = io.sockets.adapter.rooms[mediaConnData[socket.id].roomId];
                for (var clientId in clients)
                {
                    var clientSocket = io.sockets.connected[clientId];

                    //Tell the new user about everyone else
                    clientSocket.emit('LEAVE', mediaConnData[socket.id].userId);
                }

                socket.leave(mediaConnData[socket.id].roomId.toString());
            }
            catch (e)
            {

            }
            finally
            {
            }
        }
    });

    socket.on('RTC-Message', function(message, callback)
    {
        if(mediaConnData[socket.id].isConnected)
        {
            try
            {
                console.log(socket.id + ' Fowarding message to ' + message.remoteId + " User ID: " + message.payload.userId);
                socket.broadcast.to(message.remoteId).emit(message.type, message.payload);
            }
            catch (e)
            {

            }
        }
    });



    socket.on('JOIN-ROOM', function(roomToken: string)
    {
        try
        {
            console.log('MEDIA: User ' + mediaConnData[socket.id].userId + ' joining room ' + roomToken + '.......');

            if(!mediaConnData[socket.id].isJoining)
            {
                mediaConnData[socket.id].isJoining = true;


                my_sql_pool.getConnection(function(err, connection)
                {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function(err, rows, fields)
                    {
                        findRoomMed(err, rows, fields, socket, connection, roomToken)
                    });
                });
            }
        }
        catch (e)
        {
            socket.emit('ERROR');
            socket.disconnect();
            console.log('MEDIA: Error while attempting join-room, Details: ' + e);
        }
        finally
        {

        }
    });
});




/*
 *  Board socket, used for communicating whiteboard data.
 *
 *
 *
 *
 *
 */
var boardConnData : { [id: string] : BoardConnection } = {};
var connBoardUsers : { [id: number] : string } = {};
var roomUserList : { [id: number] : Array<number> } = {};

var sendStyle = function(nodeData, textId: number, socket: SocketIO.Socket) : void
{
    console.log('Sending user stylenode.');


    let msg: ServerStyleNodeMessage = {
        serverId: textId, num: nodeData.Seq_Num, text: nodeData.Text_Data, colour: nodeData.Colour, weight: nodeData.Weight, decoration:  nodeData.Decoration,
        style: nodeData.Style, start: nodeData.Start, end: nodeData.End, userId: 0, editId: 0
    };

    socket.emit('STYLENODE', msg);
}

var sendText = function(textData, socket: SocketIO.Socket) : void
{
    let msg: ServerEditTextMessage = {userId: 0, serverId: textData.Entry_ID, editId: 0, num_nodes: textData.Num_Style_Nodes};
    socket.emit('EDIT-TEXT', msg);

    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            connection.query('USE Online_Comms');
            connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?', [textData.Entry_ID], function(perr, prows, pfields)
            {
                if (perr)
                {
                    console.log('BOARD: Error while performing existing style nodes query. ' + perr);
                }
                else
                {
                    var i;
                    for(i = 0; i < prows.length; i++)
                    {
                        (function(data, textId) { setTimeout(function() { sendStyle(data, textId, socket); }, 100); })(prows[i], textData.Entry_ID);
                    }
                }
                connection.release();
            });
        }
        else
        {
            console.log('BOARD: Error while getting database connection to send curve. ' + err);
            connection.release();
        }
    });
}

var sendPoint = function(pointData, socket: SocketIO.Socket) : void
{
    let msg: ServerNewPointMessage = {serverId: pointData.Entry_ID, num: pointData.Seq_Num, x: pointData.X_Loc, y: pointData.Y_Loc};
    socket.emit('POINT', msg);
}

var sendCurve = function(curveData, socket: SocketIO.Socket) : void
{
    let msg: ServerNewCurveMessage = {
        serverId: curveData.Entry_ID, num_points: curveData.Num_Control_Points, colour: curveData.Colour, userId: curveData.User_ID, size: curveData.Size
    };
    socket.emit('CURVE', msg);

    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            connection.query('USE Online_Comms');
            connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [curveData.Entry_ID], function(perr, prows, pfields)
            {
                if (perr)
                {
                    console.log('BOARD: Error while performing existing control point query. ' + perr);
                }
                else
                {
                    var i;
                    for(i = 0; i < prows.length; i++)
                    {
                        (function(data) {setTimeout(function() {sendPoint(data, socket);}, 0);})(prows[i]);
                    }
                }
                connection.release();
            });
        }
        else
        {
            console.log('BOARD: Error while getting database connection to send curve. ' + err);
            connection.release();
        }
    });
}

var sendDataBor = function(socket: SocketIO.Socket) : void
{
    my_sql_pool.getConnection(function(err, connection)
    {
        connection.query('USE Online_Comms');
        connection.query('SELECT * FROM Whiteboard_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function(err, rows, fields)
        {
            if (err)
            {
                connection.release();
                console.log('BOARD: Error while performing existing curve query. ' + err);
            }
            else
            {
                // Send connecting user all data to date.
                var i;
                var data = rows;
                for(i = 0; i < rows.length; i++)
                {
                    (function(data, i) {setTimeout(function() {sendCurve(data[i], socket);}, i * 5)})(data, i);
                }

                connection.query('SELECT * FROM Text_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function(err, rows, fields)
                {
                    if (err)
                    {
                        connection.release();
                        console.log('BOARD: Error while performing existing text query. ' + err);
                    }
                    else
                    {
                        for(i = 0; i < rows.length; i++)
                        {
                            let msg: ServerNewTextboxMessage = {
                                serverId: rows[i].Entry_ID, userId: rows[i].User_ID, size: rows[i].Size, x: rows[i].Pos_X, editCount: 0,
                                y: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, editLock: rows[i].Edit_Lock, justified: rows[i].Justified
                            }
                            socket.emit('TEXTBOX', msg);

                            (function(data, i) {setTimeout(function() {sendText(data[i], socket);}, i * 5 + 100)})(rows, i);
                        }

                        connection.release();
                    }
                });
            }

        });
    });

}

var chkHost = function(err, rows, fields, socket: SocketIO.Socket, connection) : void
{
    if (err)
    {
        console.log('BOARD: Error while performing tutor id query. ' + err);
    }
    else
    {
        if(rows[0])
        {
            boardConnData[socket.id].isHost = true;
        }

        var currTime = new Date();
        setTimeout(function()
        {
            console.log('BOARD: Session over.')
            socket.disconnect();
        }, (boardConnData[socket.id].startTime.getTime() + boardConnData[socket.id].sessLength + 600000) - currTime.getTime());

        boardConnData[socket.id].isConnected = true;

        socket.emit('CONNOK');
        clearTimeout(boardConnData[socket.id].joinTimeout);
        clearTimeout(boardConnData[socket.id].disconnectTimeout);

        console.log('BOARD: User ' + boardConnData[socket.id].userId + ' successfully joined room ' + boardConnData[socket.id].roomId + '.');
        setTimeout(function() { sendDataBor(socket); }, 0);
    }
    connection.release();
}

var notifyBoardUser = function(client, socket: SocketIO.Socket) : void
{
    var msg : ServerBoardJoinMessage = {userId: boardConnData[client].userId, colour: roomUserList[boardConnData[client].roomId][boardConnData[client].userId]};
    socket.emit('JOIN', msg);
};

var processJoinBor = function(socket: SocketIO.Socket, connection) : void
{
    var colour : number;

    if(!roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId])
    {
        colour = colourTable[roomUserList[boardConnData[socket.id].roomId].length];
        roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId] = colour;
    }
    else
    {
        colour = roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId];
    }

    var msg : ServerBoardJoinMessage = {userId: boardConnData[socket.id].userId, colour: colour};
    bor_io.to(boardConnData[socket.id].roomId.toString()).emit('JOIN', msg);

    if(bor_io.adapter.rooms[boardConnData[socket.id].roomId])
    {
        var clients = bor_io.adapter.rooms[boardConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients)
        {
            (function(client) {setTimeout(notifyBoardUser(client, socket), 0)})(client);
        }
    }

    connection.query('USE Tutoring');
    connection.query('SELECT Tutor_ID FROM Tutor_Session WHERE Room_ID = ? AND Tutor_ID = ?', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId], function(err, rows, fields)
    {
        chkHost(err, rows, fields, socket, connection);
    });

    //New user joins the specified room
    socket.join(boardConnData[socket.id].roomId.toString());
};

var chkSessionBor = function(err, rows, fields, socket: SocketIO.Socket, connection) : void
{
    if (!err)
    {
        if (rows[0])
        {

            if (rows[0].Start_Time && rows[0].Session_Length)
            {
                boardConnData[socket.id].startTime = rows[0].Start_Time;
                boardConnData[socket.id].sessLength = rows[0].Session_Length * 1000;

                // TODO: Add time checks.

                if (rows[0].Host_Join_Time)
                {
                    processJoinBor(socket, connection);
                }
            }
            else
            {
                socket.emit('ERROR', 'Session failed to start.');
                console.log('BOARD: Session failed to start.');
                connection.release();
                socket.disconnect();
            }
        }
        else
        {
            socket.emit('ERROR', 'DATABASE ERROR: Unexpected Result.');
            console.log('BOARD: Session time produced an unexpected result.');
            connection.release();
            socket.disconnect();
        }
    }
    else
    {
        socket.emit('ERROR', 'DATABASE ERROR: Session Check. ' + err);
        console.log('BOARD: Error while performing session query. ' + err);
        connection.release();
        socket.disconnect();
    }
};

var chkParticipantBor = function(err, rows, fields, socket: SocketIO.Socket, connection) : void
{
    if (!err)
    {
        if (rows[0])
        {
            connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [boardConnData[socket.id].roomId], function(err, rows, fields)
            {
                chkSessionBor(err, rows, fields, socket, connection);
            });
        }
        else
        {
            socket.emit('ERROR', 'User not allowed.');
            console.log('BOARD: User not permitted to this session.');
            connection.release();
            socket.disconnect();
        }
    }
    else
    {
        socket.emit('ERROR', 'DATABASE ERROR: Participant Check. ' + err);
        console.log('BOARD: Error while performing participant query. ' + err);
        connection.release();
        socket.disconnect();
    }

};

var findRoomBor = function(err, rows, fields, socket: SocketIO.Socket, connection, roomToken: string) : void
{
    if (!err)
    {
        if (rows[0])
        {
            boardConnData[socket.id].roomId = rows[0].Room_ID;
            connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [boardConnData[socket.id].roomId, boardConnData[socket.id].userId], function(err, rows, fields)
            {
                chkParticipantBor(err, rows, fields, socket, connection);
            });
        }
        else
        {
            socket.emit('ERROR', 'Room does not exist.');
            console.log('BOARD: Room ' + connection.escape(roomToken) + ' does not exist.');
            connection.release();
            socket.disconnect();
        }
    }
    else
    {
        socket.emit('ERROR', 'DATABASE ERROR: Room Check. ' + err);
        console.log('BOARD: Error while performing room query. ' + err);
        connection.release();
        socket.disconnect();
    }
};

var missedText = function(textId: number, editId: number, socket: SocketIO.Socket) : void
{
    for(var i = 0; i < boardConnData[socket.id].numNodes[textId]; i++)
    {
        if(!boardConnData[socket.id].recievedNodes[textId][i])
        {
            boardConnData[socket.id].nodeRetries[textId]++;
            if(boardConnData[socket.id].nodeRetries[textId] > 10 || boardConnData[socket.id].cleanUp)
            {
                clearInterval(boardConnData[socket.id].textTimeouts[textId]);
                boardConnData[socket.id].recievedNodes[textId] = [];

                if(boardConnData[socket.id].isConnected)
                {
                    // TODO:
                    socket.emit('DROPPED-TEXT', {id: editId});
                }

                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [textId], function(err, result)
                        {
                            if(!err)
                            {
                                connection.query('DELETE FROM Text_Space WHERE Entry_ID = ?', [textId], function(err, result)
                                {
                                    if(err)
                                    {
                                        console.log('BOARD: Error while removing badly formed text. ' + err);
                                    }
                                    connection.release();
                                });
                            }
                            else
                            {
                                console.log('BOARD: Error while removing badly formed text. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        connection.release();
                        console.log('BOARD: Error while getting database connection to remove malformed text. ' + err);
                    }
                });
                return;
            }
            else
            {
                if(boardConnData[socket.id].isConnected)
                {
                    let msg: ServerMissedTextMessage = {serverId: textId, editId: editId};
                    socket.emit('MISSED-TEXT', msg);
                }
            }
        }
    }
};

var missedPoints = function(curveId: number, socket: SocketIO.Socket) : void
{
    for(var i = 0; i < boardConnData[socket.id].numPoints[curveId]; i++)
    {
        if(!boardConnData[socket.id].recievedPoints[curveId][i])
        {
            boardConnData[socket.id].pointRetries[curveId]++;
            if(boardConnData[socket.id].pointRetries[curveId] > 10 || boardConnData[socket.id].cleanUp)
            {
                clearInterval(boardConnData[socket.id].curveTimeouts[curveId]);
                boardConnData[socket.id].recievedPoints[curveId] = [];

                if(boardConnData[socket.id].isConnected)
                {
                    socket.emit('DROPPED-CURVE', curveId);
                }

                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('DELETE FROM Control_Points WHERE Entry_ID = ?', [curveId], function(err, result)
                        {
                            if(!err)
                            {
                                connection.query('DELETE FROM Whiteboard_Space WHERE Entry_ID = ?', [curveId], function(err, result)
                                {
                                    if(err)
                                    {
                                        console.log('BOARD: Error while removing badly formed curve. ' + err);
                                    }
                                    connection.release();
                                });
                            }
                            else
                            {
                                console.log('BOARD: Error while removing badly formed curve. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        connection.release();
                        console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    }
                });
                return;
            }
            else
            {
                if(boardConnData[socket.id].isConnected)
                {
                    let msg: ServerMissedPointMessage = {serverId: curveId, num: i};
                    socket.emit('MISSED-CURVE', msg);
                }
            }
        }
    }
};

var sendMissingCurve = function(data : UserMissingCurveMessage, socket: SocketIO.Socket) : void
{
    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            console.log('BOARD: Looking for Curve ID: ' + data.serverId + ' sequence number: ' + data.seq_num);
            connection.query('USE Online_Comms');
            connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? ', [data.serverId],  function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while performing control point query.' + err);
                }
                else
                {
                    if(rows[0])
                    {
                        connection.query('SELECT X_Loc, Y_Loc FROM Control_Points WHERE Entry_ID = ? AND Seq_Num = ?', [data.serverId, data.seq_num],  function(err, rows, fields)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing control point query.' + err);
                            }
                            else
                            {
                                if(rows[0])
                                {
                                    var retData : ServerNewPointMessage = {serverId: data.serverId, num: data.seq_num, x: rows[0].X_Loc, y: rows[0].Y_Loc};
                                    socket.emit('POINT', retData);
                                }
                            }
                        });
                    }
                    else
                    {
                        socket.emit('IGNORE-CURVE', data.serverId);
                    }
                }
                connection.release();
            });
        }
        else
        {
            connection.release();
            console.log('BOARD: Error while getting database connection to send missing data. ' + err);
        }
    });
};

var sendMissingText = function(data: UserMissingTextMessage, socket: SocketIO.Socket) : void
{
    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            console.log('BOARD: Looking for Text ID: ' + data.serverId + ' sequence number: ' + data.seq_num);
            connection.query('USE Online_Comms');
            connection.query('SELECT Entry_ID FROM Text_Space WHERE Entry_ID = ? ', [data.serverId],  function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while performing text node query.' + err);
                }
                else
                {
                    if(rows[0])
                    {
                        connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ? AND Seq_Num = ?', [data.serverId, data.seq_num],  function(err, rows, fields)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing text node query.' + err);
                            }
                            else
                            {
                                if(rows[0])
                                {
                                    sendStyle(rows[0], data.serverId, socket);
                                }
                            }
                        });
                    }
                    else
                    {
                        socket.emit('IGNORE-TEXT', data.serverId);
                    }
                }
                connection.release();
            });
        }
        else
        {
            connection.release();
            console.log('BOARD: Error while getting database connection to send missing data. ' + err);
        }
    });
};

var addNode = function(textNode: TextStyle, textId: number, editId: number, socket: SocketIO.Socket) : void
{
    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            connection.query('USE Online_Comms');
            connection.query('INSERT INTO Text_Style_Node(Entry_ID, Seq_Num, Text_Data, Colour, Weight, Decoration, Style, Start, End) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [textId, textNode.num, textNode.text, textNode.colour, textNode.weight, textNode.decoration, textNode.style, textNode.start, textNode.end],
            function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while performing new style node query. ' + err);
                }
                else
                {

                    var msg : ServerStyleNodeMessage = {
                        editId: editId, userId: boardConnData[socket.id].userId, weight: textNode.weight, decoration: textNode.decoration, num: textNode.num,
                        style: textNode.style, colour: textNode.colour, start: textNode.start, end: textNode.end, text: textNode.text, serverId: textId
                    };
                    socket.to(boardConnData[socket.id].roomId.toString()).emit('STYLENODE', msg);
                }
                connection.release();
            });

        }
        else
        {
            console.log('BOARD: Error while getting database connection to add new style node. ' + err);
            connection.release();
        }
    });
};


var comleteEdit = function(editId: number, socket: SocketIO.Socket) : void
{
    var i;
    var textId = boardConnData[socket.id].editIds[editId].textId;

    clearTimeout(boardConnData[socket.id].textTimeouts[editId]);

    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            connection.query('USE Online_Comms');
            connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [textId],
            function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while performing remove old nodes query. ' + err);
                    connection.release();
                }
                else
                {
                    for(i = 0; i < boardConnData[socket.id].recievedNodes[editId].length; i++)
                    {
                        (function(nodeData, textId, editId) { setTimeout(addNode(nodeData, textId, editId, socket), 0); })(boardConnData[socket.id].recievedNodes[editId][i], textId, editId);
                    }

                    connection.query('UPDATE Text_Space SET Num_Style_Nodes = ? WHERE Entry_ID = ?', [boardConnData[socket.id].recievedNodes[editId].length, textId],
                    function(err, rows, fields)
                    {
                        if(err)
                        {
                            console.log('BOARD: Error updating the number of style nodes. ' + err);
                        }
                        connection.release();
                    });
                }

            });

        }
        else
        {
            console.log('BOARD: Error while getting database connection to remove old nodes. ' + err);
            connection.release();
        }
    });

};

var cleanConnection = function(socketID: string) : void
{
    console.log('Cleaning Connection....');

    boardConnData[socketID].cleanUp = true;

    if(boardConnData[socketID].isConnected)
    {
        my_sql_pool.getConnection(function(err, connection)
        {
            if(!err)
            {
                connection.query('USE Online_Comms');
                connection.query('UPDATE Text_Space SET Edit_Lock = 0 WHERE Edit_Lock = ?', [boardConnData[socketID].userId], function(err, rows, fields)
                {
                    if(err)
                    {
                        console.log('BOARD: Error cleaning connection. ERROR: ' + err);
                    }
                    connection.release();
                });
            }
            else
            {
                console.log('BOARD: Error getting connection to clean connection. ERROR: ' + err);
            }
        });
    }


};

var endConnection = function(socketID: number) : void
{
    boardConnData[socketID].isConnected = false;
};


/***************************************************************************************************************************************************************
 *  Board socket, used for communicating whiteboard data.
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
bor_io.on('connection', function(socket)
{

    if(!boardConnData[socket.id])
    {
        boardConnData[socket.id] = {
            editCount: 1, isHost: false, isConnected: false, isJoining: false, curveTimeouts: [], textTimeouts: [], recievedPoints: [], pointRetries: [],
            numRecieved: [], numPoints: [], numNodes: [], recievedNodes: [], nodeRetries: [], editIds: [], cleanUp: false, sessId: 0, roomId: 0, userId: 0,
            joinTimeout: null, startTime: null, sessLength: 0, username: ''
        };
    }

    console.log('BOARD: User Connecting.....');
    boardConnData[socket.id].sessId = socket.handshake.headers.cookie.split("PHPSESSID=")[1].split(";")[0];
    boardConnData[socket.id].cleanUp = false;

    if(!boardConnData[socket.id].sessId)
    {
        console.error('BOARD: ERROR: No session ID found in handshake.');
        return;
    }

    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    boardConnData[socket.id].joinTimeout = setTimeout(function()
    {
        console.log('BOARD: Connection Timeout.');
        socket.disconnect();
    }, 60000);


    console.log('Setting up listeners');

    socket.on('disconnect', function ()
    {

        try
        {
            clearTimeout(boardConnData[socket.id].joinTimeout);

            console.log('Setting connection clean callback.');

            cleanConnection(socket.id);
            boardConnData[socket.id].disconnectTimeout = setTimeout(endConnection, 5000, socket.id);

            console.log('BOARD: User disconnected.');
        }
        catch (e)
        {

        }
        finally
        {

        }
    });

    socket.on('JOIN-ROOM', function(roomToken: string)
    {
        try
        {
            console.log('BOARD: User ' + boardConnData[socket.id].userId + ' joining room ' + roomToken + '.......');

            if(!boardConnData[socket.id].isJoining)
            {
                boardConnData[socket.id].isJoining = true;

                my_sql_pool.getConnection(function(err, connection)
                {

                    connection.query('USE Online_Comms');
                    connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], function(err, rows, fields)
                    {
                        findRoomBor(err, rows, fields, socket, connection, roomToken);
                    });
                });
            }
        }
        catch (e)
        {
            socket.emit('ERROR');
            socket.disconnect();
            console.log('BOARD: Error while attempting join-room, Details: ' + e);
        }
        finally
        {

        }
    });

    socket.on('LEAVE', function()
    {
        if(boardConnData[socket.id].isConnected)
        {
            try
            {

                socket.leave(boardConnData[socket.id].roomId.toString());
            }
            catch (e)
            {

            }
            finally
            {

            }
        }
    });



    // Listens for a new curve, tells user which ID to assign it to and makes sure everyhting is set to recieve the full curve.
    // 'Points' are dealt with as curves with only a single control point.
    socket.on('CURVE', function(data: UserNewCurveMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('BOARD: Received curve.');
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    if(typeof(data.localId) != 'undefined' && data.num_points && data.colour)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Whiteboard_Space(Room_ID, User_ID, Local_ID, Edit_Time, Num_Control_Points, Colour, Size) VALUES(?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)',
                        [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.localId, data.num_points, data.colour, data.size],
                        function(err, result)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing new curve query.' + err);
                            }
                            else
                            {
                                boardConnData[socket.id].numRecieved[result.insertId] = 0;
                                boardConnData[socket.id].numPoints[result.insertId] = data.num_points;
                                boardConnData[socket.id].recievedPoints[result.insertId] = [];
                                boardConnData[socket.id].pointRetries[result.insertId] = 0;

                                console.log('BOARD: Sending curve ID: ' + result.insertId);

                                var idMsg : ServerCurveIdMessage = { serverId: result.insertId, localId: data.localId };
                                // Tell the user the ID to assign points to.
                                socket.emit('CURVEID', idMsg);

                                var curveMsg : ServerNewCurveMessage = {
                                    serverId: result.insertId, userId: boardConnData[socket.id].userId,
                                    size: data.size, colour: data.colour, num_points: data.num_points
                                };
                                socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('CURVE', curveMsg);

                                // Set a 5 sec timeout to inform the client of missing points.
                                boardConnData[socket.id].curveTimeouts[result.insertId] = setInterval(function() {missedPoints(result.insertId, socket);}, 5000);
                            }
                        });
                    }
                }
                else
                {
                    console.log('BOARD: Error while getting database connection to add new curve. ' + err);
                }
                connection.release();
            });
        }
    });

    //Listens for points as part of a curve, must recive a funn let from the initiation.
    socket.on('POINT', function(data : UserNewPointMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    if(!boardConnData[socket.id].recievedPoints[data.serverId][data.num])
                    {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES(?, ?, ?, ?)', [data.serverId, data.num, data.x, data.y], function(err, rows, fields)
                        {
                            if (err)
                            {
                                console.log('ID: ' + data.serverId);
                                console.log('Seq_Num: ' + data.num);
                                console.log('BOARD: Error while performing new control point query. ' + err);
                            }
                            else
                            {
                                var msg : ServerNewPointMessage = {serverId: data.serverId, num: data.num, x: data.x, y: data.y};
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('POINT', msg);

                                boardConnData[socket.id].recievedPoints[data.serverId][data.num] = true;
                                boardConnData[socket.id].numRecieved[data.serverId]++;

                                if(boardConnData[socket.id].numRecieved[data.serverId] == boardConnData[socket.id].numPoints[data.serverId])
                                {
                                    // We recived eveything so clear the timeout and give client the OK.
                                    clearInterval(boardConnData[socket.id].curveTimeouts[data.serverId]);
                                }
                            }
                            connection.release();
                        });
                    }
                }
                else
                {
                    console.log('BOARD: Error while getting database connection to add new control point. ' + err);
                    connection.release();
                }
            });
        }
    });

    socket.on('DELETE-CURVE', function(curveId: number)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('Received Delete Curve Event.');
            if(boardConnData[socket.id].isHost)
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [curveId], function(err, rows)
                        {
                            if (!err)
                            {
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-CURVE', curveId);
                            }
                            else
                            {
                                console.log('BOARD: Error while performing erase curve query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to delete curve. ' + err);
                        connection.release();
                    }
                });
            }
            else
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [curveId, boardConnData[socket.id].userId], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [curveId], function(err, rows)
                                    {
                                        if (!err)
                                        {
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-CURVE', curveId);
                                        }
                                        else
                                        {
                                            console.log('BOARD: Error while performing erase curve query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else
                            {
                                console.log('BOARD: Error while performing erase:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to delete curve. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });

    socket.on('MOVE-CURVE', function(data : UserMoveElementMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('Received Move Curve Event.');
            if(boardConnData[socket.id].isHost)
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Control_Points SET X_Loc = (X_Loc + ?), Y_Loc = (Y_Loc + ?) WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                        {
                            if (!err)
                            {
                                var msg: ServerMoveElementMessage = {serverId: data.serverId, x: data.x, y: data.y};
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-CURVE', msg);
                            }
                            else
                            {
                                console.log('BOARD: Error while performing move curve query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to move curve. ' + err);
                        connection.release();
                    }
                });
            }
            else
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('UPDATE Control_Points SET X_Loc = (X_Loc + ?), Y_Loc = (Y_Loc + ?) WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                                    {
                                        if (!err)
                                        {
                                            var msg: ServerMoveElementMessage = {serverId: data.serverId, x: data.x, y: data.y};
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-CURVE', msg);
                                        }
                                        else
                                        {
                                            console.log('BOARD: Error while performing move curve query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else
                            {
                                console.log('BOARD: Error while performing move:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to move curve. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });

    // Listen for cliets requesting missing data.
    socket.on('MISSING-CURVE', function(data : UserMissingCurveMessage)
    {
        console.log('BOARD: Received missing message.');
        if(boardConnData[socket.id].isConnected)
        {
            setTimeout(function() {sendMissingCurve(data, socket);}, 0);
        }
    });

    // Listen for cliets recieving points without curve.
    socket.on('UNKNOWN-CURVE', function(curveId: number)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    // Send client curve data if available, client may then request missing points.
                    connection.query('SELECT Room_ID, User_ID, Local_ID, Num_Control_Points, Colour, Size FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [curveId, boardConnData[socket.id].roomId],  function(err, rows, fields)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while performing curve query.' + err);
                        }
                        else
                        {
                            if(rows[0])
                            {
                                var retData : ServerNewCurveMessage = {
                                    serverId: curveId, userId: rows[0].User_ID as number, num_points: rows[0].Num_Control_Points as number,
                                    colour: rows[0].Colour as string, size: rows[0].Size as number
                                };
                                socket.emit('CURVE', retData);
                            }
                        }
                        connection.release();
                    });
                }
                else
                {
                    connection.release();
                    console.log('BOARD: Error while getting database connection to send missing curve ID. ' + err);
                }
            });
        }
    });


    /* Textbox listeners.
     *
     *
     *
     */
    socket.on('TEXTBOX', function(data : UserNewTextMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    if(typeof(data.localId) != 'undefined')
                    {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Text_Space(Room_ID, User_ID, Local_ID, Post_Time, Num_Style_Nodes, Size, Pos_X, Pos_Y, Width, Height, Edit_Lock, Justified) VALUES(?, ?, ?, CURRENT_TIMESTAMP, 0, ?, ?, ?, ?, ?, ?, ?)',
                        [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.localId, data.size, data.x, data.y, data.width, data.height, boardConnData[socket.id].userId, data.justified],
                        function(err, result)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing new textbox query.' + err);
                            }
                            else
                            {
                                var idMsg : ServerTextIdMessage = {serverId: result.insertId, localId: data.localId};
                                // Tell the user the ID to assign points to.
                                socket.emit('TEXTID', idMsg);

                                var textMsg : ServerNewTextboxMessage = {
                                    serverId: result.insertId, userId: boardConnData[socket.id].userId, editLock: boardConnData[socket.id].userId,
                                    x: data.x, y: data.y, width: data.width, height: data.height, size: data.size, justified: data.justified, editCount: 0
                                };
                                socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('TEXTBOX', textMsg);
                            }
                        });
                    }
                    else
                    {
                        console.log('Uh Oh, some malformed data appeared.');
                    }
                }
                else
                {
                    console.log('BOARD: Error while getting database connection to add new textbox. ' + err);
                }
                connection.release();
            });
        }
    });


    socket.on('EDIT-TEXT', function(data: UserEditTextMessage)
    {
        // TODO: Need to check for lock
        if(boardConnData[socket.id].isConnected)
        {
            boardConnData[socket.id].editIds[boardConnData[socket.id].editCount] = {textId: data.serverId, localId: data.localId};
            boardConnData[socket.id].recievedNodes[boardConnData[socket.id].editCount] = [];
            boardConnData[socket.id].numNodes[boardConnData[socket.id].editCount] = data.num_nodes;
            boardConnData[socket.id].nodeRetries[boardConnData[socket.id].editCount] = 0;

            var idMsg : ServerEditIdMessage = {editId: boardConnData[socket.id].editCount, bufferId: data.bufferId, localId: data.localId};
            socket.emit('EDITID-TEXT', idMsg);

            var editMsg : ServerEditTextMessage = {
                serverId: data.serverId, userId: boardConnData[socket.id].userId, editId: boardConnData[socket.id].editCount, num_nodes: data.num_nodes
            };
            socket.to(boardConnData[socket.id].roomId.toString()).emit('EDIT-TEXT', editMsg);


            // Set a 1 min timeout to inform the client of missing edit data.
            boardConnData[socket.id].textTimeouts[boardConnData[socket.id].editCount] = (function(textId, editId)
            {
                setTimeout(function() { missedText(textId, editId, socket); }, 60000);
            })(data.serverId, boardConnData[socket.id].editCount);

            boardConnData[socket.id].editCount++;
        }
    });

    //Listens for points as part of a curve, must recive a funn let from the initiation.
    socket.on('STYLENODE', function(data : UserStyleNodeMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            if(!boardConnData[socket.id].recievedNodes[data.editId])
            {
                console.error('Bad data. Socket ID: ' + socket.id + ' EditID: ' + data.editId);
            }

            var newNode : TextStyle = {
                start: data.start, end: data.end, text: data.text, num: data.num, weight: data.weight, decoration: data.decoration, style: data.style,
                colour: data.colour
            };
            boardConnData[socket.id].recievedNodes[data.editId].push(newNode);

            if(boardConnData[socket.id].recievedNodes[data.editId].length == boardConnData[socket.id].numNodes[data.editId])
            {
                comleteEdit(data.editId, socket);
            }
        }
    });

    socket.on('JUSTIFY-TEXT', function(data : UserJustifyTextMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function(err, rows, fields)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error getting textbox justify state. ' + err);
                            connection.release();
                        }
                        else
                        {
                            if(rows[0].Edit_Lock == boardConnData[socket.id].userId)
                            {
                                connection.query('UPDATE Text_Space SET Justified = ? WHERE Entry_ID = ?', [data.newState, data.serverId], function(err, rows, fields)
                                {
                                    if (err)
                                    {
                                        console.log('BOARD: Error while updating textbox justify state. ' + err);
                                    }
                                    else
                                    {
                                        var msg: ServerJustifyTextMessage = {serverId: data.serverId, newState: data.newState};
                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('JUSTIFY-TEXT', msg);
                                    }
                                    connection.release();
                                });
                            }
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error while getting database connection to change textbox justify state. ' + err);
                    connection.release();
                }
            });
        }
    });

    socket.on('LOCK-TEXT', function(data : UserLockTextMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            if(boardConnData[socket.id].isHost)
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function(err, rows, fields)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error getting textbox lock state. ' + err);
                                connection.release();
                            }
                            else
                            {
                                if(!rows[0].Edit_Lock)
                                {
                                    connection.query('UPDATE Text_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData[socket.id].userId, data.serverId], function(err, rows, fields)
                                    {
                                        if (err)
                                        {
                                            console.log('BOARD: Error while updating textbox loxk state. ' + err);
                                        }
                                        else
                                        {
                                            var idMsg : ServerLockIdMessage = {serverId: data.serverId};
                                            socket.emit('LOCKID-TEXT', idMsg);
                                            var lockMsg : ServerLockTextMessage = {serverId: data.serverId, userId: boardConnData[socket.id].userId};
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('LOCK-TEXT', lockMsg);
                                        }
                                        connection.release();
                                    });
                                }
                                else
                                {
                                    var refMsg : ServerRefusedTextMessage = {serverId: data.serverId};
                                    socket.emit('REFUSED-TEXT', refMsg);
                                    connection.release();
                                }
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to edit style node. ' + err);
                        connection.release();
                    }
                });
            }
            else
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function(err, rows, fields)
                                    {
                                        if (err)
                                        {
                                            console.log('BOARD: Error getting textbox lock state. ' + err);
                                            connection.release();
                                        }
                                        else
                                        {
                                            if(!rows[0].Edit_Lock)
                                            {
                                                connection.query('UPDATE Text_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData[socket.id].userId, data.serverId], function(err, rows, fields)
                                                {
                                                    if (err)
                                                    {
                                                        console.log('BOARD: Error while updating textbox loxk state. ' + err);
                                                    }
                                                    else
                                                    {
                                                        var idMsg : ServerLockIdMessage = {serverId: data.serverId};
                                                        socket.emit('LOCKID-TEXT', idMsg);
                                                        var lockMsg : ServerLockTextMessage = {serverId: data.serverId, userId: boardConnData[socket.id].userId};
                                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('LOCK-TEXT', lockMsg);
                                                    }
                                                    connection.release();
                                                });
                                            }
                                            else
                                            {
                                                var refMsg : ServerRefusedTextMessage = {serverId: data.serverId};
                                                socket.emit('REFUSED-TEXT', refMsg);
                                                connection.release();
                                            }
                                        }
                                    });
                                }
                            }
                            else
                            {
                                console.log('BOARD: Error while performing textLock:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to lock text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });


    socket.on('RELEASE-TEXT', function(data : UserReleaseTextMessage)
    {
        console.log('Received release for: ' + data.serverId);
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.serverId], function(err, rows, fields)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error releasing textbox lock state. ' + err);
                            connection.release();
                        }
                        else
                        {
                            if(!rows[0])
                            {
                                console.log('No row. Data ID: ' + data.serverId);
                                connection.release();
                            }
                            else if(rows[0].Edit_Lock == boardConnData[socket.id].userId)
                            {
                                connection.query('UPDATE Text_Space SET Edit_Lock = 0 WHERE Entry_ID = ?', [data.serverId], function(err, rows, fields)
                                {
                                    if (err)
                                    {
                                        console.log('BOARD: Error while updating textbox lock state. ' + err);
                                    }
                                    else
                                    {
                                        var msg : ServerReleaseTextMessage = {serverId: data.serverId};
                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('RELEASE-TEXT', msg);
                                    }
                                    connection.release();
                                });
                            }
                            else
                            {
                                connection.release();
                            }
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error while getting database connection to release text lock. ' + err);
                    connection.release();
                }
            });
        }
    });


    socket.on('MOVE-TEXT', function(data : UserMoveElementMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('Received Move Text Event.');
            if(boardConnData[socket.id].isHost)
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Text_Space SET Pos_X = ?, Pos_Y = ? WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                        {
                            if (!err)
                            {
                                var msg: ServerMoveElementMessage = {serverId: data.serverId, x: data.x, y:data.y};
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-TEXT', msg);
                            }
                            else
                            {
                                console.log('BOARD: Error while performing move text query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to move text. ' + err);
                        connection.release();
                    }
                });
            }
            else
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('UPDATE Text_Space SET Pos_X = ?, Pos_Y = ? WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                                    {
                                        if (!err)
                                        {
                                            var msg: ServerMoveElementMessage = {serverId: data.serverId, x: data.x, y:data.y};
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-TEXT', msg);
                                        }
                                        else
                                        {
                                            console.log('BOARD: Error while performing move text query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else
                            {
                                console.log('BOARD: Error while performing move text:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to move text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });


    socket.on('RESIZE-TEXT', function(data: UserResizeTextMessage)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('Received Resize Text Event.');
            if(boardConnData[socket.id].isHost)
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Text_Space SET Width = ?, Height = ? WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function(err, rows)
                        {
                            if (!err)
                            {
                                var msg: ServerResizeTextMessage = {serverId: data.serverId, width: data.width, height: data.height};
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-TEXT', msg);
                            }
                            else
                            {
                                console.log('BOARD: Error while performing resize text query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to resize text. ' + err);
                        connection.release();
                    }
                });
            }
            else
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('UPDATE Text_Space SET Width = ?, Height = ? WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function(err, rows)
                                    {
                                        if (!err)
                                        {
                                            var msg: ServerResizeTextMessage = {serverId: data.serverId, width: data.width, height: data.height};
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-TEXT', msg);
                                        }
                                        else
                                        {
                                            console.log('BOARD: Error while performing resize text query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else
                            {
                                console.log('BOARD: Error while performing resize text:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to resize text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });


    socket.on('DELETE-TEXT', function(textId: number)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('Received Delete Text Event. Text ID: ' + textId);
            if(boardConnData[socket.id].isHost)
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('UPDATE Text_Space SET isDeleted = 1 WHERE Entry_ID = ?', [textId], function(err, rows)
                        {
                            if (!err)
                            {
                                socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-TEXT', textId);
                            }
                            else
                            {
                                console.log('BOARD: Error while performing erase text query. ' + err);
                            }
                            connection.release();
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to delete text. ' + err);
                        connection.release();
                    }
                });
            }
            else
            {
                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID', [textId, boardConnData[socket.id].userId], function(err, rows)
                        {
                            console.log('Cleared User.');
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('UPDATE Text_Space SET isDeleted = 1 WHERE Entry_ID = ?', [textId], function(err, rows)
                                    {
                                        if (!err)
                                        {
                                            socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-TEXT', textId);
                                        }
                                        else
                                        {
                                            console.log('BOARD: Error while performing erase text query. ' + err);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                            else
                            {
                                console.log('BOARD: Error while performing erase text:findUser query. ' + err);
                                connection.release();
                            }
                        });
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to delete text. ' + err);
                        connection.release();
                    }
                });
            }
        }
    });


    // Listen for cliets requesting missing data.
    socket.on('MISSING-TEXT', function(data: UserMissingTextMessage)
    {
        console.log('BOARD: Received missing message.');
        if(boardConnData[socket.id].isConnected)
        {
            setTimeout(function() {sendMissingText(data, socket);}, 0);
        }
    });

    // Listen for cliets recieving nodes without textbox.
    socket.on('UNKNOWN-TEXT', function(textId: number)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [textId], function(err, rows, fields)
                    {
                        if (err)
                        {
                            connection.release();
                            console.log('BOARD: Error while performing existing text query. ' + err);
                        }
                        else
                        {
                            if(rows[0])
                            {
                                var msg: ServerNewTextboxMessage = {
                                    serverId: rows[0].Entry_ID, userId: rows[0].User_ID, size: rows[0].Size,
                                    x: rows[0].Pos_X, y: rows[0].Pos_Y, width: rows[0].Width, height: rows[0].Height,
                                    editLock: rows[0].Edit_Lock, justified: rows[0].isJustified, editCount: 0
                                }
                                socket.emit('TEXTBOX', msg);

                                (function(data) {setTimeout(function() {sendText(data, socket);}, 100)})(rows[0]);
                            }

                            connection.release();
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error while getting database connection for unknown text. ' + err);
                    connection.release();
                }
            });
        }
    });

    // Listen for cliets recieving nodes without edit.
    socket.on('UNKNOWN-EDIT', function(editId: number)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [editId], function(err, rows, fields)
                    {
                        if (err)
                        {
                            connection.release();
                            console.log('BOARD: Error while performing existing text query. ' + err);
                        }
                        else
                        {
                            if(rows[0])
                            {
                                (function(data) {setTimeout(function() {sendText(data, socket);}, 100)})(rows[0]);
                            }

                            connection.release();
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error while getting database connection for unknown edit. ' + err);
                    connection.release();
                }
            });
        }
    });

    socket.on('HIGHTLIGHT', function(data)
    {
        // TODO: Message interface
        socket.to(boardConnData[socket.id].roomId.toString()).emit('HIGHLIGHT', data);
    });

    console.log('Finished with listeners.');

    my_sql_pool.getConnection(function(err, connection)
    {
        console.log('Tried getting connection.');

        if(!err)
        {
            connection.query('USE Users');
            connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [boardConnData[socket.id].sessId], function(err, rows)
            {
                if (!err)
                {
                    if (rows[0])
                    {
                        let sessBuff = new Buffer(rows[0].Session_Data);
                        let sessData = sessBuff.toString('utf-8');
                        sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
                        sessData = sessData.slice(0, sessData.indexOf(';'));
                        boardConnData[socket.id].userId = parseInt(sessData);

                        if(connBoardUsers[boardConnData[socket.id].userId])
                        {
                            // TDOD Send message indicating reason
                            if(connBoardUsers[boardConnData[socket.id].userId] != socket.id)
                            {
                                if(bor_io.connected[connBoardUsers[boardConnData[socket.id].userId]])
                                {
                                    bor_io.connected[connBoardUsers[boardConnData[socket.id].userId]].disconnect();
                                }
                                connBoardUsers[boardConnData[socket.id].userId] = socket.id;
                            }
                        }
                        else
                        {
                            connBoardUsers[boardConnData[socket.id].userId] = socket.id;
                        }

                        connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [boardConnData[socket.id].userId], function(err, rows)
                        {
                            if (!err)
                            {
                                if (rows[0] && rows[0].Username)
                                {
                                    boardConnData[socket.id].username = rows[0].Username;
                                    socket.emit('READY', boardConnData[socket.id].userId);
                                    console.log('BOARD: User ' + boardConnData[socket.id].userId + ' passed initial connection.');
                                    connection.release();
                                }
                                else
                                {
                                    connection.release();
                                    socket.disconnect();
                                    console.log('BOARD: User ' + connection.escape(boardConnData[socket.id].userId) +  ' not found.');
                                    return;
                                }
                            }
                            else
                            {
                                connection.release();
                                socket.disconnect();
                                console.log('BOARD: Error while performing user Query. ' + err);
                                return;
                            }
                        });
                    }
                    else
                    {
                        connection.release();
                        socket.disconnect();
                        console.log('BOARD: Session not found.');
                        return;
                    }
                }
                else
                {
                    connection.release();
                    socket.disconnect();
                    console.log('BOARD: Error while performing session Query. ' + err);
                    return;
                }
            });
        }
        else
        {
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

var checkServers = function(err, rows, connection)
{
    if(!err)
    {
        if(!rows[0])
        {
            connection.query('INSERT INTO Tutorial_Servers(End_Point, Zone) VALUES(?, ?) ', [endPointAddr, zone], function(err, rows)
            {
                if(err)
                {
                    console.log('Error registering server in list. ' + err);
                }

                connection.release();
            });
        }
        else
        {
            console.log('Server already in list.');
            connection.release();
        }
    }
    else
    {
        console.log('Error registering server in list. ' + err);
    }
}

var getServerData = function(chunk)
{
    console.log('Zone: ' + chunk);
    zone = chunk;

    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            var qStr;
            console.log('Adding to server list.......');

            connection.query('USE Online_Comms');
            connection.query('SELECT * FROM Tutorial_Servers WHERE End_Point = ?', [endPointAddr], function(err, rows)
            {
                if(err)
                {
                    console.log('Error registering server in list. ' + err);
                    connection.release();
                }
                else
                {
                    checkServers(err, rows, connection);
                }
            });
        }
        else
        {
            console.log('BOARD: Error getting connection from pool. ' + err);
            return;
        }
    });
}

require('http').get(reqOpt, function(res)
{
    console.log("Got response for end point request: " + res.statusCode);


    res.on('data', function (chunk)
    {
        if(res.statusCode == 200)
        {
            console.log('End Point: ' + chunk);
            endPointAddr = chunk;

            reqOpt = {
              host: '169.254.169.254',
              port: 80,
              path: '/latest/meta-data/placement/availability-zone'
            };

            require('http').get(reqOpt, function(res)
            {
                console.log("Got response for zone: " + res.statusCode);

                if(res.statusCode == 200)
                {
                    res.on('data', getServerData);
                }

            }).on('error', function(e)
            {
                console.log("Error retrieving server endpoint: " + e.message);
            });
        }
    });
}).on('error', function(e)
{
    console.log("Error retrieving server endpoint: " + e.message);
});

https.listen(9001, function()
{
    console.log("Server listening at", "*:" + 9001);
});
