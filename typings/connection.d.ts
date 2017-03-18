interface ConnectionData {
    roomId: number;
    userId: number;
    joinTimeout: NodeJS.Timer;
    startTime;
    sessLength: number;
    username: string;
    isConnected: boolean;
    isHost: boolean;
    isJoining: boolean;
    disconnectTimeout?: NodeJS.Timer;
}
interface MediaConnection extends ConnectionData {
    ScalableBroadcast: boolean;
    extra;
}
interface BoardConnection extends ConnectionData {
    colour: number;
    sessId: number;
    cleanUp: boolean;
    allowUserEdit: boolean;
    allowAllEdit: boolean;
    sessionTimeout: any;
}
