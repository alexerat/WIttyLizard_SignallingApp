/** Free Curve Component.
*
* This allows the user to free draw curves that will be smoothed and rendered as Beziers.
*
*/
namespace Text {
    /**
     * The name of the mode associated with this component.
     */
    export const MODENAME = 'TEXT';

    interface ServerNewCurvePayload extends ServerMessage {
        x: number;
        y: number;
        width: number;
        height: number;
        userId: number;
        size: number;
        colour: string;
        num_points: number;
        editTime: Date;
    }
    interface ServerNewPointMessage extends ServerPayload {
        num: number;
        x: number;
        y: number;
    }
    interface ServerMissedPointMessage extends ServerPayload {
        num: number;
    }

    interface UserNewCurveMessage extends UserNewElementPayload {
        colour: string;
        size: number;
        num_points: number;
    }
    interface UserNewPointMessage extends UserMessagePayload {
        num: number;
        x: number;
        y: number;
    }
    interface UserMissingPointMessage extends UserMessagePayload {
        seq_num: number;
    }

    interface ComponentData {
        files: Array<FileData>;
        currentUploads: Array<number>;
        tmpFileIds: Array<TempFileData>;
        tmpCount: number;
    }

    /**
     * Message types that can be sent ebtween the user and server.
     */
    const MessageTypes = {
        NEW: 0,
        DELETE: 1,
        RESTORE: 2,
        IGNORE: 3,
        COMPLETE: 4,
        DROPPED: 5,
        MOVE: 6,
        POINT: 7,
        POINTMISSED: 8,
        MISSINGPOINT: 9
    };

    /** Free Curve Component.
    *
    * This is the class that will be used to store the data associated with these components and handle component specific messaging.
    *
    */
    export class ComponentClass extends Component
    {
        componentData: Array<ComponentData> = [];

