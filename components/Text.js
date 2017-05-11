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
/** Text Component.
*
* This allows the user to write text that will be rendered as SVG text.
*
*/
var TextBox;
(function (TextBox) {
    /**
     * The name of the mode associated with this component.
     */
    TextBox.MODENAME = 'TEXT';
    var typeCheck = require('check-types');
    /**
     * Message types that can be sent ebtween the user and server.
     */
    var MessageTypes = {
        NODE: 1,
        MISSED: 2,
        JUSTIFY: 3,
        EDIT: 4,
        COMPLETE: 5,
        DROPPED: 6,
        IGNORE: 7,
        SIZECHANGE: 8
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
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.userJoin = function (socket, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            if (userData == undefined || userData == null) {
                userData = {
                    editCounts: [], edits: [], incompleteEdits: []
                };
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
                userData.editCounts = null;
                userData.edits = null;
                userData.incompleteEdits = null;
            }
            userData = null;
        };
        ComponentClass.prototype.sendNode = function (serverId, editId, nodeData, socket, boardConnData) {
            var nodeCont = {
                seq_num: nodeData.seq_num, start: nodeData.start, end: nodeData.end, text: nodeData.text,
                weight: nodeData.weight, colour: nodeData.colour, style: nodeData.style, oline: nodeData.oline,
                uline: nodeData.uline, tline: nodeData.tline
            };
            var textMsg = {
                editId: editId,
                userId: boardConnData.userId,
                node: nodeCont
            };
            var nodeMsg = {
                header: MessageTypes.NODE, payload: textMsg
            };
            var msgCont = {
                serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: nodeMsg
            };
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
            connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, rows, fields) {
                if (err) {
                    console.log("Error getting text data. " + err);
                    connection.release();
                    return;
                }
                if (rows == undefined || rows[0] == undefined) {
                    console.log("BAD TEXT DATA");
                    connection.release();
                    return;
                }
                connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, prows, pfields) {
                    if (err) {
                        console.log('BOARD: Error while performing existing style node query. ' + err);
                        connection.release();
                        return;
                    }
                    var styles = [];
                    for (var i = 0; i < prows.length; i++) {
                        var nodeCont = {
                            seq_num: prows[i].Seq_Num, start: prows[i].Start, end: prows[i].End, text: prows[i].Text_Data,
                            weight: prows[i].Weight, colour: prows[i].Colour, style: prows[i].Style, oline: prows[i].isOverline,
                            uline: prows[i].isUnderline, tline: prows[i].isThroughline
                        };
                        styles.push(nodeCont);
                    }
                    var textMsg = {
                        header: null, payload: null, num_styles: rows[0].Num_Style_Nodes, userId: elemData.User_ID,
                        size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height,
                        editTime: elemData.Edit_Time, nodes: styles, justified: rows[0].Justified, editLock: elemData.Edit_Lock,
                        editCount: elemData.Edit_Count
                    };
                    var msgCont = {
                        serverId: elemData.Entry_ID, userId: boardConnData.userId, type: TextBox.MODENAME, payload: textMsg
                    };
                    socket.emit('NEW-ELEMENT', msgCont);
                    connection.release();
                });
            });
        };
        /** Handle receiving a new element of this component type, checking that the recieved element data is of the right type.
         *
         *  @param {UserNewTextMessage} message - The message containing the element data.
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        ComponentClass.prototype.handleNew = function (message, id, socket, connection, boardConnData, my_sql_pool) {
            console.log('BOARD: Received element of type: ' + TextBox.MODENAME);
            if (typeCheck.number(message.size)) {
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
                case MessageTypes.NODE:
                    this.handleNodeMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.MISSED:
                    this.handleMissingMessage(message.payload, serverId, socket, connection, boardConnData);
                case MessageTypes.EDIT:
                    this.handleEditMessage(message.payload, serverId, socket, connection, my_sql_pool, boardConnData);
                    break;
                case MessageTypes.JUSTIFY:
                    this.handleJustifyMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.SIZECHANGE:
                    this.handleSizeMessage(message.payload, serverId, socket, connection, boardConnData);
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
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        ComponentClass.prototype.handleUnknownMessage = function (serverId, socket, connection, boardConnData) {
            /* TODO: Remove debugging code. */
            console.log('Recieved UNKNOWN message for element: ' + serverId);
            var self = this;
            // Send client curve data if available, client may then request missing points.
            connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [serverId, boardConnData.roomId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing text query.' + err);
                    connection.release();
                    return;
                }
                if (rows == undefined || rows == null || rows[0] == undefined || rows[0] == null) {
                    console.log('Element not found.');
                    connection.release();
                    return;
                }
                var elemData = rows[0];
                connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, rows, fields) {
                    if (err) {
                        console.log('BOARD: Error while performing text query.' + err);
                        connection.release();
                        return;
                    }
                    if (rows == undefined || rows == null || rows[0] == undefined || rows[0] == null) {
                        connection.release();
                        return;
                    }
                    connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, prows, pfields) {
                        if (err) {
                            console.log('BOARD: Error while performing existing style node query. ' + err);
                            connection.release();
                            return;
                        }
                        var styles = [];
                        for (var i = 0; i < prows.length; i++) {
                            var nodeCont = {
                                seq_num: prows[i].Seq_Num, start: prows[i].Start, end: prows[i].End, text: prows[i].Text_Data,
                                weight: prows[i].Weight, colour: prows[i].Colour, style: prows[i].Style, oline: prows[i].isOverline,
                                uline: prows[i].isUnderline, tline: prows[i].isThroughline
                            };
                            styles.push(nodeCont);
                        }
                        var textMsg = {
                            header: null, payload: null, num_styles: rows[0].Num_Style_Nodes, userId: elemData.User_ID,
                            size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height,
                            editTime: elemData.Edit_Time, nodes: styles, justified: rows[0].Justified, editLock: elemData.Edit_Lock,
                            editCount: elemData.Edit_Count
                        };
                        var msgCont = {
                            serverId: elemData.Entry_ID, userId: boardConnData.userId, type: TextBox.MODENAME, payload: textMsg
                        };
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
            for (var i = 0; i < userData.incompleteEdits.length; i++) {
                var edit = userData.edits[userData.incompleteEdits[i].textId][userData.incompleteEdits[i].editId];
                /* TODO: Remove debugging code. */
                console.log('Cleared interval after disconnect.');
                // Stop requesting missing points while disconnected
                clearInterval(edit.nodeTimeout);
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
            var _loop_1 = function (i) {
                var edit = userData.edits[userData.incompleteEdits[i].textId][userData.incompleteEdits[i].editId];
                /* TODO: Remove debugging code. */
                console.log('Re-added timeout after reconnect.');
                // Re-establish the timeouts upon reconnection.
                edit.nodeTimeout = setInterval(function (id) { self.missedNodes(userData.incompleteEdits[i].textId, userData.incompleteEdits[i].editId, socket, my_sql_pool, boardConnData); }, 1000, edit);
            };
            for (var i = 0; i < userData.incompleteEdits.length; i++) {
                _loop_1(i);
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
            for (var i = 0; i < userData.incompleteEdits.length; i++) {
                var edit = userData.edits[userData.incompleteEdits[i].textId][userData.incompleteEdits[i].editId];
                /* TODO: Remove debugging code. */
                console.log('Cleared interval after disconnect.');
                // Stop requesting missing points while disconnected
                clearInterval(edit.nodeTimeout);
            }
            userData.incompleteEdits = [];
        };
        ComponentClass.prototype.addNew = function (message, id, socket, connection, boardConnData, my_sql_pool) {
            var _this = this;
            var userMessage;
            var broadcastMessage;
            var userData = this.componentData[boardConnData.userId];
            var self = this;
            userData.edits[id] = [];
            userData.editCounts[id] = 0;
            connection.query('INSERT INTO ' +
                'Text_Space(Entry_ID, Num_Style_Nodes, Size, Justified) VALUES(?, ?, ?, ?)', [id, 0, message.size, message.justified], function (err) {
                if (err) {
                    console.log('BOARD: Error while performing new text query.' + err);
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
                    console.log('BOARD: Sending text ID: ' + id);
                    var textMsg = {
                        header: null, payload: null, num_styles: 0, userId: boardConnData.userId,
                        size: message.size, x: message.x, y: message.y, width: message.width, height: message.height,
                        editTime: new Date(), nodes: null, justified: message.justified, editLock: boardConnData.userId,
                        editCount: 0
                    };
                    var msgCont = {
                        serverId: id, userId: boardConnData.userId, type: TextBox.MODENAME, payload: textMsg
                    };
                    socket.emit('NEW-ELEMENT', msgCont);
                    connection.release();
                });
            });
        };
        ComponentClass.prototype.handleSizeMessage = function (message, serverId, socket, connection, boardConnData) {
            connection.query('UPDATE Text_Space SET Size = ? WHERE Entry_ID = ?', [message.newSize, serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while updating textbox size. ' + err);
                    connection.release();
                    return;
                }
                /* TODO: This message sending stuff should really be in its own function, i.e. emit() and broadcast() */
                var payload = { newSize: message.newSize };
                var sizeMsg = { header: MessageTypes.SIZECHANGE, payload: payload };
                var sizeCont = {
                    serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: sizeMsg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', sizeCont);
                connection.release();
            });
        };
        ComponentClass.prototype.handleEditMessage = function (message, serverId, socket, connection, my_sql_pool, boardConnData) {
            var missingNodes = [];
            var numOK = 0;
            var received = [];
            var cleanNodes = [];
            var userData = this.componentData[boardConnData.userId];
            var self = this;
            if (userData.edits[serverId] != null && userData.edits[serverId] != undefined) {
                if (typeCheck.integer(message.num_styles) && typeCheck.integer(message.bufferId)) {
                    var editData = {
                        textId: serverId, numNodes: message.num_styles, recievedNodes: [], cleanedNodes: [], nodeRetries: 0, nodeTimeout: null, numRecieved: 0,
                        localId: message.bufferId
                    };
                    var editId = ++userData.editCounts[serverId];
                    userData.edits[serverId][editId] = editData;
                    for (var i = 0; i < message.nodes.length; i++) {
                        if (typeCheck.integer(message.nodes[i].seq_num) && typeCheck.string(message.nodes[i].colour)
                            && typeCheck.string(message.nodes[i].text) && typeCheck.boolean(message.nodes[i].uline)
                            && typeCheck.boolean(message.nodes[i].oline) && typeCheck.boolean(message.nodes[i].tline)
                            && typeCheck.string(message.nodes[i].weight) && typeCheck.string(message.nodes[i].style)) {
                            if (message.nodes[i].seq_num >= 0 && message.nodes[i].seq_num < message.num_styles) {
                                numOK++;
                                received[message.nodes[i].seq_num] = true;
                                cleanNodes[message.nodes[i].seq_num] = message.nodes[i];
                            }
                        }
                    }
                    editData.cleanedNodes = cleanNodes.slice();
                    if (cleanNodes.length < message.num_styles) {
                        // Set a 0.5 sec timeout to inform the client of missing points.
                        editData.nodeTimeout = setInterval(self.missedNodes.bind(self), 500, serverId, editId, socket, my_sql_pool, boardConnData);
                        editData.numRecieved = numOK;
                        editData.recievedNodes = received.slice();
                        userData.incompleteEdits.push({ textId: serverId, editId: editId });
                    }
                    else {
                        this.comleteEdit(serverId, editId, socket, connection, boardConnData);
                    }
                }
                else {
                    // DROP EDIT
                    var dropPayload = { editId: null, bufferId: message.bufferId };
                    var droppedMsg = { header: MessageTypes.DROPPED, payload: dropPayload };
                    var droppedCont = {
                        serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: droppedMsg
                    };
                    socket.emit('MSG-COMPONENT', droppedCont);
                }
            }
        };
        ComponentClass.prototype.comleteEdit = function (serverId, editId, socket, connection, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            var editData = userData.edits[serverId][editId];
            var nodeInserts = [];
            for (var i = 0; i < editData.numNodes; i++) {
                var node = editData.cleanedNodes[i];
                var insertData = [
                    serverId, node.seq_num, node.colour, node.oline, node.uline, node.tline, node.weight, node.style, node.start, node.end, node.text
                ];
                nodeInserts.push(insertData);
            }
            clearTimeout(userData.edits[serverId][editId].nodeTimeout);
            console.log("Completing text edit...");
            connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing remove old nodes query. ' + err);
                    return connection.rollback(function () { console.error(err); connection.release(); });
                }
                connection.query('INSERT INTO Text_Style_Node(Entry_ID, Seq_Num, Colour, isOverline, isUnderline, isThroughline, Weight, Style, Start, End, Text_Data) VALUES ?', [nodeInserts], function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing style node query. ' + err);
                        var dropPayload = { editId: null, bufferId: editData.localId };
                        var droppedMsg = { header: MessageTypes.DROPPED, payload: dropPayload };
                        var droppedCont = {
                            serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: droppedMsg
                        };
                        socket.emit('MSG-COMPONENT', droppedCont);
                        return connection.rollback(function () { console.error(err); connection.release(); });
                    }
                    console.log("Committing text edit...");
                    connection.commit(function (err) {
                        if (err) {
                            console.log('BOARD: Error while performing style node query. ' + err);
                            var dropPayload = { editId: null, bufferId: editData.localId };
                            var droppedMsg = { header: MessageTypes.DROPPED, payload: dropPayload };
                            var droppedCont = {
                                serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: droppedMsg
                            };
                            socket.emit('MSG-COMPONENT', droppedCont);
                            return connection.rollback(function () { console.error(err); connection.release(); });
                        }
                        var editPayload = {
                            userId: boardConnData.userId, num_styles: editData.numNodes, editId: editId,
                            styles: editData.cleanedNodes, editTime: new Date()
                        };
                        var editMsg = {
                            header: MessageTypes.EDIT, payload: editPayload
                        };
                        var msgCont = {
                            serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: editMsg
                        };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                        connection.release();
                    });
                });
            });
        };
        //Listens for points as part of a curve, must recive a funn let from the initiation.
        ComponentClass.prototype.handleNodeMessage = function (message, serverId, socket, connection, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            if (userData.edits[serverId] != null && userData.edits[serverId] != undefined) {
                var editData = userData.edits[serverId][message.editId];
                if (typeCheck.integer(message.node.seq_num) && typeCheck.string(message.node.colour) && typeCheck.string(message.node.text) &&
                    typeCheck.boolean(message.node.uline) && typeCheck.boolean(message.node.oline) && typeCheck.boolean(message.node.tline) &&
                    typeCheck.string(message.node.weight) && typeCheck.string(message.node.style && editData != null && editData != undefined)) {
                    if (message.node.seq_num >= 0 && message.node.seq_num < editData.numNodes && !editData.recievedNodes[message.node.seq_num]) {
                        editData.numRecieved++;
                        editData.recievedNodes[message.node.seq_num] = true;
                        editData.cleanedNodes[message.node.seq_num] = message.node;
                        if (editData.numRecieved == editData.numNodes) {
                            this.comleteEdit(serverId, message.editId, socket, connection, boardConnData);
                        }
                    }
                }
            }
        };
        ComponentClass.prototype.handleJustifyMessage = function (message, serverId, socket, connection, boardConnData) {
            connection.query('UPDATE Text_Space SET Justified = ? WHERE Entry_ID = ?', [message.newState, serverId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while updating textbox justify state. ' + err);
                    connection.release();
                    return;
                }
                /* TODO: This message sending stuff should really be in its own function, i.e. emit() and broadcast() */
                var payload = { newState: message.newState };
                var justifyMsg = { header: MessageTypes.JUSTIFY, payload: payload };
                var justifyCont = {
                    serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: justifyMsg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', justifyCont);
                connection.release();
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
        ComponentClass.prototype.dropElement = function (id, socket, my_sql_pool, boardConnData) {
            _super.prototype.dropElement.call(this, id, socket, my_sql_pool, boardConnData);
            var userData = this.componentData[boardConnData.userId];
            userData.edits[id] = null;
            userData.incompleteEdits[id] = null;
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    connection.release();
                    return;
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        connection.release();
                        return;
                    }
                    connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [id], function (err, result) {
                        if (err) {
                            console.log('BOARD: Error while removing badly formed curve. ' + err);
                            connection.release();
                            return;
                        }
                        connection.query('DELETE FROM Text_Space WHERE Entry_ID = ?', [id], function (err, result) {
                            if (err) {
                                console.log('BOARD: Error while removing badly formed curve. ' + err);
                                connection.release();
                                return;
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
        ComponentClass.prototype.missedNodes = function (serverId, editId, socket, my_sql_pool, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            var editData = userData.edits[serverId][editId];
            editData.nodeRetries++;
            console.log("Trying to get missing node for elemId: " + serverId + " editId: " + editId);
            for (var i = 0; i < editData.numNodes; i++) {
                if (!editData.recievedNodes[i]) {
                    if (editData.nodeRetries > 10 || boardConnData.cleanUp) {
                        clearInterval(editData.nodeTimeout);
                        editData.recievedNodes = [];
                        editData.cleanedNodes = [];
                        console.log("Dropped edit.");
                        var payload = { editId: editId, bufferId: editData.localId };
                        var droppedMsg = { header: MessageTypes.DROPPED, payload: payload };
                        var droppedCont = {
                            serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: droppedMsg
                        };
                        socket.emit('MSG-COMPONENT', droppedCont);
                        return;
                    }
                }
                else {
                    if (boardConnData.isConnected) {
                        var payload = { editId: editId, num: i };
                        var missedMsg = { header: MessageTypes.MISSED, payload: payload };
                        var missedCont = {
                            serverId: serverId, userId: boardConnData.userId, type: TextBox.MODENAME, payload: missedMsg
                        };
                        socket.emit('MSG-COMPONENT', missedCont);
                    }
                }
            }
        };
        ComponentClass.prototype.handleMissingMessage = function (message, serverId, socket, connection, boardConnData) {
            console.log('BOARD: Received missing message.');
            var node = this.componentData[message.userId].edits[serverId][message.editId].cleanedNodes[message.seq_num];
            this.sendNode(serverId, message.editId, node, socket, boardConnData);
        };
        return ComponentClass;
    }(ComponentBase.Component));
    TextBox.ComponentClass = ComponentClass;
})(TextBox || (TextBox = {}));
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = function (registerComponent) {
    registerComponent(TextBox.MODENAME, TextBox.ComponentClass);
};
