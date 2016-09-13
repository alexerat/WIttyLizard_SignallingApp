interface Style {
    weight: string;
    decoration: string;
    style: string;
    colour: string;
}
interface TextStyle extends Style {
    start: number;
    end: number;
    text: string;
    num: number;
}
interface Point {
    x: number;
    y: number;
}

/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
interface ServerMessageContainer {
    serverId: number;
    userId: number;
    type: string;
    payload: ServerMessage;
}
interface ServerMessage {
    header: number;
    payload: ServerPayload;
}
interface ServerPayload {

}

interface ServerOptionsMessage {
    allEdit: boolean;
    userEdit: boolean;
}

interface ServerBoardJoinMessage {
    userId: number;
    colour: number;
}
interface ServeBaseMessage extends ServerPayload {
    serverId: number;
}
interface ServerIdMessage {
    serverId: number;
    localId: number;
}
interface ServerMoveElementMessage extends ServerPayload {
    x: number;
    y: number;
    editTime: Date;
}
interface ServerNewTextboxMessage extends ServerPayload {
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
}
interface ServerStyleNodeMessage extends ServeBaseMessage {
    userId: number;
    editId: number;
    weight: string;
    decoration: string;
    style: string;
    colour: string;
    start: number;
    end: number;
    text: string;
    num: number;
}
interface ServerTextIdMessage extends ServeBaseMessage {
    localId: number;
}
interface ServerMissedTextMessage extends ServeBaseMessage {
    editId: number;
}
interface ServerResizeTextMessage extends ServeBaseMessage {
    width: number;
    height: number;
    editTime: Date;
}
interface ServerJustifyTextMessage extends ServeBaseMessage {
    newState: boolean;
}
interface ServerEditTextMessage extends ServeBaseMessage {
    userId: number;
    editId: number;
    num_nodes: number;
    editTime: Date;
}
interface ServerEditIdMessage extends ServerMessage {
    editId: number;
    bufferId: number;
    localId: number;
}
interface ServerLockIdMessage extends ServeBaseMessage {

}
interface ServerLockTextMessage extends ServeBaseMessage {
    userId: number;
}
interface ServerReleaseTextMessage extends ServeBaseMessage {

}
interface ServerRefusedTextMessage extends ServeBaseMessage {

}
interface ServerHighLightMessage extends ServerMessage {
    x: number;
    y: number;
    width: number;
    height: number;
    userId: number;
    colour: number;
}

/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/

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

interface UserNewTextMessage extends UserMessage {
    localId: number;
    size: number;
    x: number;
    y: number;
    width: number;
    height: number;
    justified: boolean;
}
interface UserEditTextMessage extends UserMessagePayload {
    localId: number;
    bufferId: number;
    num_nodes: number;
}
interface UserStyleNodeMessage extends UserMessagePayload {
    editId: number;
    num: number;
    start: number;
    end: number;
    text: string;
    weight: string;
    style: string;
    decoration: string;
    colour: string;
}
interface UserJustifyTextMessage extends UserMessagePayload {
    newState: boolean;
}
interface UserLockTextMessage extends UserMessagePayload {
}
interface UserReleaseTextMessage extends UserMessagePayload {
    serverId: number;
}
interface UserResizeTextMessage extends UserMessagePayload {
    width: number;
    height: number;
}
interface UserMissingTextMessage extends UserMessagePayload {
    seq_num: number;
}
interface UserHighLightMessage extends UserMessage {
    x: number;
    y: number;
    width: number;
    height: number;
}
