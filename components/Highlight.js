"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var ComponentBase = require("../ComponentBase");
var Highlight;
(function (Highlight) {
    Highlight.MODENAME = 'HIGHLIGHT';
    var MessageTypes = {};
    var ComponentClass = (function (_super) {
        __extends(ComponentClass, _super);
        function ComponentClass() {
            var _this = _super.apply(this, arguments) || this;
            _this.componentData = [];
            return _this;
        }
        ComponentClass.prototype.userJoin = function (socket, boardConnData) {
        };
        ComponentClass.prototype.sessionEnd = function (boardConnData) {
        };
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
        ComponentClass.prototype.handleElementMessage = function (message, serverId, socket, connection, boardConnData) {
            connection.release();
        };
        ComponentClass.prototype.handleUnknownMessage = function (serverId, socket, connection, boardConnData) {
            connection.release();
        };
        ComponentClass.prototype.handleDisconnect = function (boardConnData, my_sql_pool) {
        };
        ComponentClass.prototype.handleReconnect = function (boardConnData, socket, my_sql_pool) {
        };
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
module.exports = function (registerComponent) {
    registerComponent(Highlight.MODENAME, Highlight.ComponentClass);
};
