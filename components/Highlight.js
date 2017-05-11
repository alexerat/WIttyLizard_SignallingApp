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
/** Highlight Component.
*
* This allows the user to highlight areas for other users to see.
*
*/
var Highlight;
(function (Highlight) {
    /**
     * The name of the mode associated with this component.
     */
    Highlight.MODENAME = 'HIGHLIGHT';
    /**
     * Message types that can be sent ebtween the user and server.
     */
    var MessageTypes = {};
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
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.userJoin = function (socket, boardConnData) {
        };
        /** Remove all data for this connection associated with this component.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.sessionEnd = function (boardConnData) {
        };
        /** Handle the initial sending of this element data to the user.
         *
         *  @param {SQLReturn} elemData - The basic data about this element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.sendData = function (elemData, socket, connection, boardConnData) {
            var newMsg = {
                header: null, payload: null, colour: this.roomUserList[elemData.Room_ID][elemData.User_ID], userId: elemData.User_ID,
                x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height
            };
            var msgCont = {
                serverId: elemData.Entry_ID, userId: boardConnData.userId, type: Highlight.MODENAME, payload: newMsg
            };
            socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
        };
        /** Handle receiving a new element of this component type, checking that the recieved element data is of the right type.
         *
         *  @param {UserHighlightMessage} message - The message containing the element data.
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        ComponentClass.prototype.handleNew = function (message, id, socket, connection, boardConnData, my_sql_pool) {
            var _this = this;
            console.log('BOARD: Received highlight.');
            connection.commit(function (err) {
                if (err) {
                    console.log('BOARD: Error while performing new highlight query.' + err);
                    _this.dropElement(id, socket, my_sql_pool, boardConnData);
                    return connection.rollback(function () { console.error(err); connection.release(); });
                }
                var newMsg = {
                    header: null, payload: null, colour: _this.roomUserList[boardConnData.roomId][boardConnData.userId], userId: boardConnData.userId,
                    x: message.x, y: message.y, width: message.width, height: message.height
                };
                var msgCont = {
                    serverId: id, userId: boardConnData.userId, type: Highlight.MODENAME, payload: newMsg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                return connection.release();
            });
        };
        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.handleElementMessage = function (message, serverId, socket, connection, boardConnData) {
            connection.release();
        };
        /** Handle users requesting information for an unknown element of this component type.
         *
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.handleUnknownMessage = function (serverId, socket, connection, boardConnData) {
            connection.release();
        };
        /** Handle any necessary data handling on a user disconnect (connection need not be cleaned yet, will wait 5 sec for reconnection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.handleDisconnect = function (boardConnData, my_sql_pool) {
        };
        /** Handle any necessary data handling on a user reconnect (connection has not been cleaned).
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         */
        ComponentClass.prototype.handleReconnect = function (boardConnData, socket, my_sql_pool) {
        };
        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        ComponentClass.prototype.handleClean = function (boardConnData, socket, my_sql_pool) {
            _super.prototype.handleClean.call(this, boardConnData, socket, my_sql_pool);
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
                    connection.query('UPDATE Whiteboard_Space SET isDeleted = ? WHERE User_ID = ? AND Room_Id = ? AND Type = ?', [true, boardConnData.userId, boardConnData.roomId, Highlight.MODENAME], function (err, rows) {
                        if (err) {
                            console.log('BOARD: Error while performing new remote file query.' + err);
                            return connection.release();
                        }
                        return connection.release();
                    });
                });
            });
        };
        return ComponentClass;
    }(ComponentBase.Component));
    Highlight.ComponentClass = ComponentClass;
})(Highlight || (Highlight = {}));
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = function (registerComponent) {
    registerComponent(Highlight.MODENAME, Highlight.ComponentClass);
};
