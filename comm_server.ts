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
interface FileData {
    fileDesc: string;
    fileName: string;
    fileSize: number;
    data: ArrayBuffer;
    downloaded: number;
    type: string;
}
interface TempFileData {
    serverId: number;
    uuid: string;
}
interface BoardConnection extends ConnectionData {
    colour: number;
    sessId: number;
    cleanUp: boolean;
    allowUserEdit: boolean;
    allowAllEdit: boolean;
}

/**
 * Message types that can be sent between the user and server for any element type.
 */
const ElementMessageTypes = {
    DELETE: 0,
    RESTORE: 1,
    MOVE: 2,
};

let colourTable : Array<number> = [
    0xFF0000, 0x00FF00, 0x0000FF, 0xFF00FF, 0xFF7F00,
    0x8C1717, 0x70DB93, 0x00FFFF, 0x5959AB, 0xDB9370,
    0x871F78, 0x238E23, 0x38B0DE, 0xCC3299, 0xB5A642,
    0x8E2323, 0x2F4F2F, 0x5F9F9F, 0x9932CD, 0xB87333,
    0x4F2F4F, 0x238E68, 0x236B8E, 0xDB70DB, 0xCFB53B,
    0x2F2F4F, 0x00FF7F, 0x007FFF, 0x8E236B, 0xDBDB70,
    0x9F9F5F, 0x99CC32, 0xADEAEA, 0xEBC79E, 0xCD7F32,
    0x527F76
];

let allowedFileTypes : Array<string> = [

];

const urlMod = require('url');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();
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
var uuid = require('node-uuid');

var dbHost = process.env.DATABASE_HOST;
var dbUser = process.env.DATABASE_USER;
var dbPass = process.env.DATABASE_PASSWORD;

