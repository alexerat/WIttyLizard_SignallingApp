/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
interface BoardElement {
    serverId: number;
    id: number;
    user: number;
    isDeleted: boolean;
    type: string;
    size: number;
}
interface Point {
    x: number;
    y: number;
}
interface Curve extends BoardElement {
    curveSet: Array<Point>;
    colour: string;
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
    x: number;
    y: number;
    width: number;
    height: number;
    editLock: number;
    styles: Array<TextStyle>;
    text: string;
    justified: boolean;
    textNodes: Array<TextNode>;
    cursor: CursorElement;
    cursorElems: Array<CursorSelection>;
    dist: Array<number>;
    editCount: number;
}
interface CurveInBufferElement {
    num_points: number;
    num_recieved: number;
    serverId: number;
    user: number;
    colour: string;
    size: number;
    curveSet: Array<Point>;
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
interface ServerBoardJoinMessage {
    userId: number;
    colour: number;
}
interface ServeBaseMessage {
    serverId: number;
}
interface ServerNewPointMessage extends ServeBaseMessage {
    num: number;
    x: number;
    y: number;
}
interface ServerNewCurveMessage extends ServeBaseMessage {
    userId: number;
    size: number;
    colour: string;
    num_points: number;
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
}
interface ServerJustifyTextMessage extends ServeBaseMessage {
    newState: boolean;
}
interface ServerEditTextMessage extends ServeBaseMessage {
    userId: number;
    editId: number;
    num_nodes: number;
}
interface ServerEditIdMessage {
    editId: number;
    bufferId: number;
    localId: number;
}
interface ServerLockIdMessage extends ServeBaseMessage {
    serverId: number;
}
interface ServerLockTextMessage extends ServeBaseMessage {
    userId: number;
}
interface ServerReleaseTextMessage extends ServeBaseMessage {

}
interface ServerRefusedTextMessage extends ServeBaseMessage {

}

/***************************************************************************************************************************************************************
 *
 *
 *
 *
 *
 **************************************************************************************************************************************************************/
interface UserNewCurveMessage {
    localId: number;
    colour: string;
    size: number;
    num_points: number;
}
interface UserNewPointMessage {
    serverId: number;
    num: number;
    x: number;
    y: number;
}
interface UserMoveElementMessage {
    serverId: number;
    x: number;
    y: number;
}
interface UserMissingCurveMessage {
    serverId: number;
    seq_num: number;
}
interface UserNewTextMessage {
    localId: number;
    size: number;
    x: number;
    y: number;
    width: number;
    height: number;
    justified: boolean;
}
interface UserEditTextMessage {
    serverId: number;
    localId: number;
    bufferId: number;
    num_nodes: number;
}
interface UserStyleNodeMessage {
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
interface UserJustifyTextMessage {
    serverId: number;
    newState: boolean;
}
interface UserLockTextMessage {
    serverId: number;
}
interface UserReleaseTextMessage {
    serverId: number;
}
interface UserResizeTextMessage {
    serverId: number;
    width: number;
    height: number;
}
interface UserMissingTextMessage {
    serverId: number;
    seq_num: number;
}
