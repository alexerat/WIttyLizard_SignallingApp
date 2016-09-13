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
        numNodes: Array<number>;
        nodeRetries: Array<number>;
        recievedNodes: Array<Array<TextStyle>>;
        editCount: number;
        textTimeouts;
        editIds: Array<{textId: number, localId:number}>;
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
            /*
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
                            y: rows[i].Pos_Y, width: rows[i].Width, height: rows[i].Height, editLock: rows[i].Edit_Lock, justified: rows[i].Justified,
                            editTime: rows[i].Edit_Time
                        }
                        socket.emit('TEXTBOX', msg);

                        (function(data, i) {setTimeout(function() {sendText(data[i], socket);}, i * 5 + 100)})(rows, i);
                    }
                }
            });
            */
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

        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleClean(socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
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
                            connection.query('UPDATE Text_Space SET Edit_Lock = 0 WHERE Edit_Lock = ?', [boardConnData[socketID].userId], (err, rows, fields) =>
                            {
                                if(err)
                                {
                                    console.log('BOARD: Error cleaning connection. ERROR: ' + err);
                                }

                                connection.release();
                            });
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error getting connection to clean connection. ERROR: ' + err);
                }
            });
        }

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
                            connection.query('INSERT INTO Text_Space(Room_ID, User_ID, Local_ID, Edit_Time, Num_Style_Nodes, Size, Pos_X, Pos_Y, Width, Height, Edit_Lock, Justified) VALUES(?, ?, ?, CURRENT_TIMESTAMP, 0, ?, ?, ?, ?, ?, ?, ?)',
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
                                        x: data.x, y: data.y, width: data.width, height: data.height, size: data.size, justified: data.justified, editCount: 0,
                                        editTime: new Date()
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
                    serverId: data.serverId, userId: boardConnData[socket.id].userId, editId: boardConnData[socket.id].editCount, num_nodes: data.num_nodes,
                    editTime: new Date()
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
                            connection.query('UPDATE Text_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                            {
                                if (!err)
                                {
                                    var msg: ServerMoveElementMessage = { serverId: data.serverId, x: data.x, y:data.y, editTime: new Date() };
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
                                        connection.query('UPDATE Text_Space SET Pos_X = ?, Pos_Y = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.x, data.y, data.serverId], function(err, rows)
                                        {
                                            if (!err)
                                            {
                                                var msg: ServerMoveElementMessage = { serverId: data.serverId, x: data.x, y:data.y, editTime: new Date() };
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
                            connection.query('UPDATE Text_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function(err, rows)
                            {
                                if (!err)
                                {
                                    var msg: ServerResizeTextMessage = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
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
                                        connection.query('UPDATE Text_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [data.width, data.height, data.serverId], function(err, rows)
                                        {
                                            if (!err)
                                            {
                                                var msg: ServerResizeTextMessage = { serverId: data.serverId, width: data.width, height: data.height, editTime: new Date() };
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
                                        editLock: rows[0].Edit_Lock, justified: rows[0].isJustified, editCount: 0, editTime: rows[0].Edit_Time
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
                        connection.query('USE Online_Comms');
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

        let sendStyle = function(nodeData, textId: number, socket: SocketIO.Socket) : void
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
            let msg: ServerEditTextMessage = { userId: 0, serverId: textData.Entry_ID, editId: 0, num_nodes: textData.Num_Style_Nodes, editTime: textData.Edit_Time };
            socket.emit('EDIT-TEXT', msg);

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
                            connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?', [textData.Entry_ID], (perr, prows, pfields) =>
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
                                        ((data, textId) => { setTimeout(() => { sendStyle(data, textId, socket); }, 100); })(prows[i], textData.Entry_ID);
                                    }
                                }
                                connection.release();
                            });
                        }
                    });
                }
                else
                {
                    console.log('BOARD: Error while getting database connection to send curve. ' + err);
                    connection.release();
                }
            });
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
registerComponent(FreeCurve.MODENAME, FreeCurve.ComponentClass);
