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

            // Resume any open file uploads.
            if(boardConnData[socket.id].currentUploads.length > 0)
            {
                console.log('BOARD: Found incomplete uploads. Attempting to resume.');
                for(let i = 0; i < boardConnData[socket.id].currentUploads.length; i++)
                {
                    let fileId = boardConnData[socket.id].currentUploads[i];
                    let place = boardConnData[socket.id].files[fileId].downloaded / 65536;
                    let percent = (boardConnData[socket.id].files[fileId].downloaded / boardConnData[socket.id].files[fileId].fileSize) * 100;

                    let dataMsg: ServerUploadDataMessage = { serverId: fileId, place: place, percent: percent };

                    console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(boardConnData[socket.id].files[fileId].fileSize / 65536) + 1));
                    socket.emit('FILE-DATA', dataMsg);
                }
            }

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
            connection.query('SELECT * FROM Free_Curve WHERE Entry_ID = ?', [elemData.Entry_ID], (err, rows, fields) =>
            {
                let curveMsg: ServerNewCurvePayload = {
                    header: null, payload: null, num_points: rows.Num_Control_Points, colour: rows.Colour, userId: elemData.User_ID, size: rows.Size,
                    x: elemData.X_Loc, y: elemData.Y_Loc, width: elemData.Width, height: elemData.Height, editTime: elemData.Edit_Time
                };
                let msgCont: ServerMessageContainer =
                {
                    serverId: elemData.Entry_ID, userId: boardConnData.userId, type: MODENAME, payload: curveMsg
                };

                let self = this;
                socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);

                connection.query('SELECT * FROM Control_Points WHERE Entry_ID = ?', [elemData.Entry_ID], (err, prows, pfields) =>
                {
                    if (err)
                    {
                        console.log('BOARD: Error while performing existing control point query. ' + err);
                    }
                    else
                    {
                        for(let i = 0; i < prows.length; i++)
                        {
                            ((data) => {setTimeout(() => { self.sendPoint(data, socket, boardConnData); }, 0);})(prows[i]);
                        }
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

        socket.on('HIGHLIGHT', function(data: UserHighLightMessage)
        {
            console.log('BOARD: Recieved Highlight.');
            console.log('BOARD: Sending colour as: ' + boardConnData[socket.id].colour);
            let highMsg: ServerHighLightMessage = { userId: boardConnData[socket.id].userId, x: data.x, y: data.y, width: data.width, height: data.height, colour: boardConnData[socket.id].colour};
            socket.to(boardConnData[socket.id].roomId.toString()).emit('HIGHLIGHT', highMsg);
        });

        socket.on('CLEAR-HIGHTLIGHT', function()
        {
            // TODO
        });

    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                                                            //
// REGISTER COMPONENT                                                                                                                                         //
//                                                                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
registerComponent(FreeCurve.MODENAME, FreeCurve.ComponentClass);