        /** Initialize the buffers for this component and socket.
         *
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {BoardConnection} The connection data associated with this socket.
         */
        public userJoin(socket: SocketIO.Socket, boardConnData: BoardConnection)
        {

            let userData: ComponentData = { numRecieved: [], numPoints: [], recievedPoints: [], pointRetries: [], curveTimeouts: [] };
            this.componentData[boardConnData.userId] = userData;

            // Resume any open file uploads.
            if(boardConnData[socket.id].currentUploads.length > 0)
            {
                console.log('BOARD: Found incomplete uploads. Attempting to resume.');
                for(let i = 0; i < boardConnData[socket.id].currentUploads.length; i++)
                {
                    let fileId = boardConnData[socket.id].currentUploads[i];
                    let place = boardConnData[socket.id].files[fileId].downloaded / 65536;
                    let percent = (boardConnData[socket.id].files[fileId].downloaded / boardConnData[socket.id].files[fileId].fileSize) * 100;

                    let dataMsg: ServerUploadDataMessage = { serverId: fileId, place: place, percent: percent };

                    console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(boardConnData[socket.id].files[fileId].fileSize / 65536) + 1));
                    socket.emit('FILE-DATA', dataMsg);
                }
            }

        }

        /** Handle the initial sending of this element data to the user.
         *
         *  @param {SQLReturn} elemData - The basic data about this element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public sendData(elemData, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            connection.query('SELECT * FROM Upload_Space WHERE Room_ID = ? AND isDeleted = 0', [boardConnData[socket.id].roomId], function(err, rows, fields)
            {
                if (err)
                {
                    connection.release();
                    console.log('BOARD: Error while performing existing file query. ' + err);
                }
                else
                {
                    for(i = 0; i < rows.length; i++)
                    {
                        let fExt = '';

                        if(rows[i].Content_URL)
                        {
                            fExt = rows[i].Content_URL.split('.').pop();
                        }

                        let msg: ServerNewUploadMessage = {
                            serverId: rows[i].Entry_ID, userId: rows[i].User_ID, x: rows[i].Pos_X, fileDesc: rows[i].File_Description,
                            y: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, url: rows[i].Content_URL, fileType: rows[i].File_Type,
                            extension: fExt, rotation: rows[i].Rotation, editTime: rows[i].Edit_Time
                        }
                        socket.emit('FILE-START', msg);
                    }
                    connection.release();
                }
            });
        }

        /** Handle receiving a new element of this component type.
         *
         *  @param {UserNewCurveMessage} message - The message containing the element data.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleNew(message: UserNewCurveMessage, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            console.log('BOARD: Received curve.');
            if(typeof(message.localId) != 'undefined' && boardConnData.allowUserEdit && message.num_points && message.colour)
            {
                connection.query('START TRANSACTION',
                (err) =>
                {
                    if (!err)
                    {
                        this.addNew(message, socket, connection, boardConnData);
                    }
                    else
                    {
                        console.log('BOARD: Error while performing new curve query.' + err);
                        connection.release();
                    }
                });
            }
        }

        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            let type = message.header;

            switch(type)
            {
                case MessageTypes.POINT:
                    this.handlePointMessage(message.payload as UserNewPointMessage, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.DELETE:
                    this.handleDeleteMessage(serverId, socket, connection, boardConnData);
                case MessageTypes.RESTORE:
                    this.handleRestoreMessage(serverId, socket, connection, boardConnData);
                case MessageTypes.MOVE:
                    this.handleMoveMessage(message.payload as UserMoveElementMessage,serverId, socket, connection, boardConnData);
                case MessageTypes.MISSINGPOINT:
                    this.handleMissingMessage(message.payload as UserMissingPointMessage,serverId, socket, connection, boardConnData);
                default:
                    break;
            }
        }


        /** Handle users requesting information for an unknown element of this component type.
         *
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleUnknownMessage(serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {

            // Send client curve data if available, client may then request missing points.
            connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [serverId, boardConnData[socket.id].roomId],
            (err, rows, fields) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while performing curve query.' + err);
                }
                else
                {
                    if(rows[0])
                    {
                        let curveMsg : ServerNewCurvePayload = {
                            header: null, payload: null, userId: rows[0].User_ID as number, num_points: rows[0].Num_Control_Points as number,
                            colour: rows[0].Colour as string, size: rows[0].Size as number, x: rows[0].X_Loc, y: rows[0].Y_Loc,
                            width: rows[0].Width, height: rows[0].Height, editTime: rows[0].Edit_Time
                        };

                        let msgCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: curveMsg
                        };

                        let self = this;
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                    }
                }
                connection.release();
            });

        }
        socket.on('FILE-START', function (data: UserStartUploadMessage)
        {
            console.log('BOARD: Received file start.');
            if(boardConnData[socket.id].isConnected)
            {
                if(data.fileSize > 10485760)
                {
                    console.log('BOARD: User attempted upload larger than 10MB.');
                }
                else
                {
                    my_sql_pool.getConnection(function(err, connection)
                    {
                        if(!err)
                        {
                            checkUpload(data, connection, socket);
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to upload new file. ' + err);
                        }
                        connection.release();
                    });
                }
            }
        });

        socket.on('FILE-DATA', function (data: UserUploadDataMessage)
        {
            console.log('BOARD: Received file data.');
            console.log('BOARD: Piece Size: ' + data.piece.length);
            console.log('BOARD: Previous total: ' + boardConnData[socket.id].files[data.serverId].downloaded);
            boardConnData[socket.id].files[data.serverId].downloaded += data.piece.length;

            let tmpArray = new Uint8Array(boardConnData[socket.id].files[data.serverId].downloaded);
            tmpArray.set(new Uint8Array(boardConnData[socket.id].files[data.serverId].data), 0);
            tmpArray.set(new Uint8Array(data.piece), boardConnData[socket.id].files[data.serverId].data.byteLength );

            boardConnData[socket.id].files[data.serverId].data = tmpArray.buffer;

            if(boardConnData[socket.id].files[data.serverId].downloaded == boardConnData[socket.id].files[data.serverId].fileSize)
            {
                console.log('BOARD: File Upload complete.');

                let index = boardConnData[socket.id].currentUploads.indexOf(data.serverId);
                boardConnData[socket.id].currentUploads.splice(index, 1);

                let upArray = new Uint8Array(boardConnData[socket.id].files[data.serverId].data);

                let buffer = new Buffer(upArray.byteLength);
                for (var i = 0; i < buffer.length; ++i)
                {
                    buffer[i] = upArray[i];
                }

                // TODO: User Metadata param to store copyright info
                let params =
                {
                    Body: buffer, ContentType: boardConnData[socket.id].files[data.serverId].type, Metadata: { Origin: 'USER: ' + boardConnData[socket.id].userId },
                    Bucket: 'whiteboard-storage', Key: boardConnData[socket.id].files[data.serverId].fileName, ACL: 'public-read'
                };
                let upload = new AWS.S3.ManagedUpload({ params: params, service: s3 });

                upload.send(function(err, upData)
                {
                    if(err)
                    {
                        // TODO: Handle error, Make 10 attempts then abandon
                        console.log('BOARD: Error uploading file to bucker: '+ err);
                    }
                    else
                    {
                        let fileURL = 'https://whiteboard-storage.s3.amazonaws.com/' + boardConnData[socket.id].files[data.serverId].fileName;
                        let fType = boardConnData[socket.id].files[data.serverId].type;

                        boardConnData[socket.id].files[upData.fileId] = null;

                        console.log('Received All File Data.');

                        my_sql_pool.getConnection(function(err, connection)
                        {
                            if(!err)
                            {
                                connection.query('USE Online_Comms');
                                connection.query('UPDATE Upload_Space SET isComplete = 1, Content_URL = ?, File_Type = ? WHERE Entry_ID = ?', [fileURL, fType, data.serverId], function(err, rows)
                                {
                                    if (!err)
                                    {
                                        let doneMsg : ServerUploadEndMessage = { serverId: data.serverId, fileURL: fileURL }
                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('FILE-DONE', doneMsg);
                                        socket.emit('FILE-DONE', doneMsg);
                                    }
                                    else
                                    {
                                        console.log('BOARD: Error while performing complete upload query. ' + err);
                                    }
                                    connection.release();
                                });
                            }
                            else
                            {
                                console.log('BOARD: Error while getting database connection for complete upload query. ' + err);
                            }
                        });
                    }
                });
            }
            else if(boardConnData[socket.id].files[data.serverId].data.byteLength > 10485760)
            {
                // If the Data Buffer reaches 10MB we should tell the user the file is too big and just remove it
                console.log('BOARD: User uploaded a file larger than 10MB, it should have been less than.');
                socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('ABANDON-FILE', data.serverId);
            }
            else
            {
                let place = boardConnData[socket.id].files[data.serverId].downloaded / 65536;
                let percent = (boardConnData[socket.id].files[data.serverId].downloaded / boardConnData[socket.id].files[data.serverId].fileSize) * 100;

                let dataMsg: ServerUploadDataMessage = { serverId: data.serverId, place: place, percent: percent };

                console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(boardConnData[socket.id].files[data.serverId].fileSize / 65536) + 1));
                socket.emit('FILE-DATA', dataMsg);
            }
        });

        socket.on('STOP-FILE', function (serverId: number)
        {
            // TODO: Also be sure to do abandoned file handling. Deal with user disconnect too.
        });

        socket.on('REMOTE-FILE', function (data: UserRemoteFileMessage)
        {
            console.log('BOARD: Received remote file.');
            if(boardConnData[socket.id].isConnected)
            {
                let tmpId = boardConnData[socket.id].tmpCount++;
                let urlObj = urlMod.parse(data.fileURL);

                // TODO: Set up request properly. Need to split URL in User Message
                let userReq = urlObj;

                my_sql_pool.getConnection(function(err, connection)
                {
                    if(!err)
                    {
                        var options = {method: 'HEAD', host: userReq.host, port: 443, path: userReq.path};
                        var req = require('https').request(options, function(res)
                        {
                            startRemDownload(data, connection, socket, tmpId, res.headers['content-type']);
                        });
                        req.end();
                    }
                    else
                    {
                        console.log('BOARD: Error while getting database connection to download remote file. ' + err);
                    }
                    connection.release();
                });

                // Get file, then as in user file upload to server. Check size though.
                require('https').get(userReq, function(response)
                {
                    if(response.statusCode == 301 || response.statusCode == 302)
                    {
                        // TODO Redirect
                    }
                    else if (response.headers['content-length'] > 10485760)
                    {
                        console.log('Image too large.');
                    }
                    else if (!~[200, 304].indexOf(response.statusCode))
                    {
                        console.log('Received an invalid status code. Code is: ' + response.statusCode);
                    }
                    else if (!response.headers['content-type'].match(/image/))
                    {
                        console.log('Not an image.');
                    }
                    else
                    {
                        console.log('BOARD: Getting Data');
                        var body = new Uint8Array(0);
                        response.on('error', function(err)
                        {
                            console.log(err);
                        });
                        response.on('data', function(chunk)
                        {
                            let tmpArray = new Uint8Array(body.byteLength + chunk.length);
                            tmpArray.set(new Uint8Array(body), 0);
                            tmpArray.set(new Uint8Array(chunk), body.byteLength );

                            body = tmpArray;
                        });
                        response.on('end', function()
                        {
                            completeRemFile(tmpId, socket, body, response.headers['content-type'], data.fileURL);
                        });
                    }
                });
            }
        });

        socket.on('MOVE-FILE', function (data: UserMoveElementMessage)
        {
            if(boardConnData[socket.id].isConnected)
            {
                console.log('Received Move File Event.');
                if(boardConnData[socket.id].isHost)
                {
                    my_sql_pool.getConnection(function(err, connection)
                    {
                        if(!err)
                        {
                            connection.query('USE Online_Comms');
                            connection.query('UPDATE Upload_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                            {
                                if (!err)
                                {
                                    var msg: ServerMoveElementMessage = { serverId: data.serverId, x: data.x, y:data.y, editTime: new Date() };
                                    socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-FILE', msg);
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing move file query. ' + err);
                                }
                                connection.release();
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to move file. ' + err);
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
                            connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID = ?', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                            {
                                if (!err)
                                {
                                    if(rows[0])
                                    {
                                        connection.query('USE Online_Comms');
                                        connection.query('UPDATE Upload_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                                        {
                                            if (!err)
                                            {
                                                var msg: ServerMoveElementMessage = { serverId: data.serverId, x: data.x, y:data.y, editTime: new Date() };
                                                socket.to(boardConnData[socket.id].roomId.toString()).emit('MOVE-FILE', msg);
                                            }
                                            else
                                            {
                                                console.log('BOARD: Error while performing move file query. ' + err);
                                            }
                                            connection.release();
                                        });
                                    }
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing move file:findUser query. ' + err);
                                    connection.release();
                                }
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to move file. ' + err);
                            connection.release();
                        }
                    });
                }
            }
        });

        socket.on('RESIZE-FILE', function (data: UserResizeFileMessage)
        {
            if(boardConnData[socket.id].isConnected)
            {
                console.log('Received Resize File Event.');
                if(boardConnData[socket.id].isHost)
                {
                    my_sql_pool.getConnection(function(err, connection)
                    {
                        if(!err)
                        {
                            connection.query('USE Online_Comms');
                            connection.query('UPDATE Upload_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function(err, rows)
                            {
                                if (!err)
                                {
                                    var msg: ServerResizeFileMessage = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
                                    socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-FILE', msg);
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing resize file query. ' + err);
                                }
                                connection.release();
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to resize file. ' + err);
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
                            connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                            {
                                if (!err)
                                {
                                    if(rows[0])
                                    {
                                        connection.query('UPDATE Upload_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function(err, rows)
                                        {
                                            if (!err)
                                            {
                                                var msg: ServerResizeFileMessage = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
                                                socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-FILE', msg);
                                            }
                                            else
                                            {
                                                console.log('BOARD: Error while performing resize file query. ' + err);
                                            }
                                            connection.release();
                                        });
                                    }
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing resize file:findUser query. ' + err);
                                    connection.release();
                                }
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to resize file. ' + err);
                            connection.release();
                        }
                    });
                }
            }
        });

        socket.on('ROTATE-FILE', function (data: UserRotateFileMessage)
        {
            if(boardConnData[socket.id].isConnected)
            {
                console.log('Received Rotate File Event.');
                if(boardConnData[socket.id].isHost)
                {
                    my_sql_pool.getConnection(function(err, connection)
                    {
                        if(!err)
                        {
                            connection.query('USE Online_Comms');
                            connection.query('UPDATE Upload_Space SET Rotation = ? WHERE Entry_ID = ?', [data.rotation, data.serverId], function(err, rows)
                            {
                                if (!err)
                                {
                                    var msg: ServerRotateFileMessage = {serverId: data.serverId, rotation: data.rotation};
                                    socket.to(boardConnData[socket.id].roomId.toString()).emit('ROTATE-FILE', msg);
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing rotate file query. ' + err);
                                }
                                connection.release();
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to rotate file. ' + err);
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
                            connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID', [data.serverId, boardConnData[socket.id].userId], function(err, rows)
                            {
                                if (!err)
                                {
                                    if(rows[0])
                                    {
                                        connection.query('UPDATE Upload_Space SET Rotation = ? WHERE Entry_ID = ?', [data.rotation, data.serverId], function(err, rows)
                                        {
                                            if (!err)
                                            {
                                                var msg: ServerRotateFileMessage = {serverId: data.serverId, rotation: data.rotation};
                                                socket.to(boardConnData[socket.id].roomId.toString()).emit('RESIZE-FILE', msg);
                                            }
                                            else
                                            {
                                                console.log('BOARD: Error while performing resize file query. ' + err);
                                            }
                                            connection.release();
                                        });
                                    }
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing resize file:findUser query. ' + err);
                                    connection.release();
                                }
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to resize file. ' + err);
                            connection.release();
                        }
                    });
                }
            }
        });

        socket.on('DELETE-FILE', function (fileId: number)
        {
            if(boardConnData[socket.id].isConnected)
            {
                console.log('Received Delete File Event. File ID: ' + fileId);
                if(boardConnData[socket.id].isHost)
                {
                    my_sql_pool.getConnection(function(err, connection)
                    {
                        if(!err)
                        {
                            connection.query('USE Online_Comms');
                            connection.query('UPDATE Upload_Space SET isDeleted = 1 WHERE Entry_ID = ?', [fileId], function(err, rows)
                            {
                                if (!err)
                                {
                                    socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-FILE', fileId);
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing erase file query. ' + err);
                                }
                                connection.release();
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to delete file. ' + err);
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
                            connection.query('SELECT User_ID FROM Upload_Space WHERE Entry_ID = ? AND User_ID', [fileId, boardConnData[socket.id].userId], function(err, rows)
                            {
                                if (!err)
                                {
                                    if(rows[0])
                                    {
                                        connection.query('UPDATE Text_Space SET isDeleted = 1 WHERE Entry_ID = ?', [fileId], function(err, rows)
                                        {
                                            if (!err)
                                            {
                                                socket.to(boardConnData[socket.id].roomId.toString()).emit('DELETE-FILE', fileId);
                                            }
                                            else
                                            {
                                                console.log('BOARD: Error while performing erase file query. ' + err);
                                            }
                                            connection.release();
                                        });
                                    }
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing erase file:findUser query. ' + err);
                                    connection.release();
                                }
                            });
                        }
                        else
                        {
                            console.log('BOARD: Error while getting database connection to delete file. ' + err);
                            connection.release();
                        }
                    });
                }
            }
        });

        var checkUpload = function(data: UserStartUploadMessage, connection, socket: SocketIO.Socket) : void
        {
            connection.query('USE Online_Comms');
            connection.query('SELECT Image FROM File_Types WHERE Type = ?', [data.fileType], function(err, rows)
            {
                if(!err)
                {
                    if(rows[0])
                    {
                        startUpload(data, connection, socket);
                    }
                    else
                    {
                        // File not allowed
                        socket.emit('FILE-BADTYPE', data.localId);
                    }
                }
                else
                {
                    console.log('BOARD: Error while performing file type query.' + err);
                }
            });
        }

        var startUpload = function(data: UserStartUploadMessage, connection, socket: SocketIO.Socket) : void
        {
            let fUUID = uuid.v4();

            connection.query('SELECT UUID FROM Upload_Space WHERE UUID = ?', [fUUID], function(err, rows)
            {
                // Make sure we did not overlap UUID (very unlikely)
                if(!rows || !rows[0])
                {
                    connection.query('INSERT INTO Upload_Space(Room_ID, User_ID, Edit_Time, Pos_X, Pos_Y, Width, Height, UUID, Source, Rotation) VALUES(?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, 0)',
                    [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.x, data.y, data.width, data.height, fUUID, 'User'],
                    function(err, result)
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while performing new file upload query.' + err);
                        }
                        else
                        {
                            let fName = fUUID + '.' + data.fileName.split('.').pop();;
                            let fileId = result.insertId;

                            boardConnData[socket.id].files[fileId] =
                            {
                                fileDesc: '',
                                fileName: fName,
                                fileSize: data.fileSize,
                                data: new ArrayBuffer(0),
                                downloaded: 0,
                                type: data.fileType
                            }

                            boardConnData[socket.id].currentUploads.push(fileId);


                            let place = 0;

                            var idMsg : ServerUploadIdMessage = {serverId: fileId, localId: data.localId};
                            // Tell the user the ID to assign points to.
                            socket.emit('FILEID', idMsg);

                            // Store the file handler so we can write to it later
                            let dataMsg: ServerUploadDataMessage = { serverId: result.insertId, place: place, percent: 0 };
                            socket.emit('FILE-DATA', dataMsg);

                            var uploadMsg : ServerNewUploadMessage =
                            {
                                serverId: result.insertId, userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width,
                                height: data.height, fileDesc: data.fileName, fileType: data.fileType, extension: data.extension, rotation: 0, editTime: new Date()
                            };
                            socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('FILE-START', uploadMsg);
                        }
                    });
                }
                else
                {
                    // The UUID has already been used (very rare) so try to get a new one.
                    startUpload(data, connection, socket);
                }
            });
        };

        var startRemDownload = function(data: UserRemoteFileMessage, connection, socket: SocketIO.Socket, tempId: number, fType: string) : void
        {
            let fUUID = uuid.v4();

            connection.query('USE Online_Comms');

            connection.query('SELECT UUID FROM Upload_Space WHERE UUID = ?', [fUUID], function(err, rows)
            {
                if(!err)
                {
                    // Make sure we did not overlap UUID (very unlikely)
                    if(!rows[0])
                    {
                        connection.query('INSERT INTO Upload_Space(Room_ID, User_ID, Edit_Time, Pos_X, Pos_Y, Width, Height, UUID, Source, Rotation) VALUES(?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, 0)',
                        [boardConnData[socket.id].roomId, boardConnData[socket.id].userId, data.x, data.y, data.width, data.height, fUUID, data.fileURL],
                        function(err, result)
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing new remote file query.' + err);
                            }
                            else
                            {
                                let fName = fUUID + '.' + data.fileURL.split('?')[0].split('.').pop();
                                let fileId = result.insertId;

                                boardConnData[socket.id].tmpFileIds[tempId] = { serverId: fileId, uuid: fName };

                                var idMsg : ServerUploadIdMessage = {serverId: fileId, localId: data.localId};
                                // Tell the user the ID to assign points to.
                                socket.emit('FILEID', idMsg);

                                var uploadMsg : ServerNewUploadMessage =
                                {
                                    serverId: result.insertId, userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width, rotation: 0,
                                    height: data.height, fileDesc: data.fileDesc, fileType: fType, extension: data.fileURL.split('?')[0].split('.').pop(),
                                    editTime: new Date()
                                };
                                socket.broadcast.to(boardConnData[socket.id].roomId.toString()).emit('FILE-START', uploadMsg);
                            }
                        });
                    }
                    else
                    {
                        // The UUID has already been used (very rare) so try to get a new one.
                        return startRemDownload(data, connection, socket, tempId, fType);
                    }
                }
                else
                {
                    console.log('BOARD: Error while performing new remote file query.' + err);
                }
            });
        };

        var completeRemFile = function(fileId: number, socket: SocketIO.Socket, upArray: Uint8Array, fileType: string, origin: string, waitCount: number = 0) : void
        {
            if(!boardConnData[socket.id].tmpFileIds[fileId])
            {
                if(waitCount > 10)
                {
                    // TODO: Abandon file.
                    console.log('BOARD: Failed to complete upload, file data not set.');
                }
                else
                {
                    setTimeout(completeRemFile, 100, fileId, socket, upArray, fileType, origin, ++waitCount);
                }
            }
            else
            {
                let buffer = new Buffer(upArray.byteLength);
                for (var i = 0; i < buffer.length; ++i)
                {
                    buffer[i] = upArray[i];
                }

                let params =
                {
                    Body: buffer, Metadata: { Origin: origin }, ContentType: fileType,
                    Bucket: 'whiteboard-storage', Key: boardConnData[socket.id].tmpFileIds[fileId].uuid, ACL: 'public-read'
                };

                let upload = new AWS.S3.ManagedUpload({ params: params, service: s3 });

                upload.send(function(err, upData)
                {
                    if(err)
                    {
                        // TODO
                        console.log('BOARD: Error sending file: ' + err);
                    }
                    else
                    {
                        let fileURL = 'https://whiteboard-storage.s3.amazonaws.com/' + boardConnData[socket.id].tmpFileIds[fileId].uuid;

                        console.log('BOARD: Received All File Data.');

                        my_sql_pool.getConnection(function(err, connection)
                        {
                            if(!err)
                            {
                                connection.query('USE Online_Comms');
                                connection.query('UPDATE Upload_Space SET isComplete = 1, Content_URL = ?, File_Type = ? WHERE Entry_ID = ?', [fileURL, fileType, boardConnData[socket.id].tmpFileIds[fileId].serverId], function(err, rows)
                                {
                                    if (!err)
                                    {
                                        let doneMsg : ServerUploadEndMessage = { serverId: boardConnData[socket.id].tmpFileIds[fileId].serverId, fileURL: fileURL }
                                        socket.to(boardConnData[socket.id].roomId.toString()).emit('FILE-DONE', doneMsg);
                                        socket.emit('FILE-DONE', doneMsg);
                                    }
                                    else
                                    {
                                        console.log('BOARD: Error while performing complete upload query. ' + err);
                                    }
                                    connection.release();
                                });
                            }
                            else
                            {
                                console.log('BOARD: Error while getting database connection for complete upload query. ' + err);
                            }
                        });
                    }
                });
            }
        };

        var cleanUpload = function(socketID: string, fileId: number) : void
        {
            my_sql_pool.getConnection(function(err, connection)
            {
                if(!err)
                {
                    connection.query('USE Online_Comms');
                    connection.query('UPDATE Upload_Space SET isDeleted = 1 WHERE Entry_ID = ?', [fileId], function(err, rows, fields)
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

            boardConnData[socketID].files[fileId] = null;
            bor_io.to(boardConnData[socketID].roomId.toString()).emit('ABANDON-FILE', fileId);
        }

        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleClean(socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            if(boardConnData[socketID].currentUploads.length > 0)
            {
                for(let i = boardConnData[socketID].currentUploads.length - 1; i >= 0; i--)
                {
                    let fileId = boardConnData[socketID].currentUploads[i];
                    boardConnData[socketID].currentUploads.pop();

                    cleanUpload(socketID, fileId);
                }

                boardConnData[socketID].files = null;
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
registerComponent(FreeCurve.MODENAME, FreeCurve.ComponentClass);
