import ComponentBase = require("../ComponentBase");

/** Text Component.
*
* This allows the user to write text that will be rendered as SVG text.
*
*/
namespace TextBox {
    /**
     * The name of the mode associated with this component.
     */
    export const MODENAME = 'TEXT';

    let typeCheck = require('check-types');

    interface Style {
        weight: string;
        style: string;
        colour: string;
        oline: boolean;
        uline: boolean;
        tline: boolean;
    }
    interface TextStyle extends Style {
        start: number;
        end: number;
        text: string;
        seq_num: number;
    }



    interface ServerNewTextPayload extends ServerMessage {
        x: number;
        y: number;
        width: number;
        height: number;
        justified: boolean;
        editCount: number;
        userId: number;
        size: number;
        editLock: number;
        editTime: Date;
        num_styles: number;
        nodes: Array<NodeContainer>;
    }
    interface ServerStyleNodeMessage extends ServerMessagePayload {
        editId: number;
        userId: number;
        node: TextStyle;
    }
    interface ServerMissedMessage extends ServerMessagePayload {
        editId: number;
        num: number;
    }
    interface ServerResizeMessage extends ServerMessagePayload {
        width: number;
        height: number;
        editTime: Date;
    }
    interface ServerJustifyMessage extends ServerMessagePayload {
        newState: boolean;
    }
    interface ServerEditMessage extends ServerMessagePayload {
        userId: number;
        editId: number;
        num_styles: number;
        styles: Array<TextStyle>;
        editTime: Date;
    }
    interface ServerEditIdMessage extends ServerMessagePayload {
        editId: number;
        bufferId: number;
        localId: number;
    }
    interface ServerLockIdMessage extends ServerMessagePayload {

    }
    interface ServerLockMessage extends ServerMessagePayload {
        userId: number;
    }
    interface ServerChangeSizeMessage extends ServerMessagePayload {
        newSize: number;
    }
    interface ServerDroppedMessage extends ServerMessagePayload {
        editId: number;
        bufferId: number;
    }

    interface NodeContainer extends Style {
        seq_num: number;
        start: number;
        end: number;
        text: string;
    }

    interface UserNewTextMessage extends UserNewElementPayload {
        size: number;
        justified: boolean;
    }
    interface UserEditMessage extends UserMessagePayload {
        bufferId: number;
        num_styles: number;
        nodes: Array<TextStyle>;
    }
    interface UserNodeMessage extends UserMessagePayload {
        editId: number;
        node: TextStyle;
    }
    interface UserJustifyMessage extends UserMessagePayload {
        newState: boolean;
    }
    interface UserResizeMessage extends UserMessagePayload {
        width: number;
        height: number;
    }
    interface UserMissingNodeMessage extends UserMessagePayload {
        editId: number;
        userId: number;
        seq_num: number;
    }
    interface UserChangeSizeMessage extends UserMessagePayload {
        newSize: number;
    }

    interface ComponentData {
        edits: Array<Array<EditData>>;
        editCounts: Array<number>;
        incompleteEdits: Array<{textId: number, editId: number}>;
    }

    interface EditData {
        textId: number;
        localId: number;
        numNodes: number;
        numRecieved: number;
        cleanedNodes: Array<TextStyle>;
        recievedNodes: Array<boolean>;
        nodeTimeout: any;
        nodeRetries: number;
    }


    /*SQL Tables */
    interface SQLTextData {
        Entry_ID: number;
        Num_Style_Nodes: number;
        Size: number;
        Justified: boolean;
    }
    interface SQLNodeData {
        Entry_ID: number;
        Seq_Num: number;
        Text_Data: string;
        Colour: string;
        Weight: string;
        Style: string;
        isOverline: boolean;
        isUnderline: boolean;
        isThroughline: boolean;
        Start: number;
        End: number;
    }

