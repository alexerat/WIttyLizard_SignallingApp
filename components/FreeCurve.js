"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var ComponentBase = require("../ComponentBase");
/** Free Curve Component.
*
* This allows the user to free draw curves that will be smoothed and rendered as Beziers.
*
*/
var FreeCurve;
(function (FreeCurve) {
    /**
     * The name of the mode associated with this component.
     */
    FreeCurve.MODENAME = 'FREECURVE';
    var typeCheck = require('check-types');
    /**
     * Message types that can be sent ebtween the user and server.
     */
    var MessageTypes = {
        IGNORE: 1,
        COMPLETE: 2,
        POINT: 3,
        POINTMISSED: 4,
        MISSINGPOINT: 5
    };
    /** Free Curve Component.
    *
    * This is the class that will be used to store the data associated with these components and handle component specific messaging.
    *
    */
    var ComponentClass = (function (_super) {
        __extends(ComponentClass, _super);
        function ComponentClass() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.componentData = [];
            return _this;
        }
        /** Initialize the buffers for this component and socket.
         *
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {BoardConnection} The connection data associated with this socket.
         */
        ComponentClass.prototype.userJoin = function (socket, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            if (userData == undefined || userData == null) {
                userData = { numRecieved: [], numPoints: [], recievedPoints: [], pointRetries: [], timeouts: [], incomplete: [] };
                this.componentData[boardConnData.userId] = userData;
            }
        };
        /** Remove all data for this connection associated with this component.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.sessionEnd = function (boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            if (userData != undefined && userData != null) {
                userData.numRecieved = null;
                userData.numPoints = null;
                userData.recievedPoints = null;
                userData.pointRetries = null;
                userData.timeouts = null;
                userData.incomplete = null;
            }
            userData = null;
        };
        ComponentClass.prototype.sendPoint = function (pointData, socket, boardConnData) {
            var payload = { num: pointData.Seq_Num, x: pointData.X_Loc, y: pointData.Y_Loc };
            var msg = { header: MessageTypes.POINT, payload: payload };
            var msgCont = { serverId: pointData.Entry_ID, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: msg };
            socket.emit('MSG-COMPONENT', msgCont);
        };
        /** Handle the initial sending of this element data to the user.
         *
         *  @param {SQLElementData} elemData - The basic data about this element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.sendData = function (elemData, socket, connection, boardConnData) {
            var self = this;
            connection.query('SELECT * FROM Free_Curve WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, rows, fields) {
                connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, prows, pfields) {
                    if (err) {
                        console.log('BOARD: Error while performing existing control point query. ' + err);
                        return connection.release();
                    }
                    var points = [];
                    for (var i = 0; i < prows.length; i++) {
                        var pointCont = { seq_num: prows[i].Seq_Num, x: prows[i].X_Loc, y: prows[i].Y_Loc };
                        points.push(pointCont);
                    }
                    var curveMsg = {
                        header: null, payload: null, num_points: rows[0].Num_Control_Points, colour: rows[0].Colour, userId: elemData.User_ID,
                        size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height,
                        editTime: elemData.Edit_Time, points: points
                    };
                    var msgCont = {
                        serverId: elemData.Entry_ID, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: curveMsg
                    };
                    socket.emit('NEW-ELEMENT', msgCont);
                    connection.release();
                });
            });
        };
        /** Handle receiving a new element of this component type, checking that the recieved element data is of the right type.
         *
         *  @param {UserNewCurveMessage} message - The message containing the element data.
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        ComponentClass.prototype.handleNew = function (message, id, socket, connection, boardConnData, my_sql_pool) {
            console.log('BOARD: Received curve.');
            if (typeCheck.integer(message.num_points) && typeCheck.string(message.colour) && typeCheck.array(message.points)) {
                this.addNew(message, id, socket, connection, boardConnData, my_sql_pool);
            }
            else {
                return connection.rollback(function () { connection.release(); });
            }
        };
        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        ComponentClass.prototype.handleElementMessage = function (message, serverId, socket, connection, boardConnData, my_sql_pool) {
            var type = message.header;
            switch (type) {
                case MessageTypes.POINT:
                    this.handlePointMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.MISSINGPOINT:
                    this.handleMissingMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                default:
                    console.log('Unknown message type recieved.');
                    connection.release();
                    break;
            }
        };
        /** Handle users requesting information for an unknown element of this component type.
         *
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.handleUnknownMessage = function (serverId, socket, connection, boardConnData) {
            /* TODO: Remove debugging code. */
            console.log('Recieved UNKNOWN message for element: ' + serverId);
            var self = this;
            // Send client curve data if available, client may then request missing points.
            connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [serverId, boardConnData.roomId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing curve query.' + err);
                    return connection.release();
                }
                if (rows[0] == null || rows[0] == undefined) {
                    console.log('Element not found.');
                    return connection.release();
                }
                var elemData = rows[0];
                connection.query('SELECT * FROM Free_Curve WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, rows, fields) {
                    if (err) {
                        console.log('BOARD: Error while performing curve query.' + err);
                        return connection.release();
                    }
                    if (rows[0] == null || rows[0] == undefined) {
                        console.log('BOARD: Error while performing curve query.');
                        return connection.release();
                    }
                    connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, prows, pfields) {
                        if (err) {
                            console.log('BOARD: Error while performing existing control point query. ' + err);
                            return connection.release();
                        }
                        var points = [];
                        for (var i = 0; i < prows.length; i++) {
                            var pointCont = { seq_num: prows[i].Seq_Num, x: prows[i].X_Loc, y: prows[i].Y_Loc };
                            points.push(pointCont);
                        }
                        var curveMsg = {
                            header: null, payload: null, num_points: rows[0].Num_Control_Points, colour: rows[0].Colour,
                            userId: elemData.User_ID, size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc,
                            width: elemData.Width, height: elemData.Height, editTime: elemData.Edit_Time, points: points
                        };
                        /* TODO: Remove debugging outputs. */
                        console.log('Payload: ' + JSON.stringify(curveMsg));
                        var msgCont = {
                            serverId: serverId, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: curveMsg
                        };
                        console.log('Container: ' + JSON.stringify(msgCont));
                        console.log('Sending data....');
                        socket.emit('NEW-ELEMENT', msgCont);
                        connection.release();
                    });
                });
            });
        };
        /** Handle any necessary data handling on a user disconnect (connection need not be cleaned yet, will wait 5 sec for reconnection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.handleDisconnect = function (boardConnData, my_sql_pool) {
            var userData = this.componentData[boardConnData.userId];
            for (var i = 0; i < userData.incomplete.length; i++) {
                console.log('Cleared interval after disconnect.');
                // Stop requesting missing points while disconnected
                clearInterval(userData.timeouts[userData.incomplete[i]]);
            }
        };
        /** Handle any necessary data handling on a user reconnect (connection has not been cleaned).
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         */
        ComponentClass.prototype.handleReconnect = function (boardConnData, socket, my_sql_pool) {
            var userData = this.componentData[boardConnData.userId];
            var self = this;
            for (var i = 0; i < userData.incomplete.length; i++) {
                console.log('Re-added curve timeout after reconnect.');
                // Re-establish the timeouts upon reconnection.
                var curveId = userData.incomplete[i];
                userData.timeouts[curveId] = setInterval(function (id) { self.missedPoints(id, boardConnData, socket, my_sql_pool); }, 1000, curveId);
            }
        };
        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        ComponentClass.prototype.handleClean = function (boardConnData, socket, my_sql_pool) {
            _super.prototype.handleClean.call(this, boardConnData, socket, my_sql_pool);
            var userData = this.componentData[boardConnData.userId];
            for (var i = 0; i < userData.incomplete.length; i++) {
                var curveId = userData.incomplete[i];
                clearInterval(userData.timeouts[curveId]);
                userData.recievedPoints[curveId] = [];
                this.dropElement(curveId, socket, my_sql_pool, boardConnData);
            }
            userData.incomplete = [];
        };
        ComponentClass.prototype.addNew = function (message, id, socket, connection, boardConnData, my_sql_pool) {
            var _this = this;
            var userMessage;
            var broadcastMessage;
            var userData = this.componentData[boardConnData.userId];
            var self = this;
            connection.query('INSERT INTO ' +
                'Free_Curve(Entry_ID, Num_Control_Points, Colour, Size) VALUES(?, ?, ?, ?)', [id, message.num_points, message.colour, message.size], function (err) {
                if (err) {
                    console.log('BOARD: Error while performing new curve query.' + err);
                    _this.dropElement(id, socket, my_sql_pool, boardConnData);
                    return connection.rollback(function () { console.error(err); connection.release(); });
                }
                var missingPoints = [];
                var pointInserts = [];
                var numOK = 0;
                var received = [];
                var cleanPoints = [];
                for (var i = 0; i < message.points.length; i++) {
                    if (typeCheck.number(message.points[i].x) && typeCheck.number(message.points[i].y) && typeCheck.integer(message.points[i].seq_num)) {
                        if (message.points[i].seq_num >= 0 && message.points[i].seq_num < message.num_points) {
                            numOK++;
                            received[message.points[i].seq_num] = true;
                            var pointValue = [id, message.points[i].seq_num, message.points[i].x, message.points[i].y];
                            pointInserts.push(pointValue);
                            cleanPoints.push(message.points[i]);
                        }
                    }
                }
                connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES ?', [pointInserts], function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing control point query. ' + err);
                        _this.dropElement(id, socket, my_sql_pool, boardConnData);
                        return connection.rollback(function () { console.error(err); connection.release(); });
                    }
                    connection.commit(function (err) {
                        if (err) {
                            console.log('BOARD: Error while performing new curve query.' + err);
                            _this.dropElement(id, socket, my_sql_pool, boardConnData);
                            return connection.rollback(function () { console.error(err); connection.release(); });
                        }
                        var idMsg = { serverId: id, localId: message.localId };
                        // Tell the user the ID to assign points to.
                        socket.emit('ELEMENT-ID', idMsg);
                        console.log('BOARD: Sending curve ID: ' + id);
                        userData.incomplete.push(id);
                        if (pointInserts.length < message.num_points) {
                            userData.numRecieved[id] = numOK;
                            userData.numPoints[id] = message.num_points;
                            userData.recievedPoints[id] = received.slice();
                            userData.pointRetries[id] = 0;
                            // Set a 0.5 sec timeout to inform the client of missing points.
                            userData.timeouts[id] = setInterval(self.missedPoints.bind(self), 500, id, boardConnData, socket, my_sql_pool);
                        }
                        else {
                            userData.incomplete.splice(userData.incomplete.indexOf(id), 1);
                            var completeMsg = { header: MessageTypes.COMPLETE, payload: null };
                            var completeCont = {
                                serverId: id, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: completeMsg
                            };
                            socket.emit('MSG-COMPONENT', completeCont);
                        }
                        var curveMsg = {
                            userId: boardConnData.userId, x: message.x, y: message.y, width: message.width, header: null, payload: null,
                            height: message.height, size: message.size, colour: message.colour, num_points: message.num_points,
                            editTime: new Date(), points: cleanPoints
                        };
                        var msgCont = {
                            serverId: id, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: curveMsg
                        };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                        connection.release();
                    });
                });
            });
        };
        //Listens for points as part of a curve, must recive a funn let from the initiation.
        ComponentClass.prototype.handlePointMessage = function (message, serverId, socket, connection, boardConnData) {
            /* TODO: Remove test code. */
            console.log('Recieved point message: ' + JSON.stringify(message));
            var userData = this.componentData[boardConnData.userId];
            if (!userData.recievedPoints[serverId][message.num]) {
                connection.query('INSERT INTO Control_Points(Entry_ID, Seq_Num, X_Loc, Y_Loc) VALUES(?, ?, ?, ?)', [serverId, message.num, message.x, message.y], function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        console.log('ServerId: ' + serverId);
                        return connection.release();
                    }
                    userData.recievedPoints[serverId][message.num] = true;
                    userData.numRecieved[serverId]++;
                    if (userData.numRecieved[serverId] == userData.numPoints[serverId]) {
                        // We recived eveything so clear the timeout and give client the OK.
                        clearInterval(userData.timeouts[serverId]);
                        userData.incomplete.splice(userData.incomplete.indexOf(serverId), 1);
                        var completeMsg = { header: MessageTypes.COMPLETE, payload: null };
                        var completeCont = {
                            serverId: serverId, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: completeMsg
                        };
                        socket.emit('MSG-COMPONENT', completeCont);
                    }
                    connection.release();
                });
            }
        };
        /** Handle sending the dropped message for this item if the receiving of this element failed.
         *
         *
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.dropElement = function (id, socket, my_sql_pool, boardConnData) {
            _super.prototype.dropElement.call(this, id, socket, my_sql_pool, boardConnData);
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    return connection.release();
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        return connection.release();
                    }
                    connection.query('DELETE FROM Control_Points WHERE Entry_ID = ?', [id], function (err, result) {
                        if (err) {
                            console.log('BOARD: Error while removing badly formed curve. ' + err);
                            return connection.release();
                        }
                        connection.query('DELETE FROM Free_Curve WHERE Entry_ID = ?', [id], function (err, result) {
                            if (!err) {
                                console.log('BOARD: Error while removing badly formed curve. ' + err);
                                return connection.release();
                            }
                            connection.query('DELETE FROM Whiteboard_Space WHERE Entry_ID = ?', [id], function (err, result) {
                                if (err) {
                                    console.log('BOARD: Error while removing badly formed curve. ' + err);
                                }
                                connection.release();
                            });
                        });
                    });
                });
            });
        };
        ComponentClass.prototype.missedPoints = function (curveId, boardConnData, socket, my_sql_pool) {
            var userData = this.componentData[boardConnData.userId];
            userData.pointRetries[curveId]++;
            for (var i = 0; i < userData.numPoints[curveId]; i++) {
                if (!userData.recievedPoints[curveId][i]) {
                    if (userData.pointRetries[curveId] > 10 || boardConnData.cleanUp) {
                        clearInterval(userData.timeouts[curveId]);
                        userData.recievedPoints[curveId] = [];
                        this.dropElement(curveId, socket, my_sql_pool, boardConnData);
                        return;
                    }
                    else {
                        if (boardConnData.isConnected) {
                            var payload = { num: i };
                            var missedMsg = { header: MessageTypes.POINTMISSED, payload: payload };
                            var missedCont = {
                                serverId: curveId, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: missedMsg
                            };
                            socket.emit('MSG-COMPONENT', missedCont);
                        }
                    }
                }
            }
        };
        // Listen for cliets requesting missing data.
        ComponentClass.prototype.handleMissingMessage = function (message, serverId, socket, connection, boardConnData) {
            console.log('BOARD: Received missing message.');
            this.sendMissingPoint(message, serverId, socket, connection, boardConnData);
        };
        ComponentClass.prototype.sendMissingPoint = function (data, serverId, socket, connection, boardConnData) {
            console.log('BOARD: Looking for Curve ID: ' + serverId + ' sequence number: ' + data.seq_num);
            connection.query('SELECT Entry_ID FROM Whiteboard_Space WHERE Entry_ID = ? ', [serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing control point query.' + err);
                    return connection.release();
                }
                if (rows[0]) {
                    connection.query('SELECT X_Loc, Y_Loc FROM Control_Points WHERE Entry_ID = ? AND Seq_Num = ?', [serverId, data.seq_num], function (err, rows, fields) {
                        if (err) {
                            console.log('BOARD: Error while performing control point query.' + err);
                            return connection.release();
                        }
                        if (rows[0]) {
                            var payload = { num: data.seq_num, x: rows[0].X_Loc, y: rows[0].Y_Loc };
                            var msg = { header: MessageTypes.POINT, payload: payload };
                            var msgCont = { serverId: serverId, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: msg };
                            socket.emit('MSG-COMPONENT', msgCont);
                        }
                        connection.release();
                    });
                }
                else {
                    console.log('Sending ignore message.');
                    var msg = { header: MessageTypes.IGNORE, payload: null };
                    var msgCont = { serverId: serverId, userId: boardConnData.userId, type: FreeCurve.MODENAME, payload: msg };
                    socket.emit('MSG-COMPONENT', msgCont);
                    connection.release();
                }
            });
        };
        return ComponentClass;
    }(ComponentBase.Component));
    FreeCurve.ComponentClass = ComponentClass;
})(FreeCurve || (FreeCurve = {}));
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = function (registerComponent) {
    registerComponent(FreeCurve.MODENAME, FreeCurve.ComponentClass);
};
