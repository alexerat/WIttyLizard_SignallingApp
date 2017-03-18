import ComponentBase = require("../ComponentBase");

/** Highlight Component.
*
* This allows the user to highlight areas for other users to see.
*
*/
namespace Highlight {
    /**
     * The name of the mode associated with this component.
     */
    export const MODENAME = 'HIGHLIGHT';

    interface ServerHighlightMessage extends ServerMessage {
        x: number;
        y: number;
        width: number;
        height: number;
        userId: number;
        colour: number;
    }
    interface UserHighlightMessage extends UserMessage {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    interface ComponentData {
        numRecieved: Array<number>;
        numPoints: Array<number>;
        recievedPoints: Array<Array<boolean>>;
        pointRetries: Array<number>;
        curveTimeouts: Array<any>;
    }

    /**
     * Message types that can be sent ebtween the user and server.
     */
    const MessageTypes = {
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

        }

        /** Remove all data for this connection associated with this component.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public sessionEnd(boardConnData: BoardConnection)
        {

        }

        /** Handle the initial sending of this element data to the user.
         *
         *  @param {SQLReturn} elemData - The basic data about this element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
         public sendData(elemData: ComponentBase.SQLElementData, socket: SocketIO.Socket, connection: MySql.SQLConnection, boardConnData: BoardConnection)
         {
            let newMsg: ServerHighlightMessage = {
                header: null, payload: null, colour: this.roomUserList[elemData.Room_ID][elemData.User_ID], userId: elemData.User_ID,
                x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height
            };
            let msgCont: ServerMessageContainer =
            {
                serverId: elemData.Entry_ID, userId: boardConnData.userId, type: MODENAME, payload: newMsg
            };

            socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
        }

        /** Handle receiving a new element of this component type, checking that the recieved element data is of the right type.
         *
         *  @param {UserHighlightMessage} message - The message containing the element data.
         *  @param {number} id - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {MySql.Pool} my_sql_pool - The mySQL connection pool to get a mySQL connection.
         */
        public handleNew(message: UserHighlightMessage, id: number, socket: SocketIO.Socket, connection: MySql.SQLConnection,
                         boardConnData: BoardConnection, my_sql_pool: MySql.Pool)
        {
            console.log('BOARD: Received highlight.');

            connection.commit((err) =>
            {
                if(err)
                {
                    console.log('BOARD: Error while performing new highlight query.' + err);
                    this.dropElement(id, socket, my_sql_pool, boardConnData);
                    return connection.rollback(() => { console.error(err); connection.release(); });
                }

                let newMsg: ServerHighlightMessage = {
                    header: null, payload: null, colour: this.roomUserList[boardConnData.roomId][boardConnData.userId], userId: boardConnData.userId,
                    x: message.x, y: message.y, width: message.width, height: message.height
                };
                let msgCont: ServerMessageContainer =
                {
                    serverId: id, userId: boardConnData.userId, type: MODENAME, payload: newMsg
                };

                socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                return connection.release();
            });
        }

        /** Handle messages for elements of this component type.
         *
         *  @param {UserMessage} message - The message.
         *  @param {number} serverId - The ID for the element.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         *  @param {SQLConnection} connection - The SQL connection to query against.
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleElementMessage(message: UserMessage, serverId: number, socket: SocketIO.Socket, connection, boardConnData: BoardConnection)
        {
            connection.release();
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

            connection.release();
        }

        /** Handle any necessary data handling on a user disconnect (connection need not be cleaned yet, will wait 5 sec for reconnection.
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         */
        public handleDisconnect(boardConnData: BoardConnection, my_sql_pool: MySql.Pool)
        {

        }

        /** Handle any necessary data handling on a user reconnect (connection has not been cleaned).
         *
         *  @param {BoardConnection} boardConnData - The connection data associated with this socket.
         *  @param {SocketIO.Socket} socket - The socket for this connection.
         */
        public handleReconnect(boardConnData: BoardConnection, socket: SocketIO.Socket, my_sql_pool: MySql.Pool)
        {

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

            my_sql_pool.getConnection((err, connection) =>
            {
                if(err)
                {
                    console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    return connection.release();
                }

                connection.query('USE Online_Comms',
                (err) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        return connection.release();
                    }

                    connection.query('UPDATE Whiteboard_Space SET isDeleted = ? WHERE User_ID = ? AND Room_Id = ? AND Type = ?',
                    [true, boardConnData.userId, boardConnData.roomId, MODENAME], function(err, rows)
                    {
                        if(err)
                        {
                            console.log('BOARD: Error while performing new remote file query.' + err);
                            return connection.release();
                        }

                        return connection.release();
                    });
                });
            });
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = function(registerComponent) {
    registerComponent(Highlight.MODENAME, Highlight.ComponentClass);
}
