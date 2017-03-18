interface SQLTutorialRoom {
    Room_ID: number;
    Access_Token: string;
    Start_Time: Date;
    Book_Time: Date;
    Expiry: Date;
    Session_Length: number;
    Host_Join_Time: Date;
    Expected_Start: Date;
    Server_ID: number;
}

interface SQLTutorialServer {
    Server_ID: number;
    End_Point: string;
    Port: number;
    Num_Rooms: number;
    Zone: string;
    Expected_End: Date;
    isUp: boolean;
}