var my_sql_pool = mysql.createPool({
  host     : dbHost,
  user     : dbUser,
  password : dbPass,
  database : 'Online_Comms',
  supportBigNumbers: true
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

    let sessId = socket.handshake.query.sessId;

    if(!sessId)
    {
        console.error('MEDIA: ERROR: No session ID found in handshake.');
        return;
    }

    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    mediaConnData[socket.id].joinTimeout = setTimeout(function()
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





abstract class Component {
    public abstract userJoin(socket: SocketIO.Socket, boardConnData: BoardConnection);
    public abstract sendData(elemData, socket: SocketIO.Socket, connection, boardConnData: BoardConnection);
    public abstract handleMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection, my_sql_pool);
    public abstract handleNew(message, id: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection, my_sql_pool);
    public abstract handleUnknownMessage(serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection);
    public abstract handleClean(boardConnData: BoardConnection, my_sql_pool);
    public abstract handleDisconnect(boardConnData: BoardConnection, my_sql_pool);
    public abstract handleReconnect(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool);
}






/*
 *  Board socket, used for communicating whiteboard data.
 *
 *
 *
 *
 *
 */

let boardConnData : { [id: string] : BoardConnection } = {};
let connBoardUsers : { [id: number] : string } = {};
let roomUserList : { [id: number] : Array<number> } = [];
let roomUserCount : Array<number> = [];
let modes : Array<string> = [];
let components : Array<Component> = [];

let registerComponent = (modeName: string, ModeClass) =>
{
    console.log('REGISTERING COMPONENT: ' + modeName);
    modes.push(modeName);
    components[modeName] = new ModeClass();
}

let normalizedPath = require("path").join(__dirname, "components");

require("fs").readdirSync(normalizedPath).forEach(function(file)
{
    require("./components/" + file)(registerComponent);
});

var sendDataBor = function(socket: SocketIO.Socket) : void
{
    my_sql_pool.getConnection((err, connection) =>
    {
        if(!err)
        {
            connection.query('USE Online_Comms',
            (err) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while setting database schema. ' + err);
                    connection.release();
                }
                else
                {
                    connection.query('SELECT * FROM Whiteboard_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId],
                    (err, rows, fields) =>
                    {
                        if (err)
                        {
                            connection.release();
                            console.log('BOARD: Error while performing existing curve query. ' + err);
                        }
                        else
                        {
                            // Send connecting user all data to date.
                            let data = rows;
                            for(let i = 0; i < rows.length; i++)
                            {
                                my_sql_pool.getConnection((err, connection) =>
                                {
                                    if(!err)
                                    {
                                        connection.query('USE Online_Comms',
                                        (err) =>
                                        {
                                            if (err)
                                            {
                                                console.log('BOARD: Error while setting database schema. ' + err);
                                                connection.release();
                                            }
                                            else
                                            {
                                                components[data[i].Type].sendData(data[i], socket, connection, boardConnData[socket.id]);
                                            }
                                        });
                                    }
                                });
                            }
                        }
                        connection.release();
                    });
                }
            });
        }
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
        setTimeout(() =>
        {
            console.log('BOARD: Session over.')
            socket.disconnect();
        }, (boardConnData[socket.id].startTime.getTime() + boardConnData[socket.id].sessLength + 600000) - currTime.getTime());

        boardConnData[socket.id].isConnected = true;

        socket.emit('CONNOK');
        clearTimeout(boardConnData[socket.id].joinTimeout);

        console.log('BOARD: User ' + boardConnData[socket.id].userId + ' successfully joined room ' + boardConnData[socket.id].roomId + '.');
        setTimeout(() => { sendDataBor(socket); }, 0);
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

    if(!roomUserList[boardConnData[socket.id].roomId])
    {
        roomUserList[boardConnData[socket.id].roomId] = [];
        roomUserCount[boardConnData[socket.id].roomId] = 0;
    }

    if(!roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId])
    {
        colour = colourTable[roomUserCount[boardConnData[socket.id].roomId]++];
        console.log('BOARD: Room User Colour: ' + colour.toString(16));
        roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId] = colour;
    }
    else
    {
        colour = roomUserList[boardConnData[socket.id].roomId][boardConnData[socket.id].userId];
    }

    boardConnData[socket.id].colour = colour;

    var msg : ServerBoardJoinMessage = { userId: boardConnData[socket.id].userId, colour: colour };
    bor_io.to(boardConnData[socket.id].roomId.toString()).emit('JOIN', msg);

    if(bor_io.adapter.rooms[boardConnData[socket.id].roomId])
    {
        var clients = bor_io.adapter.rooms[boardConnData[socket.id].roomId].sockets;
        console.log('Clients: ' + clients);
        for (var client in clients)
        {
            ((client) => {setTimeout(notifyBoardUser(client, socket), 0)})(client);
        }
    }

    for(let i = 0; i < modes.length; i++)
    {
        let component = components[modes[i]];
        component.userJoin(socket, boardConnData[socket.id]);
    }

    my_sql_pool.getConnection((err, connection) =>
    {
        connection.query('USE Online_Comms',
        (err) =>
        {
            if (err)
            {
                console.error("BOARD: Unable to log user connection. " + err);
                connection.release();
            }
            else
            {
                connection.query('INSERT INTO Connection_Logs(User_ID, Room_ID, Type, Source) VALUES (?, ?, ?, ?)',
                [boardConnData[socket.id].userId, boardConnData[socket.id].roomId, 'CONNECT', 'BOARD'],
                (err) =>
                {
                    if(err)
                    {
                        console.error("BOARD: Unable to log user connection. " + err);
                    }
                    connection.release();
                });
            }
        });
    });

    connection.query('USE Tutoring',
    (err) =>
    {
        if (err)
        {
            console.log('BOARD: Error while setting database schema. ' + err);
            connection.release();
        }
        else
        {
            connection.query('SELECT Tutor_ID FROM Tutor_Session WHERE Room_ID = ? AND Tutor_ID = ?',
            [boardConnData[socket.id].roomId,
            boardConnData[socket.id].userId], (err, rows, fields) =>
            {
                chkHost(err, rows, fields, socket, connection);
            });
        }
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
            connection.query('SELECT Start_Time, Session_Length, Host_Join_Time FROM Tutorial_Room_Table WHERE Room_ID = ?',
            [boardConnData[socket.id].roomId],
            (err, rows, fields) =>
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
            connection.query('SELECT * FROM Room_Participants WHERE Room_ID = ? AND User_ID = ?',
            [boardConnData[socket.id].roomId, boardConnData[socket.id].userId],
            (err, rows, fields) =>
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

var cleanConnection = function(socketID: string) : void
{
    console.log('BOARD: Cleaning Connection....');

    boardConnData[socketID].cleanUp = true;

    for(let i = 0; i < modes.length; i++)
    {
        let component = components[modes[i]];
        component.handleClean(boardConnData[socketID], my_sql_pool);
    }
};

var endConnection = function(socketID: string) : void
{
    console.log('BOARD: Ending Connection....');
    cleanConnection(socketID);
    boardConnData[socketID].isConnected = false;
};

var handleDeleteMessages = (serverIds: Array<number>, socket: SocketIO.Socket, connection, boardConnData: BoardConnection) =>
{
    console.log('Received Delete Curves Event.');

    let commitFunc = (serverIds, connection, socket: SocketIO.Socket, boardConnData: BoardConnection) =>
    {
        connection.commit((err) =>
        {
            if (!err)
            {
                let payload = [];
                for(let i = 0; i < serverIds.length; i++)
                {
                    payload.push(serverIds[i]);
                }

                let msg: ServerMessage = { header: ElementMessageTypes.DELETE, payload: payload };
                let msgCont: ServerMessageContainer =
                {
                    serverId: null, userId: boardConnData.userId, type: 'ANY', payload: msg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                connection.release();
            }
            else
            {
                return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
            }
        });
    };

    let updateFunc = (serverIds, connection, socket: SocketIO.Socket, boardConnData: BoardConnection, commitCallback, index: number = 0) =>
    {
        if(index < serverIds.length)
        {
            connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?',
            [serverIds[index]],
            (err, rows) =>
            {
                if (!err)
                {
                    updateFunc(serverIds, connection, socket, boardConnData, commitCallback, ++index);
                }
                else
                {
                    return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
                }
            });
        }
        else
        {
            commitCallback(serverIds, connection, socket, boardConnData);
        }
    };

    if(boardConnData.isHost || boardConnData.allowAllEdit)
    {
        connection.beginTransaction(
        (err) =>
        {
            if (!err)
            {
                updateFunc(serverIds, connection, socket, boardConnData, commitFunc);
            }
            else
            {
                return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
            }
        });
    }
    else if(boardConnData.allowUserEdit)
    {
        let selectFunc = (serverIds, updateList, connection, socket: SocketIO.Socket, boardConnData: BoardConnection, index: number = 0, resolvedList = []) =>
        {
            if(index < serverIds.length)
            {
                connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverIds[index]],
                (err, rows) =>
                {
                    if (!err)
                    {
                        if(rows[0])
                        {
                            resolvedList.push(serverIds[index]);
                        }

                        selectFunc(serverIds, updateList, connection, socket, boardConnData, ++index, resolvedList);
                    }
                    else
                    {
                        console.log('BOARD: Error while performing delete:findUser query. ' + err);
                        connection.release();
                        return;
                    }
                });
            }
            else
            {
                connection.beginTransaction(
                (err) =>
                {
                    if (!err)
                    {
                        updateFunc(resolvedList, connection, socket, boardConnData, commitFunc);
                    }
                    else
                    {
                        return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
                    }
                });
            }
        };
    }
}

var handleRestoreMessages = (serverIds: Array<number>, socket: SocketIO.Socket, connection, boardConnData: BoardConnection) =>
{
    console.log('Received Restore Curves Event.');

    let commitFunc = (serverIds, connection, socket: SocketIO.Socket, boardConnData: BoardConnection) =>
    {
        connection.commit((err) =>
        {
            if (!err)
            {
                let payload = [];
                for(let i = 0; i < serverIds.length; i++)
                {
                    payload.push(serverIds[i]);
                }

                let msg: ServerMessage = { header: ElementMessageTypes.RESTORE, payload: payload };
                let msgCont: ServerMessageContainer =
                {
                    serverId: null, userId: boardConnData.userId, type: 'ANY', payload: msg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                connection.release();
            }
            else
            {
                return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
            }
        });
    };

    let updateFunc = (serverIds, connection, socket: SocketIO.Socket, boardConnData: BoardConnection, commitCallback, index: number = 0) =>
    {
        if(index < serverIds.length)
        {
            connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?',
            [serverIds[index]],
            (err, rows) =>
            {
                if (!err)
                {
                    updateFunc(serverIds, connection, socket, boardConnData, commitCallback, ++index);
                }
                else
                {
                    return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
                }
            });
        }
        else
        {
            commitCallback(serverIds, connection, socket, boardConnData);
        }
    };

    if(boardConnData.isHost || boardConnData.allowAllEdit)
    {
        connection.beginTransaction(
        (err) =>
        {
            if (!err)
            {
                updateFunc(serverIds, connection, socket, boardConnData, commitFunc);
            }
            else
            {
                return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
            }
        });
    }
    else if(boardConnData.allowUserEdit)
    {
        let selectFunc = (serverIds, updateList, connection, socket: SocketIO.Socket, boardConnData: BoardConnection, index: number = 0, resolvedList = []) =>
        {
            if(index < serverIds.length)
            {
                connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverIds[index]],
                (err, rows) =>
                {
                    if (!err)
                    {
                        if(rows[0])
                        {
                            resolvedList.push(serverIds[index]);
                        }

                        selectFunc(serverIds, updateList, connection, socket, boardConnData, ++index, resolvedList);
                    }
                    else
                    {
                        console.log('BOARD: Error while performing restore:findUser query. ' + err);
                        connection.release();
                        return;
                    }
                });
            }
            else
            {
                connection.beginTransaction(
                (err) =>
                {
                    if (!err)
                    {
                        updateFunc(resolvedList, connection, socket, boardConnData, commitFunc);
                    }
                    else
                    {
                        return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
                    }
                });
            }
        };
    }
}


var handleMoveMessages = (messages: Array<{id: number, x: number, y: number}>, socket: SocketIO.Socket, connection, boardConnData: BoardConnection) =>
{
    let self = this;
    console.log('Received Move Curves Event.');

    let updateList = [];
    for(let i = 0; i < messages.length; i++)
    {
        let item = [messages[i].x, messages[i].y, messages[i].id];
        updateList.push(item);
    }

    if(boardConnData.isHost || boardConnData.allowAllEdit)
    {
        handleMoves(updateList, connection, socket, boardConnData);
    }
    else if(boardConnData.allowUserEdit)
    {
        let selectFunc = (messages, updateList, connection, socket: SocketIO.Socket, boardConnData: BoardConnection, index: number = 0, resolvedList = []) =>
        {
            if(index < messages.length)
            {
                connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [messages[index].id],
                (err, rows) =>
                {
                    if (!err)
                    {
                        if(rows[0])
                        {
                            resolvedList.push(updateList[index]);
                        }

                        selectFunc(messages, updateList, connection, socket, boardConnData, ++index, resolvedList);
                    }
                    else
                    {
                        console.log('BOARD: Error while performing move:findUser query. ' + err);
                        connection.release();
                        return;
                    }
                });
            }
            else
            {
                handleMoves(resolvedList, connection, socket, boardConnData);
            }
        };
    }
}

