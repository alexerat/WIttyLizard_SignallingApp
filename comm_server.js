var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var PHPUnserialize = require('php-unserialize');
var parseCookie = require('cookie-parser');
var mysql      = require('mysql');

var dbHost = process.env.DATABASE_HOST;
var dbUser = process.env.DATABASE_USER;
var dbPass = process.env.DATABASE_PASSWORD;

var my_sql_pool = mysql.createPool({
  host     : dbHost,
  user     : dbUser,
  password : dbPass,
  database : 'Online_Comms'
});

var txt_io = io.of('/text');
var med_io = io.of('/media');
var bor_io = io.of('/board');

app.use(parseCookie('7e501ffeb426888ea59e63aa15b931a7f9d28d24'));

/*
 *  Media signalling server
 *
 *
 *
 *
 *
 */
med_io.on('connection', function(socket)
{
    var params = socket.handshake.query;

    var extra = {};
    var isPublic = false;
    var isJoining = false;
    var sessData;
    var dataStr;
    var userID;
    var username;
    var roomID;
    var sessID;
    var isConnected = false;
    var ScalableBroadcast;

    console.log('MEDIA: User Connecting.....');
    sessID = socket.handshake.headers.cookie.split("PHPSESSID=")[1].split(";")[0];

    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    var joinTimeout = setTimeout(function()
    {
        console.log('MEDIA: Connection Timeout.');
        socket.disconnect();
    }, 60000);



    my_sql_pool.getConnection(function(err, connection)
    {
        connection.query('USE Users');
        connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [sessID], function(err, rows)
        {
            if (!err)
            {
                if (rows[0])
                {
                    sessBuff = new Buffer(rows[0].Session_Data);
                    sessData = sessBuff.toString('utf-8');
                    sessData = sessData.slice(sessData.indexOf('userId";i:') + 10, -1);
                    sessData = sessData.slice(0, sessData.indexOf(';'));
                    userID = parseInt(sessData);

                    connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [userID], function(err, rows)
                    {
                        if (!err)
                        {
                            if (rows[0] && rows[0].Username)
                            {
                                username = rows[0].Username;

                                connection.query('USE Online_Comms');
                                connection.query('UPDATE Room_Participants SET Socket_ID = ?, Username = ? WHERE User_ID = ?', [socket.id, username, userID], function(err, rows)
                                {
                                    if (!err)
                                    {
                                        socket.emit('READY', userID);
                                        connection.release();
                                        console.log('MEDIA: User ' + userID + ' passed initial connection.');
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
                                console.log('MEDIA: User ' + connection.escape(userID) +  ' not found.');
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

                    socket.userid = userID;
                }
                else
                {
                    connection.release();
                    socket.disconnect();
                    console.log('MEDIA: Session ' + connection.escape(sessData) +  ' not found.');
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

    if (params.enableScalableBroadcast)
    {
        if (!ScalableBroadcast)
        {
            ScalableBroadcast = require('./Scalable-Broadcast.js');
        }
        var singleBroadcastAttendees = params.singleBroadcastAttendees;
        ScalableBroadcast(socket, singleBroadcastAttendees);
    }

    socket.on('disconnect', function ()
    {
        try
        {
            isConnected = false;
            clearTimeout(joinTimeout);
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
            console.log('Notifying user ' + userID + ' of their ID.');
            socket.emit('USERID', userID);
        }
        catch (e)
        {

        }
    });

    socket.on('LEAVE', function()
    {
        if(isConnected)
        {
            try
            {
                var clients = io.sockets.adapter.rooms[roomID];
                for (var clientId in clients)
                {
                    var clientSocket = io.sockets.connected[clientId];

                    //Tell the new user about everyone else
                    clientSocket.emit('LEAVE', userID);
                }

                socket.leave(roomID);
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
        if(isConnected)
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

    notifyUser = function(client)
    {
        my_sql_pool.getConnection(function(err, connection)
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
        });
    }

    socket.on('JOIN-ROOM', function(roomToken)
    {
        try
        {
            console.log('MEDIA: User ' + userID + ' joining room ' + roomToken + '.......');

            if(!isJoining)
            {
                isJoining = true;


                my_sql_pool.getConnection(function(err, connection)
                {
                    processJoinMed = function(startTime, sessLength)
                    {

                        //Tell all those in the room that a new user joined
                        med_io.to(roomID).emit('JOIN', userID, username, socket.id);

                        if(med_io.adapter.rooms[roomID])
                        {
                            var clients = med_io.adapter.rooms[roomID].sockets;
                            console.log('Clients: ' + clients);
                            for (client in clients)
                            {
                                (function(client) {setTimeout(notifyUser(client), 0)})(client);
                            }
                        }

                        connection.release();

                        //New user joins the specified room
                        socket.join(roomID);
                        isConnected = true;

                        var currTime = new Date();

                        setTimeout(function()
                        {
                            console.log('Session ending.');
                            socket.emit('SESSEND');
                            socket.disconnect();
                        }, (startTime.getTime() + sessLength + 600000) - currTime.getTime());
                        setTimeout(function()
                        {
                            socket.emit('SESSWARN', 'Session ending in 5 minutes.');
                        }, (startTime.getTime() + sessLength + 300000) - currTime.getTime());
                        setTimeout(function()
                        {
                            socket.emit('SESSEND', 'Session ending in 1 minute.');
                        }, (startTime.getTime() + sessLength + 540000) - currTime.getTime());

                        socket.emit('CONNOK');
                        clearTimeout(joinTimeout);

                        console.log('MEDIA: User ' + userID + ' successfully joined room ' + roomID + '.');
                    };

                    chkSessionMed = function(err, rows, fields)
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
                                        processJoinMed(rows[0].Start_Time, rows[0].Session_Length);
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

                    chkParticipantMed = function(err, rows, fields)
                    {
                        if (!err)
                        {
                            if (rows[0])
                            {
                                connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [roomID], chkSessionMed);
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

                    findRoomMed = function(err, rows, fields)
                    {
                        if (!err)
                        {
                            if (rows[0])
                            {
                                roomID = rows[0].Room_ID;
                                connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [roomID, userID], chkParticipantMed);
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

                    connection.query('USE Online_Comms');
                    connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], findRoomMed);
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

var boardConnData = [];

sendStyle = function(nodeData, textId, socket)
{
    socket.emit('STYLENODE',
    {
        id: textId, num: nodeData.Seq_Num, text: nodeData.Text_Data, colour: nodeData.Colour, weight: nodeData.Weight, decor:  nodeData.Decoration,
        style: nodeData.Style, start: nodeData.Start, end: nodeData.End, userId: 0, editId: 0
    });
}

sendText = function(textData, socket)
{
    console.log('Sending Text.');
    socket.emit('EDIT-TEXT', {userId: 0, id: textData.Entry_ID, editId: 0, nodes: textData.Num_Style_Nodes});

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
                        (function(data, textId) {setTimeout(function() {sendStyle(data, textId, socket);}, 100);})(prows[i], textData.Entry_ID);
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

sendPoint = function(pointData, socket)
{
    socket.emit('POINT', {id: pointData.Entry_ID, num: pointData.Seq_Num, x: pointData.X_Loc, y: pointData.Y_Loc});
}

sendCurve = function(curveData, socket)
{
    socket.emit('CURVE', {id: curveData.Entry_ID, num_points: curveData.Num_Control_Points, colour: curveData.Colour, serverId: curveData.Entry_ID, userId: curveData.User_ID, size: curveData.Size});

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

sendDataBor = function(socket)
{
    my_sql_pool.getConnection(function(err, connection)
    {
        connection.query('USE Online_Comms');
        connection.query('SELECT * FROM Whiteboard_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomID], function(err, rows, fields)
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

                connection.query('SELECT * FROM Text_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomID], function(err, rows, fields)
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
                            socket.emit('TEXTBOX', {id: rows[i].Entry_ID, serverId: rows[i].Entry_ID, userId: rows[i].User_ID, size: rows[i].Size, posX: rows[i].Pos_X, posY: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, editLock: rows[i].Edit_Lock});

                            (function(data, i) {setTimeout(function() {sendText(data[i], socket);}, i * 5 + 100)})(rows, i);
                        }

                        connection.release();
                    }
                });
            }

        });
    });

}

chkHost = function(err, rows, fields, socket, connection)
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

        console.log('BOARD: User ' + boardConnData[socket.id].userID + ' successfully joined room ' + boardConnData[socket.id].roomID + '.');
        setTimeout(function() { sendDataBor(socket); }, 0);
    }
    connection.release();
}

processJoinBor = function(socket, connection)
{
    connection.query('USE Tutoring');
    connection.query('SELECT Tutor_ID FROM Tutor_Session WHERE Room_ID = ? AND Tutor_ID = ?', [boardConnData[socket.id].roomID, boardConnData[socket.id].userID], function(err, rows, fields)
    {
        chkHost(err, rows, fields, socket, connection);
    });

    //New user joins the specified room
    socket.join(boardConnData[socket.id].roomID);
};

chkSessionBor = function(err, rows, fields, socket, connection)
{
    if (!err)
    {
        if (rows[0])
        {

            if (rows[0].Start_Time && rows[0].Session_Length)
            {
                boardConnData[socket.id].startTime = rows[0].Start_Time;
                boardConnData[socket.id].sessLength = rows[0].Session_Length;

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

chkParticipantBor = function(err, rows, fields, socket, connection)
{
    if (!err)
    {
        if (rows[0])
        {
            connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?', [boardConnData[socket.id].roomID], function(err, rows, fields)
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

findRoomBor = function(err, rows, fields, socket, connection, roomToken)
{
    if (!err)
    {
        if (rows[0])
        {
            boardConnData[socket.id].roomID = rows[0].Room_ID;
            connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?', [boardConnData[socket.id].roomID, boardConnData[socket.id].userID], function(err, rows, fields)
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

missedPoints = function(curveId, socket)
{
    var i;
    for(i = 0; i < boardConnData[socket.id].numPoints[curveId]; i++)
    {
        if(!boardConnData[socket.id].recievedPoints[curveId][i])
        {
            boardConnData[socket.id].pointRetries[curveId]++;
            if(boardConnData[socket.id].pointRetries[curveId] > 10 || !boardConnData[socket.id].isConnected)
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
                socket.emit('MISSED-CURVE', {curve: curveId, point: i});
            }
        }
    }
}

sendMissing = function(data, socket)
{
    my_sql_pool.getConnection(function(err, connection)
    {
        console.log('BOARD: Got data connection.');
        if(!err)
        {
            console.log('BOARD: Looking for Curve ID: ' + data.id + ' sequence number: ' + data.seq_num);
            connection.query('USE Online_Comms');
            connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? ', [data.id],  function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while performing control point query.' + err);
                }
                else
                {
                    if(rows[0])
                    {
                        connection.query('SELECT X_Loc, Y_Loc FROM Control_Points WHERE Entry_ID = ? AND Seq_Num = ?', [data.id, data.seq_num],  function(err, rows, fields)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing control point query.' + err);
                            }
                            else
                            {
                                if(rows[0])
                                {
                                    console.log('BOARD: Emitting Data.');
                                    var retData = {id: data.id, num: data.seq_num, x: rows[0].X_Loc, y: rows[0].Y_Loc};
                                    socket.emit('POINT', retData);
                                }
                            }
                        });
                    }
                    else
                    {
                        socket.emit('IGNORE-CURVE', data.id);
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
}

addNode = function(textNode, entryId, socket)
{
    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            console.log('Weight: ' + textNode.weight);
            connection.query('USE Online_Comms');
            connection.query('INSERT INTO Text_Style_Node(Entry_ID, Seq_Num, Text_Data, Colour, Weight, Decoration, Style, Start, End) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [entryId, textNode.num, textNode.text, textNode.colour, textNode.weight, textNode.decor, textNode.style, textNode.start, textNode.end],
            function(err, rows, fields)
            {
                if (err)
                {
                    console.log('ID: ' + textNode.id);
                    console.log('BOARD: Error while performing new style node query. ' + err);
                }
                else
                {
                    socket.to(boardConnData[socket.id].roomID).emit('STYLENODE', textNode);
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
}


comleteEdit = function(editId, socket)
{
    var i;
    var textId = boardConnData[socket.id].editIds[editId].textId;

    clearTimeout(boardConnData[socket.id].textTimeouts[editId]);

    my_sql_pool.getConnection(function(err, connection)
    {
        if(!err)
        {
            console.log(editId);
            console.log(textId);
            connection.query('USE Online_Comms');
            connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [textId],
            function(err, rows, fields)
            {
                if (err)
                {
                    console.log('ID: ' + textId);
                    console.log('BOARD: Error while performing remove old nodes query. ' + err);
                    connection.release();
                }
                else
                {
                    for(i = 0; i < boardConnData[socket.id].newBuffer[editId].length; i++)
                    {
                        (function(nodeData, editId) { setTimeout(addNode(nodeData, editId, socket), 0); })(boardConnData[socket.id].newBuffer[editId][i], textId);
                    }

                    connection.query('UPDATE Text_Space SET Num_Style_Nodes = ? WHERE Entry_ID = ?', [boardConnData[socket.id].newBuffer[editId].length, textId],
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

}



/*
 *  Board socket, used for communicating whiteboard data.
 *
 *
 *
 *
 *
 */
bor_io.on('connection', function(socket)
{

    if(!boardConnData[socket.id])
    {
        boardConnData[socket.id] = {};
        boardConnData[socket.id].editCount = 1;
        boardConnData[socket.id].isHost = false;
        boardConnData[socket.id].isConnected = false;
        boardConnData[socket.id].isJoining = false;
        boardConnData[socket.id].curveTimeouts = [];
        boardConnData[socket.id].textTimeouts = [];
        boardConnData[socket.id].recievedPoints = [];
        boardConnData[socket.id].pointRetries = [];
        boardConnData[socket.id].numRecieved = [];
        boardConnData[socket.id].numPoints = [];
        boardConnData[socket.id].nodesRecieved = [];
        boardConnData[socket.id].numNodes = [];
        boardConnData[socket.id].recievedNodes = [];
        boardConnData[socket.id].nodeRetries = [];
        boardConnData[socket.id].newBuffer = [];
        boardConnData[socket.id].numNewNodes = [];
        boardConnData[socket.id].editIds = [];
    }


    console.log('BOARD: User Connecting.....');
    boardConnData[socket.id].sessID = socket.handshake.headers.cookie.split("PHPSESSID=")[1].split(";")[0];

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
            // TODO: Need to cleanup the recieve buffer and ditch any data that was not finished.
            boardConnData[socket.id].isConnected = false;
            clearTimeout(boardConnData[socket.id].joinTimeout);
            console.log('BOARD: User disconnected.');
        }
        catch (e)
        {

        }
        finally
        {

        }
    });

    socket.on('JOIN-ROOM', function(roomToken)
    {
        try
        {
            console.log('BOARD: User ' + boardConnData[socket.id].userID + ' joining room ' + roomToken + '.......');

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

                socket.leave(boardConnData[socket.id].roomID);
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
    socket.on('CURVE', function(data)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('BOARD: Received curve.');
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    if(typeof(data.id) != 'undefined' && data.num_points && data.colour)
                    {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Whiteboard_Space(Room_ID, User_ID, Local_ID, Edit_Time, Num_Control_Points, Colour, Size) VALUES(?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)',
                        [boardConnData[socket.id].roomID, boardConnData[socket.id].userID, data.id, data.num_points, data.colour, data.size],
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

                                // Tell the user the ID to assign points to.
                                socket.emit('CURVEID', {serverId: result.insertId, localId: data.id});

                                data.serverId = result.insertId;
                                data.userId = boardConnData[socket.id].userID;

                                socket.broadcast.to(boardConnData[socket.id].roomID).emit('CURVE', data);

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
    socket.on('POINT', function(data)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    if(!boardConnData[socket.id].recievedPoints[data.id][data.num])
                    {
                        connection.query('USE Online_Comms');
                        connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES(?, ?, ?, ?)', [data.id, data.num, data.x, data.y], function(err, rows, fields)
                        {
                            if (err)
                            {
                                console.log('ID: ' + data.id);
                                console.log('Seq_Num: ' + data.num);
                                console.log('BOARD: Error while performing new control point query. ' + err);
                            }
                            else
                            {
                                socket.to(boardConnData[socket.id].roomID).emit('POINT', data);
                                boardConnData[socket.id].recievedPoints[data.id][data.num] = true;
                                boardConnData[socket.id].numRecieved[data.id]++;

                                if(boardConnData[socket.id].numRecieved[data.id] == boardConnData[socket.id].numPoints[data.id])
                                {
                                    // We recived eveything so clear the timeout and give client the OK.
                                    clearInterval(boardConnData[socket.id].curveTimeouts[data.id]);
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

    socket.on('DELETE-CURVE', function(curveId)
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
                                socket.to(boardConnData[socket.id].roomID).emit('DELETE-CURVE', curveId);
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
                        connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID', [curveId, boardConnData[socket.id].userID], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [curveId], function(err, rows)
                                    {
                                        if (!err)
                                        {
                                            socket.to(boardConnData[socket.id].roomID).emit('DELETE-CURVE', curveId);
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



    // Listen for cliets requesting missing data.
    socket.on('MISSING-CURVE', function(data)
    {
        console.log('BOARD: Received missing message.');
        if(boardConnData[socket.id].isConnected)
        {
            setTimeout(function() {sendMissing(data, socket);}, 0);
        }
    });

    // Listen for cliets recieving points without curve.
    socket.on('UNKNOWN-CURVE', function(curveId)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    // Send client curve data if available, client may then request missing points.
                    connection.query('SELECT Room_ID, User_ID, Local_ID, Num_Control_Points, Colour FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [curveId, boardConnData[socket.id].roomID],  function(err, rows, fields)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while performing curve query.' + err);
                        }
                        else
                        {
                            if(rows[0])
                            {
                                var retData = {serverId: curveId, userId: rows[0].User_ID, id: rows[0].Local_ID, num_points: rows[0].Num_Control_Points, colour: rows[0].Colour};
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
    socket.on('TEXTBOX', function(data)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('BOARD: Received Textbox.');
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    if(typeof(data.id) != 'undefined')
                    {
                        connection.query('USE Online_Comms');
                        // TODO: Insert correct data
                        connection.query('INSERT INTO Text_Space(Room_ID, User_ID, Local_ID, Post_Time, Num_Style_Nodes, Size, Pos_X, Pos_Y, Width, Height, Edit_Lock) VALUES(?, ?, ?, CURRENT_TIMESTAMP, 0, ?, ?, ?, ?, ?, ?)',
                        [boardConnData[socket.id].roomID, boardConnData[socket.id].userID, data.id, data.size, data.posX, data.posY, data.width, data.height, boardConnData[socket.id].userID],
                        function(err, result)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing new textbox query.' + err);
                            }
                            else
                            {
                                // Tell the user the ID to assign points to.
                                socket.emit('TEXTID', {serverId: result.insertId, localId: data.id});

                                data.serverId = result.insertId;
                                data.userId = boardConnData[socket.id].userID;

                                socket.broadcast.to(boardConnData[socket.id].roomID).emit('TEXTBOX', data);
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


    socket.on('EDIT-TEXT', function(data)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('BOARD: Start edit received.');
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.id], function(err, rows, fields)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error starting textbox edit. ' + err);
                            connection.release();
                        }
                        else
                        {
                            if(rows[0].Edit_Lock == boardConnData[socket.id].userID)
                            {
                                boardConnData[socket.id].editIds[boardConnData[socket.id].editCount] = {textId: data.id, localId: data.localId};
                                boardConnData[socket.id].newBuffer[boardConnData[socket.id].editCount] = [];
                                boardConnData[socket.id].numNewNodes[boardConnData[socket.id].editCount] = data.nodes;


                                data.editId = boardConnData[socket.id].editCount;
                                data.userId = boardConnData[socket.id].userID;

                                console.log('BOARD: Notifying user of edit ID.');
                                socket.emit('EDITID-TEXT', {id: boardConnData[socket.id].editCount, textId: data.id, localId: data.localId, bufferId: data.bufferId});
                                socket.to(boardConnData[socket.id].roomID).emit('EDIT-TEXT', data);

                                // Set a 1 min timeout to inform the client of missing edit data.
                                boardConnData[socket.id].textTimeouts[boardConnData[socket.id].editCount] = (function(editId) { setTimeout(function() { socket.emit('FAILED-TEXT', {id: editId}); }, 60000); })(boardConnData[socket.id].editCount);

                                boardConnData[socket.id].editCount++;

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

    //Listens for points as part of a curve, must recive a funn let from the initiation.
    socket.on('STYLENODE', function(data)
    {
        if(boardConnData[socket.id].isConnected)
        {
            console.log('BOARD: New data: ' + data);
            boardConnData[socket.id].newBuffer[data.editId].push(data);

            if(boardConnData[socket.id].newBuffer[data.editId].length == boardConnData[socket.id].numNewNodes[data.editId])
            {
                comleteEdit(data.editId, socket);
            }

        }
    });

    socket.on('LOCK-TEXT', function(data)
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
                        connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.id], function(err, rows, fields)
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
                                    connection.query('UPDATE Text_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData[socket.id].userID, data.id], function(err, rows, fields)
                                    {
                                        if (err)
                                        {
                                            console.log('BOARD: Error while updating textbox loxk state. ' + err);
                                        }
                                        else
                                        {
                                            socket.emit('LOCKID-TEXT', {id: data.id});
                                            socket.to(roomID).emit('LOCK-TEXT', {id: data.id, user: boardConnData[socket.id].userID});
                                        }
                                        connection.release();
                                    });
                                }
                                else
                                {
                                    socket.emit('REFUSED-TEXT', {id: data.id});
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
                        connection.query('SELECT User_ID FROM Text_Space WHERE Entry_ID = ? AND User_ID', [data.id, boardConnData[socket.id].userID], function(err, rows)
                        {
                            if (!err)
                            {
                                if(rows[0])
                                {
                                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.id], function(err, rows, fields)
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
                                                connection.query('UPDATE Text_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData[socket.id].userID, data.id], function(err, rows, fields)
                                                {
                                                    if (err)
                                                    {
                                                        console.log('BOARD: Error while updating textbox loxk state. ' + err);
                                                    }
                                                    else
                                                    {
                                                        socket.emit('LOCKID-TEXT', {id: data.id});
                                                        socket.to(boardConnData[socket.id].roomID).emit('LOCK-TEXT', {id: data.id, user: boardConnData[socket.id].userID});
                                                    }
                                                    connection.release();
                                                });
                                            }
                                            else
                                            {
                                                socket.emit('REFUSED-TEXT', {id: data.id});
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



    socket.on('RELEASE-TEXT', function(data)
    {
        if(boardConnData[socket.id].isConnected)
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    connection.query('SELECT Edit_Lock FROM Text_Space WHERE Entry_ID = ?', [data.id], function(err, rows, fields)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error releasing textbox lock state. ' + err);
                            connection.release();
                        }
                        else
                        {
                            if(rows[0].Edit_Lock == boardConnData[socket.id].userID)
                            {
                                connection.query('UPDATE Text_Space SET Edit_Lock = 0 WHERE Entry_ID = ?', [data.id], function(err, rows, fields)
                                {
                                    if (err)
                                    {
                                        console.log('BOARD: Error while updating textbox lock state. ' + err);
                                    }
                                    else
                                    {
                                        socket.emit('RELEASE-TEXT', {id: data.id});
                                        socket.to(boardConnData[socket.id].roomID).emit('RELEASE-TEXT', {id: data.id});
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



    socket.on('MOVE-TEXT', function(data)
    {
        // TODO
    });


    socket.on('DELETE-TEXT', function(data)
    {
        // TODO
    });


    // Listen for cliets requesting missing data.
    socket.on('MISSING-TEXT', function(data)
    {
        // TODO
    });

    // Listen for cliets recieving nodes without textbox.
    socket.on('UNKNOWN-TEXT', function(curveId)
    {
        connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [curveId], function(err, rows, fields)
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
                    socket.emit('TEXTBOX', {id: rows[i].Entry_ID, serverId: rows[i].Entry_ID, userId: rows[i].User_ID, size: rows[i].Size, posX: rows[i].Pos_X, posY: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, editLock: rows[i].Edit_Lock});

                    (function(data) {setTimeout(function() {sendText(data, socket);}, 100)})(rows[0]);
                }

                connection.release();
            }
        });
    });

    // Listen for cliets recieving nodes without edit.
    socket.on('UNKNOWN-EDIT', function(curveId)
    {
        connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [curveId], function(err, rows, fields)
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
    });

    console.log('Finished with listeners.');

    my_sql_pool.getConnection(function(err, connection)
    {
        console.log('Tried getting connection.');

        if(!err)
        {
            console.log('Got connection.');
            connection.query('USE Users');
            connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [boardConnData[socket.id].sessID], function(err, rows)
            {
                if (!err)
                {
                    if (rows[0])
                    {
                        console.log('Has row.');
                        boardConnData[socket.id].sessBuff = new Buffer(rows[0].Session_Data);
                        boardConnData[socket.id].sessData = boardConnData[socket.id].sessBuff.toString('utf-8');
                        boardConnData[socket.id].sessData = boardConnData[socket.id].sessData.slice(boardConnData[socket.id].sessData.indexOf('userId";i:') + 10, -1);
                        boardConnData[socket.id].sessData = boardConnData[socket.id].sessData.slice(0, boardConnData[socket.id].sessData.indexOf(';'));
                        boardConnData[socket.id].userID = parseInt(boardConnData[socket.id].sessData);

                        connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [boardConnData[socket.id].userID], function(err, rows)
                        {
                            if (!err)
                            {
                                if (rows[0] && rows[0].Username)
                                {
                                    boardConnData[socket.id].username = rows[0].Username;
                                    socket.emit('READY', boardConnData[socket.id].userID);
                                    console.log('BOARD: User ' + boardConnData[socket.id].userID + ' passed initial connection.');
                                    connection.release();
                                }
                                else
                                {
                                    connection.release();
                                    socket.disconnect();
                                    console.log('BOARD: User ' + connection.escape(boardConnData[socket.id].userID) +  ' not found.');
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

                        socket.userid = boardConnData[socket.id].userID;
                    }
                    else
                    {
                        connection.release();
                        socket.disconnect();
                        console.log('BOARD: Session ' + connection.escape(boardConnData[socket.id].sessData) +  ' not found.');
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
            connection.release();
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

require('http').get(reqOpt, function(res)
{
    console.log("Got response for end point request: " + res.statusCode);


    res.on('data', function (chunk)
    {
        console.log('End Point: ' + chunk);
        endPointAddr = chunk;
    });
}).on('error', function(e)
{
    console.log("Error retrieving server endpoint: " + e.message);
});

reqOpt = {
  host: '169.254.169.254',
  port: 80,
  path: '/latest/meta-data/availability-zone'
};

require('http').get(reqOpt, function(res)
{
    console.log("Got response for zone: " + res.statusCode);


    res.on('data', function (chunk)
    {
        console.log('Zone: ' + chunk);
        zone = chunk;
    });
}).on('error', function(e)
{
    console.log("Error retrieving server endpoint: " + e.message);
});



my_sql_pool.getConnection(function(err, connection)
{
    if(!err)
    {
        var qStr;
        console.log('Adding to server list.......');

        qStr = 'DELETE Control_Points, Whiteboard_Space FROM Control_Points RIGHT JOIN Whiteboard_Space ON Control_Points.Entry_ID = Whiteboard_Space.Entry_ID WHERE Whiteboard_Space.Entry_ID IN';
        qStr = qStr + '(SELECT T1.Entry_ID FROM (SELECT Entry_ID, Num_Control_Points FROM Whiteboard_Space GROUP BY Entry_ID) T1 LEFT JOIN';
        qStr = qStr + '(SELECT Entry_ID, COUNT(DISTINCT Seq_Num) AS Act_Count FROM Control_Points GROUP BY Entry_ID) T2';
        qStr = qStr + 'ON T1.Entry_ID = T2.Entry_ID WHERE T1.Num_Control_Points > T2.Act_Count OR T2.Act_Count IS NULL)';

        connection.query('USE Online_Comms');
        connection.query('INSERT INTO Tutorial_Servers(End_Point, Zone) VALUES(?, ?) ', [endPointAddr, zone], function(err, rows)
        {
            if(err)
            {
                console.log('BOARD: Error registering server in list. ' + err);
            }

            connection.release();
        });
    }
    else
    {
        console.log('BOARD: Error getting connection from pool. ' + err);
        connection.release();
    }
});

http.listen(9001, function()
{
    console.log("Server listening at", "*:" + 9001);
});