    /**
     * Message types that can be sent ebtween the user and server.
     */
    const MessageTypes = {
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
    export class ComponentClass extends ComponentBase.Component
    {
        componentData: Array<ComponentData> = [];

        /** Initialize the buffers for this component and socket.
         *
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public userJoin(socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            let userData: ComponentData = this.componentData[boardConnData.userId];

            if(userData == undefined || userData == null)
            {
                userData = {
                    editCounts: [], edits: [], incompleteEdits: []
                };
                this.componentData[boardConnData.userId] = userData;
            }
        }

        /** Remove all data for this connection associated with this component.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public sessionEnd(boardConnData: BoardConnection)
        {
            let userData: ComponentData = this.componentData[boardConnData.userId];

            if(userData != undefined && userData != null)
            {
                userData.editCounts = null;
                userData.edits = null;
                userData.incompleteEdits = null;
            }

            userData = null;
        }

        private sendNode(serverId: number, editId: number, nodeData: TextStyle, socket: SocketIO.Socket, boardConnData: BoardConnection)
        {
            let nodeCont: NodeContainer =
            {
                seq_num: nodeData.seq_num, start: nodeData.start, end: nodeData.end, text: nodeData.text,
                weight: nodeData.weight, colour: nodeData.colour, style: nodeData.style, oline: nodeData.oline,
                uline: nodeData.uline, tline: nodeData.tline
            };

            let textMsg: ServerStyleNodeMessage = {
                editId: editId,
                userId: boardConnData.userId,
                node: nodeCont
            };
            let nodeMsg: ServerMessage =
            {
                header: MessageTypes.NODE, payload: textMsg
            };
            let msgCont: ServerMessageContainer =
            {
                serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: nodeMsg
            };

            socket.emit('MSG-COMPONENT', msgCont);
        }

        /** Handle the initial sending of this element data to the user.
         *
         *  @param {SQLElementData} elemData - The basic data about this element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public sendData(elemData: ComponentBase.SQLElementData, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?',
            [elemData.Entry_ID],
            function(err, rows: Array<SQLTextData>, fields)
            {
                if(err)
                {
                    console.log("Error getting text data. " + err);
                    connection.release();
                    return;
                }

                if(rows == undefined || rows[0] == undefined)
                {
                    console.log("BAD TEXT DATA");
                    connection.release();
                    return;
                }

                connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?', [elemData.Entry_ID], (err, prows: Array<SQLNodeData>, pfields) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing existing style node query. ' + err);
                        connection.release();
                        return;
                    }

                    let styles: Array<NodeContainer> = [];

                    for(let i = 0; i < prows.length; i++)
                    {
                        let nodeCont: NodeContainer =
                        {
                            seq_num: prows[i].Seq_Num, start: prows[i].Start, end: prows[i].End, text: prows[i].Text_Data,
                            weight: prows[i].Weight, colour: prows[i].Colour, style: prows[i].Style, oline: prows[i].isOverline,
                            uline: prows[i].isUnderline, tline: prows[i].isThroughline
                        };

                        styles.push(nodeCont);
                    }

                    let textMsg: ServerNewTextPayload = {
                        header: null, payload: null, num_styles: rows[0].Num_Style_Nodes, userId: elemData.User_ID,
                        size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height,
                        editTime: elemData.Edit_Time, nodes: styles, justified: rows[0].Justified, editLock: elemData.Edit_Lock,
                        editCount: elemData.Edit_Count
                    };
                    let msgCont: ServerMessageContainer =
                    {
                        serverId: elemData.Entry_ID, userId: boardConnData.userId, type: MODENAME, payload: textMsg
                    };

                    socket.emit('NEW-ELEMENT', msgCont);
                    connection.release();
                });
            });

        }

        /** Handle receiving a new element of this component type, checking that the recieved element data is of the right type.
         *
         *  @param {UserNewTextMessage} message - The message containing the element data.
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        public handleNew(message: UserNewTextMessage, id: number, socket: SocketIO.Socket, connection: MySql.SQLConnection,
                         boardConnData: BoardConnection, my_sql_pool: MySql.Pool)
        {
            console.log('BOARD: Received element of type: ' + MODENAME);
            if(typeCheck.number(message.size))
            {
                this.addNew(message, id, socket, connection, boardConnData, my_sql_pool);
            }
            else
            {
                return connection.rollback(() => { connection.release(); });
            }
        }

        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        public handleElementMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection,
                                    boardConnData: BoardConnection, my_sql_pool: MySql.Pool)
        {
            let type = message.header;

            switch(type)
            {
                case MessageTypes.NODE:
                    this.handleNodeMessage(message.payload as UserNodeMessage, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.MISSED:
                    this.handleMissingMessage(message.payload as UserMissingNodeMessage, serverId, socket, connection, boardConnData);
                case MessageTypes.EDIT:
                    this.handleEditMessage(message.payload as UserEditMessage, serverId, socket, connection, my_sql_pool, boardConnData);
                    break;
                case MessageTypes.JUSTIFY:
                    this.handleJustifyMessage(message.payload as UserJustifyMessage, serverId, socket, connection, boardConnData);
                    break;
                case MessageTypes.SIZECHANGE:
                    this.handleSizeMessage(message.payload as UserChangeSizeMessage, serverId, socket, connection, boardConnData);
                    break;
                default:
                    console.log('Unknown message type recieved.');
                    connection.release();
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
            /* TODO: Remove debugging code. */
            console.log('Recieved UNKNOWN message for element: ' + serverId);

            let self = this;
            // Send client curve data if available, client may then request missing points.
            connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [serverId, boardConnData.roomId],
            (err, rows: Array<ComponentBase.SQLElementData>, fields) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while performing text query.' + err);
                    connection.release();
                    return;
                }

                if(rows == undefined || rows == null || rows[0] == undefined || rows[0] == null)
                {
                    console.log('Element not found.');
                    connection.release();
                    return;
                }


                let elemData = rows[0];
                connection.query('SELECT * FROM Text_Space WHERE Entry_ID = ?', [elemData.Entry_ID], (err, rows: Array<SQLTextData>, fields) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing text query.' + err);
                        connection.release();
                        return;
                    }

                    if(rows == undefined || rows == null || rows[0] == undefined || rows[0] == null)
                    {
                        connection.release();
                        return;
                    }

                    connection.query('SELECT * FROM Text_Style_Node WHERE Entry_ID = ?',
                    [elemData.Entry_ID],
                    (err, prows: Array<SQLNodeData>, pfields) =>
                    {
                        if (err)
                        {
                            console.log('BOARD: Error while performing existing style node query. ' + err);
                            connection.release();
                            return;
                        }

                        let styles: Array<NodeContainer> = [];

                        for(let i = 0; i < prows.length; i++)
                        {
                            let nodeCont: NodeContainer =
                            {
                                seq_num: prows[i].Seq_Num, start: prows[i].Start, end: prows[i].End, text: prows[i].Text_Data,
                                weight: prows[i].Weight, colour: prows[i].Colour, style: prows[i].Style, oline: prows[i].isOverline,
                                uline: prows[i].isUnderline, tline: prows[i].isThroughline
                            };

                            styles.push(nodeCont);
                        }

                        let textMsg: ServerNewTextPayload = {
                            header: null, payload: null, num_styles: rows[0].Num_Style_Nodes, userId: elemData.User_ID,
                            size: rows[0].Size, x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height,
                            editTime: elemData.Edit_Time, nodes: styles, justified: rows[0].Justified, editLock: elemData.Edit_Lock,
                            editCount: elemData.Edit_Count
                        };
                        let msgCont: ServerMessageContainer =
                        {
                            serverId: elemData.Entry_ID, userId: boardConnData.userId, type: MODENAME, payload: textMsg
                        };

                        socket.emit('NEW-ELEMENT', msgCont);

                        connection.release();
                    });
                });
            });
        }

        /** Handle any necessary data handling on a user disconnect (connection need not be cleaned yet, will wait 5 sec for reconnection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleDisconnect(boardConnData: BoardConnection, my_sql_pool: MySql.Pool)
        {
            let userData = this.componentData[boardConnData.userId];

            for(let i = 0; i < userData.incompleteEdits.length; i++)
            {
                let edit = userData.edits[userData.incompleteEdits[i].textId][userData.incompleteEdits[i].editId];

                /* TODO: Remove debugging code. */
                console.log('Cleared interval after disconnect.');
                // Stop requesting missing points while disconnected
                clearInterval(edit.nodeTimeout);
            }
        }

        /** Handle any necessary data handling on a user reconnect (connection has not been cleaned).
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         */
        public handleReconnect(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool: MySql.Pool)
        {
            let userData = this.componentData[boardConnData.userId];
            let self = this;

            for(let i = 0; i < userData.incompleteEdits.length; i++)
            {
                let edit = userData.edits[userData.incompleteEdits[i].textId][userData.incompleteEdits[i].editId];

                /* TODO: Remove debugging code. */
                console.log('Re-added timeout after reconnect.');
                // Re-establish the timeouts upon reconnection.
                edit.nodeTimeout = setInterval((id) => { self.missedNodes(userData.incompleteEdits[i].textId, userData.incompleteEdits[i].editId, socket, my_sql_pool, boardConnData); }, 1000, edit);
            }
        }

        /** Handle any necessary data cleanup for lost or ended user connection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        public handleClean(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool: MySql.Pool)
        {
            super.handleClean(boardConnData, socket, my_sql_pool);

            let userData = this.componentData[boardConnData.userId];

            for(let i = 0; i < userData.incompleteEdits.length; i++)
            {
                let edit = userData.edits[userData.incompleteEdits[i].textId][userData.incompleteEdits[i].editId];

                /* TODO: Remove debugging code. */
                console.log('Cleared interval after disconnect.');
                // Stop requesting missing points while disconnected
                clearInterval(edit.nodeTimeout);
            }

            userData.incompleteEdits = [];
        }

        private addNew(message: UserNewTextMessage, id: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection, my_sql_pool)
        {
            let userMessage;
            let broadcastMessage;
            let userData = this.componentData[boardConnData.userId];
            let self = this;

            userData.edits[id] = [];
            userData.editCounts[id] = 0;

            connection.query('INSERT INTO ' +
            'Text_Space(Entry_ID, Num_Style_Nodes, Size, Justified) VALUES(?, ?, ?, ?)',
            [id, 0, message.size, message.justified],
            (err) =>
            {
                if (err)
                {
                    console.log('BOARD: Error while performing new text query.' + err);
                    this.dropElement(id, socket, my_sql_pool, boardConnData);
                    return connection.rollback(() => { console.error(err); connection.release(); });
                }

                connection.commit((err) =>
                {
                    if(err)
                    {
                        console.log('BOARD: Error while performing new curve query.' + err);
                        this.dropElement(id, socket, my_sql_pool, boardConnData);
                        return connection.rollback(() => { console.error(err); connection.release(); });
                    }

                    let idMsg : ServerIdMessage = { serverId: id, localId: message.localId };
                    // Tell the user the ID to assign points to.
                    socket.emit('ELEMENT-ID', idMsg);

                    console.log('BOARD: Sending text ID: ' + id);

                    let textMsg: ServerNewTextPayload = {
                        header: null, payload: null, num_styles: 0, userId: boardConnData.userId,
                        size: message.size, x: message.x, y: message.y, width: message.width, height: message.height,
                        editTime: new Date(), nodes: null, justified: message.justified, editLock: boardConnData.userId,
                        editCount: 0
                    };
                    let msgCont: ServerMessageContainer =
                    {
                        serverId: id, userId: boardConnData.userId, type: MODENAME, payload: textMsg
                    };

                    socket.emit('NEW-ELEMENT', msgCont);
                    connection.release();
                });
            });
        }

        private handleSizeMessage(message: UserChangeSizeMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            connection.query('UPDATE Text_Space SET Size = ? WHERE Entry_ID = ?', [message.newSize, serverId], function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while updating textbox size. ' + err);
                    connection.release();
                    return;
                }

                /* TODO: This message sending stuff should really be in its own function, i.e. emit() and broadcast() */
                let payload: ServerChangeSizeMessage = { newSize: message.newSize };
                let sizeMsg : ServerMessage = { header: MessageTypes.SIZECHANGE, payload: payload };
                let sizeCont: ServerMessageContainer =
                {
                    serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: sizeMsg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', sizeCont);

                connection.release();
            });
        }

        private handleEditMessage(message: UserEditMessage, serverId: number, socket: SocketIO.Socket, connection, my_sql_pool, boardConnData: BoardConnection)
        {
            let missingNodes = [];
            let numOK = 0;
            let received = [];
            let cleanNodes = [];

            let userData = this.componentData[boardConnData.userId];

            let self = this;
            if(userData.edits[serverId] != null && userData.edits[serverId] != undefined)
            {
                if(typeCheck.integer(message.num_styles) && typeCheck.integer(message.bufferId))
                {
                    let editData: EditData =
                    {
                        textId: serverId, numNodes: message.num_styles, recievedNodes: [], cleanedNodes: [], nodeRetries: 0, nodeTimeout: null, numRecieved: 0,
                        localId: message.bufferId
                    };

                    let editId = ++userData.editCounts[serverId];
                    userData.edits[serverId][editId] = editData;

                    for(let i = 0; i < message.nodes.length; i++)
                    {
                        if(typeCheck.integer(message.nodes[i].seq_num) && typeCheck.string(message.nodes[i].colour)
                            && typeCheck.string(message.nodes[i].text) && typeCheck.boolean(message.nodes[i].uline)
                            && typeCheck.boolean(message.nodes[i].oline) && typeCheck.boolean(message.nodes[i].tline)
                            && typeCheck.string(message.nodes[i].weight) && typeCheck.string(message.nodes[i].style))
                        {
                            if(message.nodes[i].seq_num >= 0 && message.nodes[i].seq_num < message.num_styles)
                            {
                                numOK++;
                                received[message.nodes[i].seq_num] = true;
                                cleanNodes[message.nodes[i].seq_num] = message.nodes[i];
                            }
                        }
                    }

                    editData.cleanedNodes = cleanNodes.slice();

                    if(cleanNodes.length < message.num_styles)
                    {
                        // Set a 0.5 sec timeout to inform the client of missing points.
                        editData.nodeTimeout = setInterval(self.missedNodes.bind(self), 500, serverId, editId, socket, my_sql_pool, boardConnData);
                        editData.numRecieved = numOK;
                        editData.recievedNodes = received.slice();
                        userData.incompleteEdits.push({ textId: serverId, editId: editId });
                    }
                    else
                    {
                        this.comleteEdit(serverId, editId, socket, connection, boardConnData);
                    }
                }
                else
                {
                    // DROP EDIT
                    let dropPayload: ServerDroppedMessage = { editId: null, bufferId: message.bufferId};
                    let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: dropPayload };
                    let droppedCont: ServerMessageContainer =
                    {
                        serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                    };
                    socket.emit('MSG-COMPONENT', droppedCont);
                }
            }
        }

        private comleteEdit(serverId: number, editId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            let userData: ComponentData = this.componentData[boardConnData.userId];
            let editData: EditData = userData.edits[serverId][editId];
            let nodeInserts = [];

            for(let i = 0; i < editData.numNodes; i++)
            {
                let node = editData.cleanedNodes[i];
                let insertData = [
                    serverId, node.seq_num, node.colour, node.oline, node.uline, node.tline, node.weight, node.style, node.start, node.end, node.text
                ];
                nodeInserts.push(insertData);
            }

            clearTimeout(userData.edits[serverId][editId].nodeTimeout);

            console.log("Completing text edit...");

            connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [serverId],
            function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while performing remove old nodes query. ' + err);
                    return connection.rollback(() => { console.error(err); connection.release(); });
                }

                connection.query(
                'INSERT INTO Text_Style_Node(Entry_ID, Seq_Num, Colour, isOverline, isUnderline, isThroughline, Weight, Style, Start, End, Text_Data) VALUES ?',
                [nodeInserts],
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing style node query. ' + err);

                        let dropPayload: ServerDroppedMessage = { editId: null, bufferId: editData.localId };
                        let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: dropPayload };
                        let droppedCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                        };
                        socket.emit('MSG-COMPONENT', droppedCont);

                        return connection.rollback(() => { console.error(err); connection.release(); });
                    }

                    console.log("Committing text edit...");
                    connection.commit((err) =>
                    {
                        if(err)
                        {
                            console.log('BOARD: Error while performing style node query. ' + err);

                            let dropPayload: ServerDroppedMessage = { editId: null, bufferId: editData.localId };
                            let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: dropPayload };
                            let droppedCont: ServerMessageContainer =
                            {
                                serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: droppedMsg
                            };
                            socket.emit('MSG-COMPONENT', droppedCont);

                            return connection.rollback(() => { console.error(err); connection.release(); });
                        }

                        let editPayload: ServerEditMessage =
                        {
                            userId: boardConnData.userId, num_styles: editData.numNodes, editId: editId,
                            styles: editData.cleanedNodes, editTime: new Date()
                        };
                        let editMsg: ServerMessage =
                        {
                            header: MessageTypes.EDIT, payload: editPayload
                        };

                        let msgCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: editMsg
                        };

                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                        connection.release();
                    });
                });
            });
        }

        //Listens for points as part of a curve, must recive a funn let from the initiation.
        private handleNodeMessage(message: UserNodeMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            let userData: ComponentData = this.componentData[boardConnData.userId];

            if(userData.edits[serverId] != null && userData.edits[serverId] != undefined)
            {
                let editData: EditData = userData.edits[serverId][message.editId];

                if(typeCheck.integer(message.node.seq_num) && typeCheck.string(message.node.colour) && typeCheck.string(message.node.text) &&
                   typeCheck.boolean(message.node.uline) && typeCheck.boolean(message.node.oline) && typeCheck.boolean(message.node.tline) &&
                   typeCheck.string(message.node.weight) && typeCheck.string(message.node.style && editData != null && editData != undefined))
                {
                    if(message.node.seq_num >= 0 && message.node.seq_num < editData.numNodes && !editData.recievedNodes[message.node.seq_num])
                    {
                        editData.numRecieved++;
                        editData.recievedNodes[message.node.seq_num] = true;
                        editData.cleanedNodes[message.node.seq_num] = message.node;

                        if(editData.numRecieved == editData.numNodes)
                        {
                            this.comleteEdit(serverId, message.editId, socket, connection, boardConnData);
                        }
                    }
                }
            }
        }

        private handleJustifyMessage(message: UserJustifyMessage, serverId: number, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
        {
            connection.query('UPDATE Text_Space SET Justified = ? WHERE Entry_ID = ?', [message.newState, serverId], function(err, rows, fields)
            {
                if (err)
                {
                    console.log('BOARD: Error while updating textbox justify state. ' + err);
                    connection.release();
                    return;
                }

                /* TODO: This message sending stuff should really be in its own function, i.e. emit() and broadcast() */
                let payload: ServerJustifyMessage = { newState: message.newState };
                let justifyMsg : ServerMessage = { header: MessageTypes.JUSTIFY, payload: payload };
                let justifyCont: ServerMessageContainer =
                {
                    serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: justifyMsg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', justifyCont);

                connection.release();
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
            super.dropElement(id, socket, my_sql_pool, boardConnData);

            let userData: ComponentData = this.componentData[boardConnData.userId];
            userData.edits[id] = null;
            userData.incompleteEdits[id] = null;

            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    connection.release();
                    return;
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        connection.release();
                        return;
                    }

                    connection.query('DELETE FROM Text_Style_Node WHERE Entry_ID = ?', [id], (err, result) =>
                    {
                        if(err)
                        {
                            console.log('BOARD: Error while removing badly formed curve. ' + err);
                            connection.release();
                            return;
                        }

                        connection.query('DELETE FROM Text_Space WHERE Entry_ID = ?', [id], (err, result) =>
                        {
                            if(err)
                            {
                                console.log('BOARD: Error while removing badly formed curve. ' + err);
                                connection.release();
                                return;
                            }

                            connection.query('DELETE FROM Whiteboard_Space WHERE Entry_ID = ?', [id], (err, result) =>
                            {
                                if(err)
                                {
                                    console.log('BOARD: Error while removing badly formed curve. ' + err);
                                }
                                connection.release();
                            });
                        });
                    });
                });
            });
        }

        private missedNodes(serverId: number, editId: number, socket: SocketIO.Socket, my_sql_pool: MySql.Pool, boardConnData: BoardConnection)
        {
            let userData: ComponentData = this.componentData[boardConnData.userId];
            let editData: EditData = userData.edits[serverId][editId];

            editData.nodeRetries++;

            console.log("Trying to get missing node for elemId: " + serverId + " editId: " + editId);

            for(let i = 0; i < editData.numNodes; i++)
            {
                if(!editData.recievedNodes[i])
                {
                    if(editData.nodeRetries > 10 || boardConnData.cleanUp)
                    {
                        clearInterval(editData.nodeTimeout);
                        editData.recievedNodes = [];
                        editData.cleanedNodes = [];

                        console.log("Dropped edit.");

                        let payload: ServerDroppedMessage = { editId: editId, bufferId: editData.localId };
                        let droppedMsg : ServerMessage = { header: MessageTypes.DROPPED, payload: payload };
                        let droppedCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: 'ANY', payload: droppedMsg
                        };
                        socket.emit('MSG-COMPONENT', droppedCont);

                        return;
                    }
                }
                else
                {
                    if(boardConnData.isConnected)
                    {
                        let payload: ServerMissedMessage = { editId: editId, num: i };
                        let missedMsg : ServerMessage = { header: MessageTypes.MISSED, payload: payload };
                        let missedCont: ServerMessageContainer =
                        {
                            serverId: serverId, userId: boardConnData.userId, type: MODENAME, payload: missedMsg
                        };
                        socket.emit('MSG-COMPONENT', missedCont);
                    }
                }
            }
        }

        private handleMissingMessage(message: UserMissingNodeMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            console.log('BOARD: Received missing message.');
            let node = this.componentData[message.userId].edits[serverId][message.editId].cleanedNodes[message.seq_num];

            this.sendNode(serverId, message.editId, node, socket, boardConnData);
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = function(registerComponent) {
    registerComponent(TextBox.MODENAME, TextBox.ComponentClass);
}
