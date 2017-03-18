interface Point {
    x: number;
    y: number;
}



interface ServerMessageContainer {
    serverId: number;
    userId: number;
    type: string;
    payload: ServerMessage;
}
interface ServerMessage {
    header: number;
    payload: ServerMessagePayload;
}
interface ServerMessagePayload {

}

interface ServerOptionsMessage {
    allEdit: boolean;
    userEdit: boolean;
}

interface ServerBoardJoinMessage {
    userId: number;
    colour: number;
}
interface ServerIdMessage {
    serverId: number;
    localId: number;
}
interface ServerMoveElementMessage extends ServerMessagePayload {
    x: number;
    y: number;
    editTime: Date;
}
interface ServerResizeElementMessage extends ServerMessagePayload {
    width: number;
    height: number;
    editTime: Date;
}
interface ServerLockElementMessage extends ServerMessagePayload {
    userId: number;
}


interface UserMessagePayload {

}
interface UserMessage {
    header: number;
    payload: UserMessagePayload;
}
interface UserNewElementPayload extends UserMessagePayload {
    localId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    editLock: boolean;
}
interface UserNewElementMessage {
    type: string;
    payload: UserNewElementPayload;
}
interface UserMessageContainer {
    id: number;
    type: string;
    payload: UserMessage;
}
interface UserUnknownElement {
    type: string;
    id: number;
}

interface UserMoveElementMessage extends UserMessagePayload {
    x: number;
    y: number;
}
interface UserResizeElementMessage extends UserMessagePayload {
    width: number;
    height: number;
}
