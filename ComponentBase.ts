namespace ComponentBase
{
    /*
     *  Board socket, used for communicating whiteboard data.
     *
     *
     *
     *
     *
     */

    export interface SQLElementData {
        Entry_ID: number;
        Local_ID: number;
        User_ID: number;
        Room_ID: number;
        isDeleted: boolean;
        Edit_Time: Date;
        X_Loc: number;
        Y_Loc: number;
        Width: number;
        Height: number;
        Type: string;
        Edit_Lock: number;
        Edit_Count: number;
    }
    export const SQLElementInsertQuery = 'Type, Room_ID, User_ID, Local_ID, X_Loc, Y_Loc, Width, Height, Edit_Count, Edit_Lock';
    export type SQLElementInsert = [string, number, number, number, number, number, number, number, number, number];

     /**
      * Message types that can be sent between the user and server for any element type.
      */
    export const BaseMessageTypes = {
        NEW: 0,
        DELETE: -1,
        RESTORE: -2,
        DROPPED: -3,
        MOVE: -4,
        RESIZE: -5,
        LOCK: -6,
        RELEASE: -7,
        LOCKID: -8,
        REFUSE: -9
    };

    export abstract class Component {

        protected roomUserList: Array<Array<number>>;

        public constructor(roomUserList: Array<Array<number>>)
        {
            this.roomUserList = roomUserList;
        }

        public abstract userJoin(socket: SocketIO.Socket, boardConnData: BoardConnection);
        public abstract sendData(elemData, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection);
        public abstract handleElementMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection, my_sql_pool: MySql.Pool);
        public abstract handleNew(message, id: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection, my_sql_pool: MySql.Pool);
        public abstract handleUnknownMessage(serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection);
        public abstract handleDisconnect(boardConnData: BoardConnection, my_sql_pool: MySql.Pool);
        public abstract handleReconnect(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool: MySql.Pool);
        public abstract sessionEnd(boardConnData: BoardConnection);

        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        public handleClean(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool: MySql.Pool)
        {
            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('BOARD: Error getting connection to clean connection. ERROR: ' + err);
                    return connection.release();
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while setting database schema. ' + err);
                        return connection.release();
                    }

                    connection.query('UPDATE Whiteboard_Space SET Edit_Lock = 0 WHERE Edit_Lock = ?', [boardConnData.userId], (err, rows, fields) =>
                    {
                        if(err)
                        {
                            console.log('BOARD: Error cleaning connection. ERROR: ' + err);
                        }

                        return connection.release();
                    });

                });
            });
        }

        /** Handle sending the dropped message for this item if the receiving of this element failed.
         *
         *
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        protected dropElement(id: number, socket: SocketIO.Socket, my_sql_pool: MySql.Pool, boardConnData: BoardConnection)
        {
            let droppedMsg : ServerMessage = { header: BaseMessageTypes.DROPPED, payload: null };
            let droppedCont: ServerMessageContainer =
            {
                serverId: id, userId: boardConnData.userId, type: 'ANY', payload: droppedMsg
            };
            socket.emit('MSG-COMPONENT', droppedCont);
        }

        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection, my_sql_pool)
        {
            let type = message.header;

            switch(type)
            {
                case BaseMessageTypes.DELETE:
                    this.handleDeleteMessage(serverId, socket, connection, boardConnData);
                    break;
                case BaseMessageTypes.RESTORE:
                    this.handleRestoreMessage(serverId, socket, connection, boardConnData);
                    break;
                case BaseMessageTypes.MOVE:
                    this.handleMoveMessage(message.payload as UserMoveElementMessage,serverId, socket, connection, boardConnData);
                    break;
                case BaseMessageTypes.RESIZE:
                    this.handleResizeMessage(message.payload as UserResizeElementMessage,serverId, socket, connection, boardConnData);
                    break;
                case BaseMessageTypes.LOCK:
                    this.handleLockMessage(serverId, socket, connection, boardConnData);
                    break;
                case BaseMessageTypes.RELEASE:
                    this.handleReleaseMessage(serverId, socket, connection, boardConnData);
                    break;
                default:
                    this.handleElementMessage(message, serverId, socket, connection, boardConnData, my_sql_pool);
                    break;
            }
        }

        protected handleDeleteMessage(serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverId], (err, rows) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing erase query. ' + err);
                        return connection.release();
                    }

                    let msg : ServerMessage = { header: BaseMessageTypes.DELETE, payload: null };
                    let msgCont: ServerMessageContainer = { serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    connection.release();
                });
            }
            else
            {

                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err: MySql.SQLError, rows: Array<number>) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing erase:findUser query. ' + err);
                        return connection.release();
                    }

                    if(rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit)
                    {
                        connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverId],
                        (err: MySql.SQLError, rows: Array<number>) =>
                        {
                            if (err)
                            {
                                console.log('BOARD: Error while performing erase query. ' + err);
                                return connection.release();
                            }

                            let msg : ServerMessage = { header: BaseMessageTypes.DELETE, payload: null };
                            let msgCont: ServerMessageContainer =
                            {
                                serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                            };
                            socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                            connection.release();
                        });
                    }
                });
            }
        }

        protected handleRestoreMessage(serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverId], (err: MySql.SQLError, rows) =>
                {
                    if (!err)
                    {
                        let msg : ServerMessage = { header: BaseMessageTypes.RESTORE, payload: null };
                        let msgCont: ServerMessageContainer = { serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    }
                    else
                    {
                        console.log('BOARD: Error while performing erase query. ' + err);
                    }
                    connection.release();
                });
            }
            else
            {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err: MySql.SQLError, rows: Array<number>) =>
                {
                    if (!err)
                    {
                        if(rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit)
                        {
                            connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverId], (err, rows) =>
                            {
                                if (!err)
                                {
                                    let msg : ServerMessage = { header: BaseMessageTypes.RESTORE, payload: null };
                                    let msgCont: ServerMessageContainer =
                                    {
                                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                                    };
                                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                                }
                                else
                                {
                                    console.log('BOARD: Error while performing erase query. ' + err);
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

        protected handleMoveMessage(message: UserMoveElementMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            let self = this;
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                self.handleMove(message, serverId, connection, socket, boardConnData);
            }
            else
            {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err, rows) =>
                {
                    if(err)
                    {
                        console.log('BOARD: Error while performing move:findUser query. ' + err);
                        return connection.release();
                    }

                    if(rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit)
                    {
                        self.handleMove(message, serverId, connection, socket, boardConnData);
                    }
                });
            }
        }

        private handleMove(message: UserMoveElementMessage, serverId: number, connection: MySql.SQLConnection, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            connection.query('UPDATE Whiteboard_Space SET X_Loc = ?, Y_Loc = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?',
            [message.x, message.y, serverId],
            (err, rows) =>
            {
                if (!err)
                {
                    let payload: ServerMoveElementMessage =
                    {
                        x: message.x, y: message.y, editTime: new Date()
                    };
                    let msg: ServerMessage = { header: BaseMessageTypes.MOVE, payload: payload };
                    let msgCont: ServerMessageContainer =
                    {
                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                    };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    connection.release();
                }
                else
                {
                    console.log('BOARD: Error while performing move query. ' + err);
                    return connection.rollback(() => { console.error(err); connection.release(); });
                }
            });
        }

        protected handleLockMessage(serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            let self = this;
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                self.handleLock(serverId, connection, socket, boardConnData);
            }
            else
            {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err, rows) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing lock:findUser query. ' + err);
                        self.handleRefuse(serverId, socket, boardConnData);
                        return connection.release();
                    }

                    if(rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit)
                    {
                        self.handleLock(serverId, connection, socket, boardConnData);
                    }
                    else
                    {
                        self.handleRefuse(serverId, socket, boardConnData);
                        connection.release();
                    }
                });
            }
        }

        private handleLock(serverId: number, connection: MySql.SQLConnection, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            let self = this;
            connection.query('SELECT Edit_Lock FROM Whiteboard_Space WHERE Entry_ID = ?', [serverId], function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error getting lock state. ' + err);
                    self.handleRefuse(serverId, socket, boardConnData);
                    return connection.release();
                }

                if(!rows[0].Edit_Lock)
                {
                    connection.query('UPDATE Whiteboard_Space SET Edit_Lock = ? WHERE Entry_ID = ?',
                    [boardConnData.userId, serverId],
                    (err, rows) =>
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while performing move query. ' + err);
                            self.handleRefuse(serverId, socket, boardConnData);
                            return connection.rollback(() => { console.error(err); connection.release(); });
                        }
                        
                        let idMsg: ServerMessage = { header: BaseMessageTypes.LOCKID, payload: null };
                        let idMsgCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: idMsg
                        };
                        socket.emit('MSG-COMPONENT', idMsgCont);

                        let payload: ServerLockElementMessage =
                        {
                            userId: boardConnData.userId
                        };
                        let msg: ServerMessage = { header: BaseMessageTypes.LOCK, payload: payload };
                        let msgCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                        };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                        connection.release();
                    });
                }
                else
                {
                    self.handleRefuse(serverId, socket, boardConnData);
                    connection.release();
                }
            });
        }

        private handleRefuse(serverId: number, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            let msg: ServerMessage = { header: BaseMessageTypes.REFUSE, payload: null };
            let msgCont: ServerMessageContainer =
            {
                serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
            };
            socket.emit('MSG-COMPONENT', msgCont);
        }

        protected handleReleaseMessage(serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            let self = this;

            connection.query('SELECT Edit_Lock FROM Whiteboard_Space WHERE Entry_ID = ?',
            [serverId],
            function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error releasing lock state. ' + err);
                    return connection.release();
                }

                if(rows[0] == null || rows[0] == undefined)
                {
                    connection.release();
                }
                else if(rows[0].Edit_Lock == boardConnData.userId)
                {
                    self.handleRelease(serverId, connection, socket, boardConnData);
                }
                else
                {
                    connection.release();
                }
            });
        }

        private handleRelease(serverId: number, connection: MySql.SQLConnection, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            connection.query('UPDATE Whiteboard_Space SET Edit_Lock = 0 WHERE Entry_ID = ?', [serverId], function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while updating lock state. ' + err);
                    return connection.release();
                }

                let msg: ServerMessage = { header: BaseMessageTypes.RELEASE, payload: null };
                let msgCont: ServerMessageContainer =
                {
                    serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                connection.release();
            });
        }

        protected handleResizeMessage(message: UserResizeElementMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            let self = this;
            if(boardConnData.isHost || boardConnData.allowAllEdit)
            {
                self.handleResize(message, serverId, connection, socket, boardConnData);
            }
            else
            {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId],
                (err, rows) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing resize:findUser query. ' + err);
                        return connection.release();
                    }

                    if(rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit)
                    {
                        self.handleResize(message, serverId, connection, socket, boardConnData);
                    }
                });
            }
        }

        private handleResize(message: UserResizeElementMessage, serverId: number, connection: MySql.SQLConnection, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            connection.query('UPDATE Whiteboard_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?',
            [message.width, message.height, serverId],
            (err, rows) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while performing resize query. ' + err);
                    return connection.rollback(() => { console.error(err); connection.release(); });
                }

                let payload: ServerResizeElementMessage =
                {
                    width: message.width, height: message.height, editTime: new Date()
                };
                let msg: ServerMessage = { header: BaseMessageTypes.RESIZE, payload: payload };
                let msgCont: ServerMessageContainer =
                {
                    serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                connection.release();
            });
        }
    }
}

export = ComponentBase;
