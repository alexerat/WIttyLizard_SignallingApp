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

/** Free Curve Component.
*
* This allows the user to free draw curves that will be smoothed and rendered as Beziers.
*
*/
namespace FreeCurve {
    /**
     * The name of the mode associated with this component.
     */
    export const MODENAME = 'FREECURVE';

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
        points: Array<PointContainer>;
    }
    interface ServerNewPointMessage extends ServerPayload {
        num: number;
        x: number;
        y: number;
    }
    interface ServerMissedPointMessage extends ServerPayload {
        num: number;
    }

    interface PointContainer extends Point {
        seq_num: number;
    }

    interface UserNewCurveMessage extends UserNewElementPayload {
        colour: string;
        size: number;
        num_points: number;
        points: Array<PointContainer>;
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
        numRecieved: Array<number>;
        numPoints: Array<number>;
        recievedPoints: Array<Array<boolean>>;
        pointRetries: Array<number>;
        curveTimeouts: Array<any>;
        incomplete: Array<number>;
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
            let userData: ComponentData = { numRecieved: [], numPoints: [], recievedPoints: [], pointRetries: [], curveTimeouts: [], incomplete: [] };
            this.componentData[boardConnData.userId] = userData;
        }

        private sendPoint(pointData, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            let payload : ServerNewPointMessage = { num: pointData.Seq_Num, x: pointData.X_Loc, y: pointData.Y_Loc };
            let msg : ServerMessage = { header: MessageTypes.POINT, payload: payload };
            let msgCont: ServerMessageContainer = { serverId: pointData.Entry_ID, userId: boardConnData.userId, type: MODENAME, payload: msg };
            socket.emit('MSG-COMPONENT', msgCont);
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
            let self = this;
            connection.query('SELECT * FROM Free_Curve WHERE Entry_ID = ?', [elemData.Entry_ID], (err, rows, fields) =>
            {
                connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [elemData.Entry_ID], (err, prows, pfields) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing existing control point query. ' + err);
                    }
                    else
                    {
                        let points: Array<PointContainer> = [];

                        for(let i = 0; i < prows.length; i++)
                        {
                            let pointCont: PointContainer = { seq_num: prows[i].Seq_Num, x: prows[i].X_Loc, y: prows[i].Y_Loc };

                            points.push(pointCont);
                        }

                        let curveMsg: ServerNewCurvePayload = {
                            header: null, payload: null, num_points: rows[0].Num_Control_Points, colour: rows[0].Colour, userId: elemData.User_ID,
                            size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height,
                            editTime: elemData.Edit_Time, points: points
                        };
                        let msgCont: ServerMessageContainer =
                        {
                            serverId: elemData.Entry_ID, userId: boardConnData.userId, type: MODENAME, payload: curveMsg
                        };

                        socket.emit('NEW-ELEMENT', msgCont);
                    }
                    connection.release();
                });
            });
        }

        /** Handle receiving a new element of this component type.
         *
         *  @param {UserNewCurveMessage} message - The message containing the element data.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleNew(message: UserNewCurveMessage, id: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection, my_sql_pool)
        {
            console.log('BOARD: Received curve.');
            if(message.num_points && message.colour)
            {
                this.addNew(message, id, socket, connection, boardConnData, my_sql_pool);
            }
            else
            {
                return connection.rollback(() => { connection.release(); });
            }
        }

        private addNew(message: UserNewCurveMessage, id: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection, my_sql_pool)
        {
            let userMessage;
            let broadcastMessage;
            let userData = this.componentData[boardConnData.userId];
            let self = this;

            var idMsg : ServerIdMessage = { serverId: id, localId: message.localId };
            // Tell the user the ID to assign points to.
            socket.emit('ELEMENT-ID', idMsg);

            console.log('BOARD: Sending curve ID: ' + id);

            userData.incomplete.push(id);

            connection.query('INSERT INTO ' +
            'Free_Curve(Entry_ID, Num_Control_Points, Colour, Size) VALUES(?, ?, ?, ?)',
            [id, message.num_points, message.colour, message.size],
            (err) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while performing new curve query.' + err);

                    let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: null };
                    let droppedCont: ServerMessageContainer =
                    {
                        serverId: id, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                    };
                    socket.emit('MSG-COMPONENT', droppedCont);

                    return connection.rollback(() => { console.error(err); connection.release(); });
                }
                else
                {
                    let missingPoints = [];
                    let pointInserts = [];
                    let numOK = 0;
                    let received = [];
                    let cleanPoints = [];

                    for(let i = 0; i < message.points.length; i++)
                    {
                        if(typeof message.points[i].x === 'number' && typeof message.points[i].y === 'number' && typeof message.points[i].seq_num === 'number')
                        {
                            if(message.points[i].seq_num >= 0 && message.points[i].seq_num < message.num_points)
                            {
                                numOK++;
                                received[message.points[i].seq_num] = true;
                                let pointValue = [id, message.points[i].seq_num, message.points[i].x, message.points[i].y];
                                pointInserts.push(pointValue);
                                cleanPoints.push(message.points[i]);
                            }
                        }
                    }

                    connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES ?',
                    [pointInserts],
                    (err) =>
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while performing control point query. ' + err);

                            let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: null };
                            let droppedCont: ServerMessageContainer =
                            {
                                serverId: id, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                            };
                            socket.emit('MSG-COMPONENT', droppedCont);

                            return connection.rollback(() => { console.error(err); connection.release(); });
                        }
                        else
                        {
                            connection.commit((err) =>
                            {
                                if (!err)
                                {
                                    if(pointInserts.length < message.num_points)
                                    {
                                        userData.numRecieved[id] = numOK;
                                        userData.numPoints[id] = message.num_points;
                                        userData.recievedPoints[id] = received.slice();
                                        userData.pointRetries[id] = 0;
                                        // Set a 0.5 sec timeout to inform the client of missing points.
                                        userData.curveTimeouts[id] = setInterval(self.missedPoints.bind(self), 500, id, boardConnData, socket, my_sql_pool);
                                    }
                                    else
                                    {
                                        userData.incomplete.splice(userData.incomplete.indexOf(id), 1);

                                        let completeMsg : ServerMessage = { header: MessageTypes.COMPLETE, payload: null };
                                        let completeCont: ServerMessageContainer =
                                        {
                                            serverId: id, userId: boardConnData.userId, type: MODENAME, payload: completeMsg
                                        };
                                        socket.emit('MSG-COMPONENT', completeCont);
                                    }

                                    var curveMsg : ServerNewCurvePayload = {
                                        userId: boardConnData.userId, x: message.x, y: message.y, width: message.width, header: null, payload: null,
                                        height: message.height, size: message.size, colour: message.colour, num_points: message.num_points,
                                        editTime: new Date(), points: cleanPoints
                                    };

                                    let msgCont: ServerMessageContainer =
                                    {
                                        serverId: id, userId: boardConnData.userId, type: MODENAME, payload: curveMsg
                                    };

                                    socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                                    connection.release();
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing new curve query.' + err);

                                    let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: null };
                                    let droppedCont: ServerMessageContainer =
                                    {
                                        serverId: id, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                                    };
                                    socket.emit('MSG-COMPONENT', droppedCont);

                                    return connection.rollback(() => { console.error(err); connection.release(); });
                                }
                            });
                        }
                    });
                }
            });

        }

        private missedPoints(curveId: number, boardConnData, socket: SocketIO.Socket, my_sql_pool)
        {
            let userData = this.componentData[boardConnData.userId];
            userData.pointRetries[curveId]++;
            for(let i = 0; i < userData.numPoints[curveId]; i++)
            {
                if(!userData.recievedPoints[curveId][i])
                {
                    if(userData.pointRetries[curveId] > 10 || boardConnData.cleanUp)
                    {
                        clearInterval(userData.curveTimeouts[curveId]);
                        userData.recievedPoints[curveId] = [];

                        let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: null };
                        let droppedCont: ServerMessageContainer =
                        {
                            serverId: curveId, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                        };
                        socket.emit('MSG-COMPONENT', droppedCont);

                        my_sql_pool.getConnection((err, connection) =>
                        {
                            if(!err)
                            {
                                connection.query('USE Online_Comms',
                                (err) =>
                                {
                                    if (err)
                                    {
                                        console.log('BOARD: Error while performing new control point query. ' + err);
                                        connection.release();
                                    }
                                    else
                                    {
                                        connection.query('DELETE FROM Control_Points WHERE Entry_ID = ?', [curveId], (err, result) =>
                                        {
                                            if(!err)
                                            {
                                                connection.query('DELETE FROM Free_Curve WHERE Entry_ID = ?', [curveId], (err, result) =>
                                                {
                                                    if(!err)
                                                    {
                                                        connection.query('DELETE FROM Whiteboard_Space WHERE Entry_ID = ?', [curveId], (err, result) =>
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
                                                console.log('BOARD: Error while removing badly formed curve. ' + err);
                                                connection.release();
                                            }
                                        });
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
                        if(boardConnData.isConnected)
                        {
                            let payload: ServerMissedPointMessage = { num: i };
                            let missedMsg : ServerMessage = { header: MessageTypes.POINTMISSED, payload: payload };
                            let missedCont: ServerMessageContainer =
                            {
                                serverId: curveId, userId: boardConnData.userId, type: MODENAME, payload: missedMsg
                            };
                            socket.emit('MSG-COMPONENT', missedCont);
                        }
                    }
                }
            }
        };

        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection, my_sql_pool)
        {
            let type = message.header;

            switch(type)
            {
                case MessageTypes.POINT:
                    this.handlePointMessage(message.payload as UserNewPointMessage, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.DELETE:
                    this.handleDeleteMessage(serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.RESTORE:
                    this.handleRestoreMessage(serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.MOVE:
                    this.handleMoveMessage(message.payload as UserMoveElementMessage,serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.MISSINGPOINT:
                    this.handleMissingMessage(message.payload as UserMissingPointMessage,serverId, socket, connection, boardConnData);
                    break;
                default:
                    break;
            }
        }

        //Listens for points as part of a curve, must recive a funn let from the initiation.
        private handlePointMessage(message: UserNewPointMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            /* TODO: Remove test code. */
            console.log('Recieved point message: ' + JSON.stringify(message));

            let userData = this.componentData[boardConnData.userId];
            if(!userData.recievedPoints[serverId][message.num])
            {
                connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES(?, ?, ?, ?)',
                [serverId, message.num, message.x, message.y],
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        console.log('ServerId: ' + serverId);
                    }
                    else
                    {
                        userData.recievedPoints[serverId][message.num] = true;
                        userData.numRecieved[serverId]++;

                        if(userData.numRecieved[serverId] == userData.numPoints[serverId])
                        {
                            // We recived eveything so clear the timeout and give client the OK.
                            clearInterval(userData.curveTimeouts[serverId]);

                            userData.incomplete.splice(userData.incomplete.indexOf(serverId), 1);

                            let completeMsg : ServerMessage = { header: MessageTypes.COMPLETE, payload: null };
                            let completeCont: ServerMessageContainer =
                            {
                                serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: completeMsg
                            };
                            socket.emit('MSG-COMPONENT', completeCont);
                        }
                    }
                    connection.release();
                });
            }
        }

        private handleDeleteMessage(serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            console.log('Received Delete Curve Event.');
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverId], (err, rows) =>
                {
                    if (!err)
                    {
                        let msg : ServerMessage = { header: MessageTypes.DELETE, payload: null };
                        let msgCont: ServerMessageContainer = { serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
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
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err, rows) =>
                {
                    if (!err)
                    {
                        if(rows[0] && boardConnData.allowUserEdit)
                        {
                            connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverId], (err, rows) =>
                            {
                                if (!err)
                                {
                                    let msg : ServerMessage = { header: MessageTypes.DELETE, payload: null };
                                    let msgCont: ServerMessageContainer =
                                    {
                                        serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg
                                    };
                                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
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
        }

        private handleRestoreMessage(serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            console.log('Received Restore Curve Event.');
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverId], (err, rows) =>
                {
                    if (!err)
                    {
                        let msg : ServerMessage = { header: MessageTypes.RESTORE, payload: null };
                        let msgCont: ServerMessageContainer = { serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
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
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err, rows) =>
                {
                    if (!err)
                    {
                        if(rows[0] && boardConnData.allowUserEdit)
                        {
                            connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverId], (err, rows) =>
                            {
                                if (!err)
                                {
                                    let msg : ServerMessage = { header: MessageTypes.RESTORE, payload: null };
                                    let msgCont: ServerMessageContainer =
                                    {
                                        serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg
                                    };
                                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
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
        }


        private handleMoveMessage(message: UserMoveElementMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            let self = this;
            console.log('Received Move Curve Event.');
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                self.handleMove(message, serverId, connection, socket, boardConnData);
            }
            else
            {

                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err, rows) =>
                {
                    if (!err)
                    {
                        if(rows[0] && boardConnData.allowUserEdit)
                        {
                            self.handleMove(message, serverId, connection, socket, boardConnData);
                        }
                    }
                    else
                    {
                        console.log('BOARD: Error while performing move:findUser query. ' + err);
                        connection.release();
                    }
                });

            }
        }

        private handleMove(message: UserMoveElementMessage, serverId: number, connection, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            connection.query('UPDATE Whiteboard_Space SET X_Loc = ?, Y_Loc = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?',
            [message.x, message.y, serverId],
            (err, rows) =>
            {
                if (!err)
                {
                    let payload: ServerMoveElementMessage = {
                        x: message.x, y: message.y, editTime: new Date()
                    };
                    let msg: ServerMessage = { header: MessageTypes.MOVE, payload: payload };
                    let msgCont: ServerMessageContainer =
                    {
                        serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg
                    };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    connection.release();
                }
                else
                {
                    console.log('BOARD: Error while performing move curve query. ' + err);
                    return connection.rollback(() => { console.error(err); connection.release(); });
                }
            });

        }

        // Listen for cliets requesting missing data.
        private handleMissingMessage(message: UserMissingPointMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            console.log('BOARD: Received missing message.');
            this.sendMissingPoint(message, serverId, socket, connection, boardConnData);

        }

        private sendMissingPoint(data: UserMissingPointMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            console.log('BOARD: Looking for Curve ID: ' + serverId + ' sequence number: ' + data.seq_num);
            connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? ', [serverId],  (err, rows, fields) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while performing control point query.' + err);
                }
                else
                {
                    if(rows[0])
                    {
                        connection.query('SELECT X_Loc, Y_Loc FROM Control_Points WHERE Entry_ID = ? AND Seq_Num = ?', [serverId, data.seq_num],
                        (err, rows, fields) =>
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing control point query.' + err);
                            }
                            else
                            {
                                if(rows[0])
                                {
                                    let payload : ServerNewPointMessage = { num: data.seq_num, x: rows[0].X_Loc, y: rows[0].Y_Loc };
                                    let msg : ServerMessage = { header: MessageTypes.POINT, payload: payload };
                                    let msgCont: ServerMessageContainer = { serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg };
                                    socket.emit('MSG-COMPONENT', msgCont);
                                }
                            }
                        });
                    }
                    else
                    {
                        console.log('Sending ignore message.');
                        let msg : ServerMessage = { header: MessageTypes.IGNORE, payload: null };
                        let msgCont: ServerMessageContainer = { serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: msg };
                        socket.emit('MSG-COMPONENT', msgCont);
                    }
                }
                connection.release();
            });
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
            console.log('Recieved UNKNOWN message for element: ' + serverId);
            let self = this;
            // Send client curve data if available, client may then request missing points.
            connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [serverId, boardConnData.roomId],
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
                        let elemData = rows[0];
                        connection.query('SELECT * FROM Free_Curve WHERE Entry_ID = ?', [elemData.Entry_ID], (err, rows, fields) =>
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing curve query.' + err);
                            }
                            else
                            {
                                if(rows[0])
                                {
                                    connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [elemData.Entry_ID], (err, prows, pfields) =>
                                    {
                                        if (err)
                                        {
                                            console.log('BOARD: Error while performing existing control point query. ' + err);
                                        }
                                        else
                                        {
                                            let points: Array<PointContainer> = [];

                                            for(let i = 0; i < prows.length; i++)
                                            {
                                                let pointCont: PointContainer = { seq_num: prows[i].Seq_Num, x: prows[i].X_Loc, y: prows[i].Y_Loc };

                                                points.push(pointCont);
                                            }

                                            let curveMsg: ServerNewCurvePayload = {
                                                header: null, payload: null, num_points: rows[0].Num_Control_Points, colour: rows[0].Colour,
                                                userId: elemData.User_ID, size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc,
                                                width: elemData.Width, height: elemData.Height, editTime: elemData.Edit_Time, points: points
                                            };

                                            console.log('Payload: ' + JSON.stringify(curveMsg));

                                            let msgCont: ServerMessageContainer =
                                            {
                                                serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: curveMsg
                                            };

                                            console.log('Container: ' + JSON.stringify(msgCont));
                                            console.log('Sending data....');
                                            socket.emit('NEW-ELEMENT', msgCont);
                                        }
                                        connection.release();
                                    });
                                }
                            }
                        });
                    }
                    else
                    {
                        console.log('Element not found.');
                        connection.release();
                    }
                }
            });

        }

        /** Handle any necessary data handling on a user disconnect (connection need not be cleaned yet, will wait 5 sec for reconnection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleDisconnect(boardConnData: BoardConnection, my_sql_pool)
        {
            let userData = this.componentData[boardConnData.userId];
            for(let i = 0; i < userData.incomplete.length; i++)
            {
                console.log('Cleared interval after disconnect.');
                // Stop requesting missing points while disconnected
                clearInterval(userData.curveTimeouts[userData.incomplete[i]]);
            }
        }

        /** Handle any necessary data handling on a user reconnect (connection has not been cleaned).
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         */
        public handleReconnect(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool)
        {
            let userData = this.componentData[boardConnData.userId];
            let self = this;
            for(let i = 0; i < userData.incomplete.length; i++)
            {
                console.log('Readded curve timeout after reconnect.');
                // Re-establish the timeouts upon reconnection.
                let curveId = userData.incomplete[i];
                userData.curveTimeouts[curveId] = setInterval((id) => { self.missedPoints(id, boardConnData, socket, my_sql_pool); }, 1000, curveId);
            }
        }

        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleClean(boardConnData: BoardConnection, my_sql_pool)
        {
            let userData = this.componentData[boardConnData.userId];

            for(let i = 0; i < userData.incomplete.length; i++)
            {
                let curveId = userData.incomplete[i];
                clearInterval(userData.curveTimeouts[curveId]);
                userData.recievedPoints[curveId] = [];

                my_sql_pool.getConnection((err, connection) =>
                {
                    if(!err)
                    {
                        connection.query('USE Online_Comms',
                        (err) =>
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing new control point query. ' + err);
                                connection.release();
                            }
                            else
                            {
                                connection.query('DELETE FROM Control_Points WHERE Entry_ID = ?', [curveId], (err, result) =>
                                {
                                    if(!err)
                                    {
                                        connection.query('DELETE FROM Free_Curve WHERE Entry_ID = ?', [curveId], (err, result) =>
                                        {
                                            if(!err)
                                            {
                                                connection.query('DELETE FROM Whiteboard_Space WHERE Entry_ID = ?', [curveId], (err, result) =>
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
                                        console.log('BOARD: Error while removing badly formed curve. ' + err);
                                        connection.release();
                                    }
                                });
                            }
                        });
                    }
                    else
                    {
                        connection.release();
                        console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    }
                });
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = function(registerComponent) {
    registerComponent(FreeCurve.MODENAME, FreeCurve.ComponentClass);
}
