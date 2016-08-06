/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
interface OperationBufferElement {
    type: string;
    message: UserMessage;
}
interface InfoMessage {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    header: string;
    message: string;
}
interface BoardElement {
    serverId: number;
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    user: number;
    updateTime: Date;
    isDeleted: boolean;
    type: string;
    opBuffer: Array<OperationBufferElement>;
    hoverTimer: number;
    infoElement: number;
}
interface Point {
    x: number;
    y: number;
}
interface Curve extends BoardElement {
    curveSet: Array<Point>;
    colour: string;
    size: number;
}
interface CursorElement extends Point {
    height: number;
}
interface CursorSelection extends CursorElement {
    width: number;
}
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
interface TextNode {
    lineNum: number;
    x: number;
    y: number;
    styles: Array<StyleNode>;
    dx: number;
    dy: number;
    start: number;
    end: number;
    endCursor: boolean;
    justified: boolean;
    text: string;
}
interface StyleNode {
    key: number;
    text: string;
    colour: string;
    dx: number;
    locStart: number;
    decoration: string;
    weight: string;
    style: string;
    startPos: number;
}
interface WhiteBoardText extends BoardElement {
    editLock: number;
    styles: Array<TextStyle>;
    text: string;
    justified: boolean;
    textNodes: Array<TextNode>;
    cursor: CursorElement;
    cursorElems: Array<CursorSelection>;
    dist: Array<number>;
    editCount: number;
    size: number;
    waiting: boolean;
}
interface Highlight extends BoardElement {
    colour: number;
}
interface Upload extends BoardElement {
    rotation: number;
    isImage: boolean;
    fType: string;
}
interface CurveInBufferElement {
    num_points: number;
    num_recieved: number;
    serverId: number;
    user: number;
    colour: string;
    size: number;
    curveSet: Array<Point>;
    updateTime: Date;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface CurveOutBufferElement {
    serverId: number;
    localId: number;
    colour: string;
    size: number;
    curveSet: Array<Point>;
}
interface TextInBufferElement {
    x: number;
    y: number;
    size: number;
    user: number;
    editLock: number;
    width: number;
    height: number;
    justified: boolean;
    styles: Array<TextStyle>;
    editBuffer: Array<Array<TextInNodeElement>>;
}
interface TextOutBufferElement {
    id: number;
    editCount: number;
    x: number;
    y: number;
    size: number;
    width: number;
    height: number;
    justified: boolean;
    styles: Array<TextStyle>;
    editBuffer: Array<TextInNodeElement>;
    lastSent: number;
}
interface TextOutNode extends TextStyle {
    editId: number;
}
interface TextInNodeElement {
    num_nodes: number;
    nodes: Array<TextOutNode>;
}


/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
interface ServerMessage {

}
interface ServerBoardJoinMessage extends ServerMessage {
    userId: number;
    colour: number;
}
interface ServeBaseMessage extends ServerMessage {
    serverId: number;
}
interface ServerNewPointMessage extends ServeBaseMessage {
    num: number;
    x: number;
    y: number;
}
interface ServerNewCurveMessage extends ServeBaseMessage {
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
interface ServerCurveIdMessage extends ServeBaseMessage {
    localId: number;
}
interface ServerMissedPointMessage extends ServeBaseMessage {
    num: number;
}
interface ServerMoveElementMessage extends ServeBaseMessage {
    x: number;
    y: number;
    editTime: Date;
}
interface ServerNewTextboxMessage extends ServeBaseMessage {
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
interface ServerUploadIdMessage extends ServeBaseMessage {
    localId: number;
}
interface ServerUploadDataMessage extends ServeBaseMessage {
    place: number;
    percent: number;
}
interface ServerNewUploadMessage extends ServeBaseMessage {
    fileDesc: string;
    fileType: string;
    extension: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    userId: number;
    editTime: Date;
    url?: string;
}
interface ServerResizeFileMessage extends ServeBaseMessage {
    width: number;
    height: number;
    editTime: Date;
}
interface ServerRotateFileMessage extends ServeBaseMessage {
    rotation: number;
}
interface ServerUploadEndMessage extends ServeBaseMessage {
    fileURL: string;
}
/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
interface UserMessage {

}
interface UserNewCurveMessage extends UserMessage {
    localId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    colour: string;
    size: number;
    num_points: number;
}
interface UserNewPointMessage extends UserMessage {
    serverId: number;
    num: number;
    x: number;
    y: number;
}
interface UserMoveElementMessage extends UserMessage {
    serverId: number;
    x: number;
    y: number;
}
interface UserMissingCurveMessage extends UserMessage {
    serverId: number;
    seq_num: number;
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
interface UserEditTextMessage extends UserMessage {
    serverId: number;
    localId: number;
    bufferId: number;
    num_nodes: number;
}
interface UserStyleNodeMessage extends UserMessage {
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
interface UserJustifyTextMessage extends UserMessage {
    serverId: number;
    newState: boolean;
}
interface UserLockTextMessage extends UserMessage {
    serverId: number;
}
interface UserReleaseTextMessage extends UserMessage {
    serverId: number;
}
interface UserResizeTextMessage extends UserMessage {
    serverId: number;
    width: number;
    height: number;
}
interface UserMissingTextMessage extends UserMessage {
    serverId: number;
    seq_num: number;
}
interface UserHighLightMessage extends UserMessage {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface UserStartUploadMessage extends UserMessage {
    localId: number;
    fileName: string;
    fileSize: number;
    fileType: string;
    extension: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface UserRemoteFileMessage extends UserMessage {
    localId: number;
    fileURL: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fileDesc: string;
}
interface UserUploadDataMessage extends UserMessage {
    serverId: number;
    piece: ArrayBuffer;
}
interface UserResizeFileMessage extends UserMessage {
    serverId: number;
    width: number;
    height: number;
}
interface UserRotateFileMessage extends UserMessage {
    serverId: number;
    rotation: number;
}