var handleMoves = (updates, connection, socket: SocketIO.Socket, boardConnData: BoardConnection) =>
{
    let commitFunc = (updates, connection, socket: SocketIO.Socket, boardConnData: BoardConnection) =>
    {
        connection.commit((err) =>
        {
            if (!err)
            {
                let payload = [];

                for(let i = 0; i < updates.length; i++)
                {
                    payload.push({ id: updates[i][2], x: updates[i][0], y: updates[i][1], editTime: new Date() });
                }

                let msg: ServerMessage = { header: ElementMessageTypes.MOVE, payload: payload };
                let msgCont: ServerMessageContainer =
                {
                    serverId: null, userId: boardConnData.userId, type: 'ANY', payload: msg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                connection.release();
            }
            else
            {
                return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
            }
        });
    };

    let updateFunc = (updates, connection, socket: SocketIO.Socket, boardConnData: BoardConnection, commitCallback, index: number = 0) =>
    {
        if(index < updates.length)
        {
            connection.query('UPDATE Whiteboard_Space SET X_Loc = ?, Y_Loc = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?',
            updates[index],
            (err, rows) =>
            {
                if (!err)
                {
                    updateFunc(updates, connection, socket, boardConnData, commitCallback, ++index);
                }
                else
                {
                    return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
                }
            });
        }
        else
        {
            commitCallback(updates, connection, socket, boardConnData);
        }
    };


    connection.beginTransaction(
    (err) =>
    {
        if (!err)
        {
            updateFunc(updates, connection, socket, boardConnData, commitFunc);
        }
        else
        {
            return connection.rollback(() => { console.error('BOARD: ' + err); connection.release(); });
        }
    });

}


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
            isHost: false, isConnected: false, isJoining: false, allowUserEdit: true, cleanUp: false, sessId: 0, roomId: 0, userId: 0,
            joinTimeout: null, startTime: null, sessLength: 0, username: '', colour: 0, allowAllEdit: false
        };
    }

    console.log('BOARD: User Connecting.....');
    boardConnData[socket.id].sessId = socket.handshake.query.sessId;
    boardConnData[socket.id].cleanUp = false;

    if(!boardConnData[socket.id].sessId)
    {
        console.error('BOARD: ERROR: No session ID found in handshake.');
        return;
    }

    //Disconnect if no room join is attempted within a minute. Prevent spamming.
    boardConnData[socket.id].joinTimeout = setTimeout(() =>
    {
        console.log('BOARD: Connection Timeout.');
        socket.disconnect();
    }, 60000);


    console.log('Setting up listeners');

    socket.on('disconnect', () =>
    {

        try
        {
            clearTimeout(boardConnData[socket.id].joinTimeout);

            my_sql_pool.getConnection((err, connection) =>
            {
                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.error("BOARD: Unable to log user disconnect. " + err);
                        connection.release();
                    }
                    else
                    {
                        connection.query('INSERT INTO Connection_Logs(User_ID, Room_ID, Type, Source) VALUES (?, ?, ?, ?)',
                        [boardConnData[socket.id].userId, boardConnData[socket.id].roomId, 'DISCONNECT', 'BOARD'],
                        (err) =>
                        {
                            if(err)
                            {
                                console.error("BOARD: Unable to log user disconnect. " + err);
                            }
                            connection.release();
                        });
                    }
                });
            });

            if(boardConnData[socket.id].isConnected)
            {
                console.log('Setting connection clean callback.');
                boardConnData[socket.id].disconnectTimeout = setTimeout(endConnection, 5000, socket.id);

                // Let components handle disconnect.
                for(let i = 0; i < modes.length; i++)
                {
                    let component = components[modes[i]];
                    component.handleDisconnect(boardConnData[socket.id], my_sql_pool);
                }
            }

            console.log('BOARD: User disconnected.');
        }
        catch (e)
        {
            console.error('BOARD: Error disconnecting: ' + e);
        }
        finally
        {

        }
    });

    socket.on('JOIN-ROOM', (roomToken: string) =>
    {
        try
        {
            console.log('BOARD: User ' + boardConnData[socket.id].userId + ' joining room ' + roomToken + '.......');

            if(boardConnData[socket.id].isConnected)
            {
                clearTimeout(boardConnData[socket.id].disconnectTimeout);

                // Let components handle reconnect.
                for(let i = 0; i < modes.length; i++)
                {
                    let component = components[modes[i]];
                    component.handleReconnect(boardConnData[socket.id], socket, my_sql_pool);
                }
            }
            else
            {
                if(!boardConnData[socket.id].isJoining)
                {
                    boardConnData[socket.id].isJoining = true;

                    my_sql_pool.getConnection((err, connection) =>
                    {
                        connection.query('USE Online_Comms',
                        (err) =>
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while setting database schema. ' + err);
                                connection.release();
                            }
                            else
                            {
                                connection.query('SELECT Room_ID FROM Tutorial_Room_Table WHERE Access_Token = ?', [roomToken], (err, rows, fields) =>
                                {
                                    findRoomBor(err, rows, fields, socket, connection, roomToken);
                                });
                            }
                        });
                    });
                }
            }
        }
        catch (e)
        {
            socket.emit('ERROR', 'Failed to join session due to server error.');
            socket.disconnect();
            console.log('BOARD: Error while attempting join-room, Details: ' + e);
        }
        finally
        {

        }
    });

    socket.on('LEAVE', () =>
    {
        if(boardConnData[socket.id].isConnected)
        {
            try
            {
                console.log('Received leave.');
                endConnection(socket.id);
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

    socket.on('NEW-ELEMENT', (data : UserNewElementMessage) =>
    {
        if(typeof(data.payload.localId) != 'undefined' && boardConnData[socket.id].allowUserEdit)
        {
            my_sql_pool.getConnection((err, connection) =>
            {
                if(!err)
                {
                    connection.query('USE Online_Comms',
                    (err) =>
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while setting database schema. ' + err);
                            connection.release();
                        }
                        else
                        {
                            connection.beginTransaction(
                            (err) =>
                            {
                                if (!err)
                                {
                                    let message = data.payload;
                                    connection.query('INSERT INTO ' +
                                    'Whiteboard_Space(Type, Room_ID, User_ID, Local_ID, X_Loc, Y_Loc, Width, Height) ' +
                                    'VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                                    [
                                        data.type, boardConnData[socket.id].roomId, boardConnData[socket.id].userId,
                                        message.localId, message.x, message.y, message.width, message.height
                                    ],
                                    (err, result) =>
                                    {
                                        if (err)
                                        {
                                            console.log('BOARD: Error while performing new curve query.' + err);
                                            return connection.rollback(() => { console.error(err); connection.release(); });
                                        }
                                        else
                                        {
                                            components[data.type].handleNew(message, result.insertId, socket, connection, boardConnData[socket.id], my_sql_pool);
                                        }
                                    });
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing new curve query.' + err);
                                    return connection.rollback(() => { console.error(err); connection.release(); });
                                }
                            });
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error getting database connection.');
                }
            });
        }
    });

    socket.on('MSG-COMPONENT', (data : UserMessageContainer) =>
    {
        my_sql_pool.getConnection((err, connection) =>
        {
            if(!err)
            {
                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while setting database schema. ' + err);
                        connection.release();
                    }
                    else
                    {
                        if(data.type == 'ANY')
                        {
                            let message = data.payload;
                            switch(message.header)
                            {
                                case ElementMessageTypes.DELETE:
                                    let delServerIds = message.payload as Array<number>;
                                    if(delServerIds.length  > 0)
                                    {
                                        handleDeleteMessages(delServerIds, socket, connection, boardConnData[socket.id]);
                                    }
                                    break;
                                case ElementMessageTypes.RESTORE:
                                    let resServerIds = message.payload as Array<number>;
                                    if(resServerIds.length  > 0)
                                    {
                                        handleRestoreMessages(resServerIds, socket, connection, boardConnData[socket.id]);
                                    }
                                    break;
                                case ElementMessageTypes.MOVE:
                                    let moveMessages = message.payload as Array<{id: number, x: number, y: number}>;
                                    handleMoveMessages(moveMessages, socket, connection, boardConnData[socket.id]);
                                    break;
                                default:
                                    break;
                            }
                        }
                        else
                        {
                            components[data.type].handleMessage(data.payload, data.id, socket, connection, boardConnData[socket.id], my_sql_pool);
                        }
                    }
                });
            }
            else
            {
                console.log('BOARD: Error getting database connection.');
            }
        });
    });

    socket.on('UNKNOWN-ELEMENT', (data: UserUnknownElement) =>
    {
        my_sql_pool.getConnection((err, connection) =>
        {
            if(!err)
            {
                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while setting database schema. ' + err);
                        connection.release();
                    }
                    else
                    {
                        components[data.type].handleUnknownMessage(data.id, socket, connection, boardConnData[socket.id]);
                    }
                });
            }
            else
            {
                console.log('BOARD: Error getting database connection.');
            }
        });
    });

    console.log('Finished with listeners.');

    my_sql_pool.getConnection((err, connection) =>
    {
        console.log('Tried getting connection.');

        if(!err)
        {
            connection.query('USE Users',
            (err) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while setting database schema. ' + err);
                    connection.release();
                }
                else
                {
                    connection.query('SELECT Session_Data FROM User_Sessions WHERE Session_ID = ?', [boardConnData[socket.id].sessId], (err, rows) =>
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

                                connection.query('SELECT Username FROM User_Table WHERE User_ID = ?', [boardConnData[socket.id].userId], (err, rows) =>
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
            connection.query('INSERT INTO Tutorial_Servers(End_Point, Zone) VALUES(?, ?) ', [endPointAddr, zone], (err, rows) =>
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

    my_sql_pool.getConnection((err, connection) =>
    {
        if(!err)
        {
            var qStr;
            console.log('Adding to server list.......');

            connection.query('USE Online_Comms',
            (err) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while setting database schema. ' + err);
                    connection.release();
                }
                else
                {
                    connection.query('SELECT * FROM Tutorial_Servers WHERE End_Point = ?', [endPointAddr], (err, rows) =>
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
            });
        }
        else
        {
            console.log('BOARD: Error getting connection from pool. ' + err);
            return;
        }
    });
}

require('http').get(reqOpt, (res) =>
{
    console.log("Got response for end point request: " + res.statusCode);


    res.on('data', (chunk) =>
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

            require('http').get(reqOpt, (res) =>
            {
                console.log("Got response for zone: " + res.statusCode);

                if(res.statusCode == 200)
                {
                    res.on('data', getServerData);
                }

            }).on('error', (e) =>
            {
                console.log("Error retrieving server endpoint: " + e.message);
            });
        }
    });
}).on('error', (e) =>
{
    console.log("Error retrieving server endpoint: " + e.message);
});

https.listen(9001, () =>
{
    console.log("Server listening at", "*:" + 9001);
});
