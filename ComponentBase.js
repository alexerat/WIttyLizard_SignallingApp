"use strict";
var ComponentBase;
(function (ComponentBase) {
    /*
     *  Board socket, used for communicating whiteboard data.
     *
     *
     *
     *
     *
     */
    ComponentBase.SQLElementInsertQuery = 'Type, Room_ID, User_ID, Local_ID, X_Loc, Y_Loc, Width, Height, Edit_Count, Edit_Lock';
    /**
     * Message types that can be sent between the user and server for any element type.
     */
    ComponentBase.BaseMessageTypes = {
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
    var Component = (function () {
        function Component(roomUserList) {
            this.roomUserList = roomUserList;
        }
        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        Component.prototype.handleClean = function (boardConnData, socket, my_sql_pool) {
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('BOARD: Error getting connection to clean connection. ERROR: ' + err);
                    return connection.release();
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.log('BOARD: Error while setting database schema. ' + err);
                        return connection.release();
                    }
                    connection.query('UPDATE Whiteboard_Space SET Edit_Lock = 0 WHERE Edit_Lock = ?', [boardConnData.userId], function (err, rows, fields) {
                        if (err) {
                            console.log('BOARD: Error cleaning connection. ERROR: ' + err);
                        }
                        return connection.release();
                    });
                });
            });
        };
        /** Handle sending the dropped message for this item if the receiving of this element failed.
         *
         *
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        Component.prototype.dropElement = function (id, socket, my_sql_pool, boardConnData) {
            var droppedMsg = { header: ComponentBase.BaseMessageTypes.DROPPED, payload: null };
            var droppedCont = {
                serverId: id, userId: boardConnData.userId, type: 'ANY', payload: droppedMsg
            };
            socket.emit('MSG-COMPONENT', droppedCont);
        };
        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        Component.prototype.handleMessage = function (message, serverId, socket, connection, boardConnData, my_sql_pool) {
            var type = message.header;
            switch (type) {
                case ComponentBase.BaseMessageTypes.DELETE:
                    this.handleDeleteMessage(serverId, socket, connection, boardConnData);
                    break;
                case ComponentBase.BaseMessageTypes.RESTORE:
                    this.handleRestoreMessage(serverId, socket, connection, boardConnData);
                    break;
                case ComponentBase.BaseMessageTypes.MOVE:
                    this.handleMoveMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                case ComponentBase.BaseMessageTypes.RESIZE:
                    this.handleResizeMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                case ComponentBase.BaseMessageTypes.LOCK:
                    this.handleLockMessage(serverId, socket, connection, boardConnData);
                    break;
                case ComponentBase.BaseMessageTypes.RELEASE:
                    this.handleReleaseMessage(serverId, socket, connection, boardConnData);
                    break;
                default:
                    this.handleElementMessage(message, serverId, socket, connection, boardConnData, my_sql_pool);
                    break;
            }
        };
        Component.prototype.handleDeleteMessage = function (serverId, socket, connection, boardConnData) {
            if (boardConnData.isHost || boardConnData.allowAllEdit) {
                connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverId], function (err, rows) {
                    if (!err) {
                        var msg = { header: ComponentBase.BaseMessageTypes.DELETE, payload: null };
                        var msgCont = { serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    }
                    else {
                        console.log('BOARD: Error while performing erase query. ' + err);
                    }
                    connection.release();
                });
            }
            else {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId], function (err, rows) {
                    if (!err) {
                        if (rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit) {
                            connection.query('UPDATE Whiteboard_Space SET isDeleted = 1 WHERE Entry_ID = ?', [serverId], function (err, rows) {
                                if (!err) {
                                    var msg = { header: ComponentBase.BaseMessageTypes.DELETE, payload: null };
                                    var msgCont = {
                                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                                    };
                                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                                }
                                else {
                                    console.log('BOARD: Error while performing erase query. ' + err);
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
        };
        Component.prototype.handleRestoreMessage = function (serverId, socket, connection, boardConnData) {
            if (boardConnData.isHost || boardConnData.allowAllEdit) {
                connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverId], function (err, rows) {
                    if (!err) {
                        var msg = { header: ComponentBase.BaseMessageTypes.RESTORE, payload: null };
                        var msgCont = { serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    }
                    else {
                        console.log('BOARD: Error while performing erase query. ' + err);
                    }
                    connection.release();
                });
            }
            else {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId], function (err, rows) {
                    if (!err) {
                        if (rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit) {
                            connection.query('UPDATE Whiteboard_Space SET isDeleted = 0 WHERE Entry_ID = ?', [serverId], function (err, rows) {
                                if (!err) {
                                    var msg = { header: ComponentBase.BaseMessageTypes.RESTORE, payload: null };
                                    var msgCont = {
                                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                                    };
                                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                                }
                                else {
                                    console.log('BOARD: Error while performing erase query. ' + err);
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
        };
        Component.prototype.handleMoveMessage = function (message, serverId, socket, connection, boardConnData) {
            var self = this;
            if (boardConnData.isHost || boardConnData.allowAllEdit) {
                self.handleMove(message, serverId, connection, socket, boardConnData);
            }
            else {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing move:findUser query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit) {
                        self.handleMove(message, serverId, connection, socket, boardConnData);
                    }
                });
            }
        };
        Component.prototype.handleMove = function (message, serverId, connection, socket, boardConnData) {
            connection.query('UPDATE Whiteboard_Space SET X_Loc = ?, Y_Loc = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [message.x, message.y, serverId], function (err, rows) {
                if (!err) {
                    var payload = {
                        x: message.x, y: message.y, editTime: new Date()
                    };
                    var msg = { header: ComponentBase.BaseMessageTypes.MOVE, payload: payload };
                    var msgCont = {
                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                    };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    connection.release();
                }
                else {
                    console.log('BOARD: Error while performing move query. ' + err);
                    return connection.rollback(function () { console.error(err); connection.release(); });
                }
            });
        };
        Component.prototype.handleLockMessage = function (serverId, socket, connection, boardConnData) {
            var self = this;
            if (boardConnData.isHost || boardConnData.allowAllEdit) {
                self.handleLock(serverId, connection, socket, boardConnData);
            }
            else {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId], function (err, rows) {
                    if (!err) {
                        if (rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit) {
                            self.handleLock(serverId, connection, socket, boardConnData);
                        }
                        else {
                            self.handleRefuse(serverId, socket, boardConnData);
                            connection.release();
                        }
                    }
                    else {
                        console.log('BOARD: Error while performing lock:findUser query. ' + err);
                        self.handleRefuse(serverId, socket, boardConnData);
                        connection.release();
                    }
                });
            }
        };
        Component.prototype.handleLock = function (serverId, connection, socket, boardConnData) {
            var self = this;
            connection.query('SELECT Edit_Lock FROM Whiteboard_Space WHERE Entry_ID = ?', [serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error getting lock state. ' + err);
                    self.handleRefuse(serverId, socket, boardConnData);
                    connection.release();
                }
                else {
                    if (!rows[0].Edit_Lock) {
                        connection.query('UPDATE Whiteboard_Space SET Edit_Lock = ? WHERE Entry_ID = ?', [boardConnData.userId, serverId], function (err, rows) {
                            if (!err) {
                                var idMsg = { header: ComponentBase.BaseMessageTypes.LOCKID, payload: null };
                                var idMsgCont = {
                                    serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: idMsg
                                };
                                socket.emit('MSG-COMPONENT', idMsgCont);
                                var payload = {
                                    userId: boardConnData.userId
                                };
                                var msg = { header: ComponentBase.BaseMessageTypes.LOCK, payload: payload };
                                var msgCont = {
                                    serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                                };
                                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                                connection.release();
                            }
                            else {
                                console.log('BOARD: Error while performing move query. ' + err);
                                self.handleRefuse(serverId, socket, boardConnData);
                                return connection.rollback(function () { console.error(err); connection.release(); });
                            }
                        });
                    }
                    else {
                        self.handleRefuse(serverId, socket, boardConnData);
                        connection.release();
                    }
                }
            });
        };
        Component.prototype.handleRefuse = function (serverId, socket, boardConnData) {
            var msg = { header: ComponentBase.BaseMessageTypes.REFUSE, payload: null };
            var msgCont = {
                serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
            };
            socket.emit('MSG-COMPONENT', msgCont);
        };
        Component.prototype.handleReleaseMessage = function (serverId, socket, connection, boardConnData) {
            var self = this;
            connection.query('SELECT Edit_Lock FROM Whiteboard_Space WHERE Entry_ID = ?', [serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error releasing lock state. ' + err);
                    connection.release();
                }
                else {
                    if (rows[0] == null || rows[0] == undefined) {
                        connection.release();
                    }
                    else if (rows[0].Edit_Lock == boardConnData.userId) {
                        self.handleRelease(serverId, connection, socket, boardConnData);
                    }
                    else {
                        connection.release();
                    }
                }
            });
        };
        Component.prototype.handleRelease = function (serverId, connection, socket, boardConnData) {
            connection.query('UPDATE Whiteboard_Space SET Edit_Lock = 0 WHERE Entry_ID = ?', [serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while updating lock state. ' + err);
                }
                else {
                    var msg = { header: ComponentBase.BaseMessageTypes.RELEASE, payload: null };
                    var msgCont = {
                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                    };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                }
                connection.release();
            });
        };
        Component.prototype.handleResizeMessage = function (message, serverId, socket, connection, boardConnData) {
            var self = this;
            if (boardConnData.isHost || boardConnData.allowAllEdit) {
                self.handleResize(message, serverId, connection, socket, boardConnData);
            }
            else {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId], function (err, rows) {
                    if (!err) {
                        if (rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit) {
                            self.handleResize(message, serverId, connection, socket, boardConnData);
                        }
                    }
                    else {
                        console.log('BOARD: Error while performing resize:findUser query. ' + err);
                        connection.release();
                    }
                });
            }
        };
        Component.prototype.handleResize = function (message, serverId, connection, socket, boardConnData) {
            connection.query('UPDATE Whiteboard_Space SET Width = ?, Height = ?, Edit_Time = CURRENT_TIMESTAMP WHERE Entry_ID = ?', [message.width, message.height, serverId], function (err, rows) {
                if (!err) {
                    var payload = {
                        width: message.width, height: message.height, editTime: new Date()
                    };
                    var msg = { header: ComponentBase.BaseMessageTypes.RESIZE, payload: payload };
                    var msgCont = {
                        serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: msg
                    };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    connection.release();
                }
                else {
                    console.log('BOARD: Error while performing resize query. ' + err);
                    return connection.rollback(function () { console.error(err); connection.release(); });
                }
            });
        };
        return Component;
    }());
    ComponentBase.Component = Component;
})(ComponentBase || (ComponentBase = {}));
module.exports = ComponentBase;
