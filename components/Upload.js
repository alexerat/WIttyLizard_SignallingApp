"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var ComponentBase = require("../ComponentBase");
var Upload;
(function (Upload) {
    Upload.MODENAME = 'UPLOAD';
    var urlMod = require('url');
    var typeCheck = require('check-types');
    var AWS = require('aws-sdk');
    var s3 = new AWS.S3();
    var uuid = require('node-uuid');
    var ViewTypes = {
        IMAGE: 'IMAGE',
        VIDEO: 'VIDEO',
        AUDIO: 'AUDIO',
        FILE: 'FILE',
        IFRAME: 'IFRAME',
        LINK: 'LINK'
    };
    var MAXSIZE = 10485760;
    var UPLOADTYPES = [/image/, /video/, /audio/];
    var MessageTypes = {
        START: 1,
        DATA: 2,
        DONE: 3,
        ROTATE: 4,
        VIEWTYPE: 5,
        UPDATE: 6
    };
    var ComponentClass = (function (_super) {
        __extends(ComponentClass, _super);
        function ComponentClass() {
            var _this = _super.apply(this, arguments) || this;
            _this.componentData = [];
            return _this;
        }
        ComponentClass.prototype.userJoin = function (socket, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            if (userData == undefined || userData == null) {
                userData = { files: [], currentUploads: [], fNames: [], currentPieces: [], timeouts: [], retries: [] };
                this.componentData[boardConnData.userId] = userData;
            }
            if (this.componentData[boardConnData.userId].currentUploads.length > 0) {
                console.log('BOARD: Found incomplete uploads. Attempting to resume.');
                for (var i = 0; i < boardConnData[socket.id].currentUploads.length; i++) {
                    var serverId = this.componentData[boardConnData.userId].currentUploads[i];
                    var file = this.componentData[boardConnData.userId].files[serverId];
                    var place = file.downloaded / 65536;
                    var percent = (file.downloaded / file.fileSize) * 100;
                    var payload = { place: place, percent: percent };
                    var msg = { header: MessageTypes.DATA, payload: payload };
                    var msgCont = { serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: msg };
                    socket.emit('MSG-COMPONENT', msgCont);
                    console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(file.fileSize / 65536) + 1));
                }
            }
        };
        ComponentClass.prototype.sessionEnd = function (boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            if (userData != undefined && userData != null) {
                userData.files = null;
                userData.currentUploads = null;
                userData.fNames = null;
                userData.currentPieces = null;
                userData.timeouts = null;
            }
            userData = null;
        };
        ComponentClass.prototype.sendData = function (elemData, socket, connection, boardConnData) {
            connection.query('SELECT * FROM Upload_Space WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing existing file query. ' + err);
                    return connection.release();
                }
                if (rows[0] == null || rows[0] == undefined) {
                    console.log('BOARD: Error while performing existing file query. ' + err);
                    return connection.release();
                }
                console.log('Sending user upload message.');
                var uploadMsg = {
                    header: null, payload: null, userId: elemData.User_ID, x: elemData.X_Loc, y: elemData.Y_Loc, viewType: rows[0].View_Type,
                    width: elemData.Width, height: elemData.Height, editTime: elemData.Edit_Time, rotation: rows[0].Rotation,
                    fileDesc: rows[0].File_Description, fileType: rows[0].File_Type, extension: rows[0].Extension, url: rows[0].Content_URL
                };
                var msgCont = {
                    serverId: elemData.Entry_ID, userId: boardConnData.userId, type: Upload.MODENAME, payload: uploadMsg
                };
                socket.emit('NEW-ELEMENT', msgCont);
                connection.release();
            });
        };
        ComponentClass.prototype.handleNew = function (message, id, socket, connection, boardConnData, my_sql_pool) {
            console.log('BOARD: Received Upload.');
            if (!typeCheck.boolean(message.isLocal) || !typeCheck.string(message.fileDesc) || !typeCheck.maybe.number(message.fileSize) ||
                !typeCheck.maybe.string(message.fileType) || !typeCheck.string(message.extension) || !typeCheck.string(message.fileURL)) {
                console.log('Bad data recieved in new upload.');
                console.log(JSON.stringify(message));
                return connection.rollback(function () { connection.release(); });
            }
            if (message.fileSize > MAXSIZE) {
                console.log('BOARD: User attempted upload larger than 10MB.');
                return connection.rollback(function () { connection.release(); });
            }
            this.checkUpload(message, id, socket, connection, my_sql_pool, boardConnData);
        };
        ComponentClass.prototype.handleElementMessage = function (message, serverId, socket, connection, boardConnData, my_sql_pool) {
            var type = message.header;
            switch (type) {
                case MessageTypes.START:
                    this.handleStartMessage(message.payload, serverId, socket, connection, my_sql_pool, boardConnData);
                    break;
                case MessageTypes.DATA:
                    this.handleDataMessage(message.payload, serverId, socket, my_sql_pool, connection, boardConnData);
                    break;
                case MessageTypes.ROTATE:
                    this.handleRotateMessage(message.payload, serverId, socket, connection, boardConnData);
                    break;
                default:
                    console.log('Unknown message type recieved.');
                    connection.release();
                    break;
            }
        };
        ComponentClass.prototype.handleUnknownMessage = function (serverId, socket, connection, boardConnData) {
            var _this = this;
            var self = this;
            connection.query('SELECT * FROM Whiteboard_Space WHERE Entry_ID = ? AND Room_ID = ?', [serverId, boardConnData.roomId], function (err, rows, fields) {
                if (err) {
                    console.log('BOARD: Error while performing upload query.' + err);
                    return connection.release();
                }
                if (rows[0] == null || rows[0] == undefined) {
                    console.log('Element not found.');
                    return connection.release();
                }
                var elemData = rows[0];
                connection.query('SELECT * FROM Upload_Space WHERE Entry_ID = ?', [elemData.Entry_ID], function (err, rows, fields) {
                    if (err) {
                        console.log('BOARD: Error while performing upload query.' + err);
                        return connection.release();
                    }
                    if (rows[0] == null || rows[0] == undefined) {
                        console.log('BOARD: Error while performing upload query.');
                        return connection.release();
                    }
                    var uploadMsg = {
                        header: null, payload: null, userId: elemData.User_ID, x: elemData.X_Loc, y: elemData.Y_Loc, viewType: rows[0].View_Type,
                        width: elemData.Width, height: elemData.Height, editTime: elemData.Edit_Time, rotation: rows[0].Rotation,
                        fileDesc: rows[0].File_Description, fileType: rows[0].File_Type, extension: rows[0].Extension, url: rows[0].Content_URL
                    };
                    var msgCont = {
                        serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: uploadMsg
                    };
                    var self = _this;
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                    connection.release();
                });
            });
        };
        ComponentClass.prototype.handleDisconnect = function (boardConnData, my_sql_pool) {
            var userData = this.componentData[boardConnData.userId];
            for (var i = 0; i < userData.currentUploads.length; i++) {
                console.log('Cleared interval after disconnect.');
                clearInterval(userData.timeouts[userData.currentUploads[i]]);
            }
        };
        ComponentClass.prototype.handleReconnect = function (boardConnData, socket, my_sql_pool) {
            var self = this;
            var userData = this.componentData[boardConnData.userId];
            for (var i = 0; i < userData.currentUploads.length; i++) {
                console.log('Re-added curve timeout after reconnect.');
                var elemId = userData.currentUploads[i];
                var place = userData.currentPieces[elemId];
                userData.timeouts[elemId] = setInterval(function (id, place) { self.missedData(id, place, boardConnData, socket, my_sql_pool); }, 60000, elemId, place);
            }
        };
        ComponentClass.prototype.handleClean = function (boardConnData, socket, my_sql_pool) {
            _super.prototype.handleClean.call(this, boardConnData, socket, my_sql_pool);
            var userData = this.componentData[boardConnData.userId];
            for (var i = 0; i < userData.currentUploads.length; i++) {
                var elemId = userData.currentUploads[i];
                clearInterval(userData.timeouts[elemId]);
                userData.files[elemId] = null;
                userData.fNames[elemId] = null;
                userData.retries[elemId] = null;
                this.dropElement(elemId, socket, my_sql_pool, boardConnData);
            }
            userData.currentUploads = [];
        };
        ComponentClass.prototype.missedData = function (serverId, place, boardConnData, socket, my_sql_pool) {
            var userData = this.componentData[boardConnData.userId];
            var file = userData.files[serverId];
            var percent = (file.downloaded / file.fileSize) * 100;
            if (userData.retries[serverId][place] == undefined || userData.retries[serverId][place] == null) {
                userData.retries[serverId][place] = 1;
            }
            else {
                userData.retries[serverId][place]++;
            }
            if (userData.retries[serverId][place] < 10) {
                console.log('BOARD: Retrying request for file piece: ' + (place + 1) + ' out of ' + (Math.floor(file.fileSize / 65536) + 1));
                var payload = { place: place, percent: percent };
                var dataMsg = { header: MessageTypes.DATA, payload: payload };
                var dataCont = {
                    serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: dataMsg
                };
                socket.emit('MSG-COMPONENT', dataCont);
            }
            else {
                var index = userData.currentUploads.indexOf(serverId);
                userData.currentUploads.splice(index, 1);
                userData.files[serverId] = null;
                clearInterval(userData.timeouts[serverId]);
                userData.fNames[serverId] = null;
                userData.retries[serverId] = null;
                this.dropElement(serverId, socket, my_sql_pool, boardConnData);
            }
        };
        ComponentClass.prototype.handleStartMessage = function (message, serverId, socket, connection, my_sql_pool, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            var file = userData.files[serverId];
            var self = this;
            if (file.currentPlace > -1) {
                console.log('BOARD: Already responded to start message.');
                return;
            }
            file.currentPlace++;
            console.log('BOARD: Recieved start message. Requesting first piece.');
            userData.timeouts[serverId] = setInterval(function (id, place) { self.missedData(id, place, boardConnData, socket, my_sql_pool); }, 60000, serverId, 0);
            var payload = { place: file.currentPlace, percent: 0 };
            var dataMsg = { header: MessageTypes.DATA, payload: payload };
            var dataCont = {
                serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: dataMsg
            };
            socket.emit('MSG-COMPONENT', dataCont);
        };
        ComponentClass.prototype.handleDataMessage = function (message, serverId, socket, my_sql_pool, connection, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            var file = userData.files[serverId];
            if (message.place != file.currentPlace) {
                console.log('BOARD: Recieved piece out of turn.');
                return;
            }
            if (file.downloaded[message.place] === true) {
                console.log('BOARD: Recieved piece that has already been recieved.');
                return;
            }
            var data = new Uint8Array(message.piece);
            console.log('BOARD: Received file data.');
            console.log('BOARD: Piece Size: ' + data.byteLength);
            console.log('BOARD: Previous total: ' + file.downloaded);
            file.downloaded[message.place] = true;
            file.downloaded += data.byteLength;
            var tmpArray = new Uint8Array(file.downloaded);
            tmpArray.set(new Uint8Array(file.data), 0);
            tmpArray.set(new Uint8Array(data), file.data.byteLength);
            file.data = tmpArray.buffer;
            if (file.downloaded == file.fileSize) {
                console.log('BOARD: File Upload complete.');
                var index = userData.currentUploads.indexOf(serverId);
                userData.currentUploads.splice(index, 1);
                userData.retries[serverId] = null;
                var upArray = new Uint8Array(file.data);
                var buffer = new Buffer(upArray.byteLength);
                for (var i = 0; i < buffer.length; ++i) {
                    buffer[i] = upArray[i];
                }
                var params = {
                    Body: buffer, ContentType: file.type, Metadata: { Origin: 'USER: ' + boardConnData.userId },
                    Bucket: 'whiteboard-storage', Key: '/UserTemp' + file.fileName, ACL: 'public-read'
                };
                var upload = new AWS.S3.ManagedUpload({ params: params, service: s3 });
                upload.send(function (err, upData) {
                    if (err) {
                        console.log('BOARD: Error uploading file to bucker: ' + err);
                        return;
                    }
                    var fileURL = 'https://whiteboard-storage.s3.amazonaws.com/UserTemp/' + file.fileName;
                    var fType = file.type;
                    file = null;
                    console.log('Received All File Data.');
                    connection.query('UPDATE Upload_Space SET isComplete = 1, Content_URL = ?, File_Type = ? WHERE Entry_ID = ?', [fileURL, fType, serverId], function (err, rows) {
                        if (err) {
                            console.log('BOARD: Error while performing complete upload query. ' + err);
                            return connection.release();
                        }
                        var payload = { fileURL: fileURL };
                        var compMsg = { header: MessageTypes.DONE, payload: payload };
                        var compCont = {
                            serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: compMsg
                        };
                        socket.emit('MSG-COMPONENT', compCont);
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', compCont);
                        connection.release();
                    });
                });
            }
            else if (file.downloaded > file.fileSize) {
                console.log('BOARD: Recieved a larger file than the file size given.');
            }
            else if (file.data.byteLength > MAXSIZE) {
                console.log('BOARD: User uploaded a file larger than 10MB, it should have been less than.');
                var index = userData.currentUploads.indexOf(serverId);
                userData.currentUploads.splice(index, 1);
                userData.files[serverId] = null;
                clearInterval(userData.timeouts[serverId]);
                userData.fNames[serverId] = null;
                userData.retries[serverId] = null;
                this.dropElement(serverId, socket, my_sql_pool, boardConnData);
            }
            else {
                var place = ++file.currentPlace;
                var percent = (file.downloaded / file.fileSize) * 100;
                var self_1 = this;
                console.log('BOARD: Requesting file piece: ' + (place + 1) + ' out of ' + (Math.floor(file.fileSize / 65536) + 1));
                userData.timeouts[serverId] = setInterval(function (id, place) { self_1.missedData(id, place, boardConnData, socket, my_sql_pool); }, 60000, serverId, place);
                var payload = { place: place, percent: percent };
                var dataMsg = { header: MessageTypes.DATA, payload: payload };
                var dataCont = {
                    serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: dataMsg
                };
                socket.emit('MSG-COMPONENT', dataCont);
                var updatePayload = { percent: percent };
                var updateMsg = { header: MessageTypes.UPDATE, payload: payload };
                var updateCont = {
                    serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: updateMsg
                };
                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', updateCont);
            }
        };
        ComponentClass.prototype.handleRotateMessage = function (data, serverId, socket, connection, boardConnData) {
            console.log('Received Rotate File Event.');
            if (boardConnData.isHost || boardConnData.allowAllEdit) {
                connection.query('UPDATE Upload_Space SET Rotation = ? WHERE Entry_ID = ?', [data.rotation, serverId], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing rotate file query. ' + err);
                        return connection.release();
                    }
                    var payload = {
                        rotation: data.rotation
                    };
                    var msg = { header: MessageTypes.ROTATE, payload: payload };
                    var msgCont = {
                        serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: msg
                    };
                    socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                    connection.release();
                });
            }
            else {
                connection.query('SELECT User_ID FROM Whiteboard_Space WHERE Entry_ID = ? AND User_ID = ?', [serverId, boardConnData.userId], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing move:findUser query. ' + err);
                        return connection.release();
                    }
                    if (rows[0] != null && rows[0] != undefined && boardConnData.allowUserEdit) {
                        connection.query('UPDATE Upload_Space SET Rotation = ? WHERE Entry_ID = ?', [data.rotation, serverId], function (err, rows) {
                            if (err) {
                                console.log('BOARD: Error while performing rotate file query. ' + err);
                                return connection.release();
                            }
                            var payload = {
                                rotation: data.rotation
                            };
                            var msg = { header: MessageTypes.ROTATE, payload: payload };
                            var msgCont = {
                                serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: msg
                            };
                            socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', msgCont);
                            connection.release();
                        });
                    }
                });
            }
        };
        ComponentClass.prototype.checkUpload = function (data, serverId, socket, connection, my_sql_pool, boardConnData) {
            var self = this;
            console.log('Checking Upload.');
            if (data.isLocal) {
                console.log('Was local upload.');
                connection.query('SELECT Image FROM File_Types WHERE Type = ?', [data.fileType], function (err, rows) {
                    if (err) {
                        console.log('BOARD: Error while performing file type query.' + err);
                        return connection.rollback(function () { connection.release(); });
                    }
                    if (rows[0] == null || rows[0] == undefined) {
                        return connection.rollback(function () { connection.release(); });
                    }
                    console.log('Starting user Upload.');
                    self.startUpload(data, serverId, socket, connection, my_sql_pool, boardConnData);
                });
            }
            else {
                console.log('Getting remote content.');
                self.newRemote(data, serverId, socket, connection, my_sql_pool, boardConnData);
            }
        };
        ComponentClass.prototype.startUpload = function (data, serverId, socket, connection, my_sql_pool, boardConnData) {
            var self = this;
            var userData = this.componentData[boardConnData.userId];
            var fUUID = uuid.v4();
            connection.query('SELECT UUID FROM Upload_Space WHERE UUID = ?', [fUUID], function (err, rows) {
                if (err) {
                    console.log('BOARD: Error while performing new file upload query1.' + err);
                    return connection.rollback(function () { connection.release(); });
                }
                var viewType = ViewTypes.FILE;
                if (data.fileType.match(/image/)) {
                    viewType = ViewTypes.IMAGE;
                }
                else if (data.fileType.match(/video/)) {
                    viewType = ViewTypes.VIDEO;
                }
                else if (data.fileType.match(/audio/)) {
                    viewType = ViewTypes.AUDIO;
                }
                if (!rows || !rows[0]) {
                    connection.query('INSERT INTO Upload_Space(Entry_ID, UUID, Source, Rotation, isComplete, File_Description, File_Type, Extension, View_Type) ' +
                        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)', [serverId, fUUID, 'User', 0, false, data.fileDesc, data.fileType, data.extension, viewType], function (err, result) {
                        if (err) {
                            console.log('BOARD: Error while performing new file upload query2.' + err);
                            return connection.rollback(function () { connection.release(); });
                        }
                        connection.commit(function (err) {
                            if (err) {
                                console.log('BOARD: Error while performing new upload query.' + err);
                                self.dropElement(serverId, socket, my_sql_pool, boardConnData);
                                return connection.rollback(function () { connection.release(); });
                            }
                            var fName = fUUID + '.' + data.extension.split('.').pop();
                            ;
                            userData.files[serverId] =
                                {
                                    fileDesc: '',
                                    fileName: fName,
                                    fileSize: data.fileSize,
                                    data: new ArrayBuffer(0),
                                    downloaded: 0,
                                    type: data.fileType,
                                    recieved: [],
                                    currentPlace: -1
                                };
                            userData.currentUploads.push(serverId);
                            userData.retries[serverId] = [];
                            var idMsg = { serverId: serverId, localId: data.localId };
                            socket.emit('ELEMENT-ID', idMsg);
                            var uploadMsg = {
                                header: null, payload: null, userId: boardConnData.userId, x: data.x, y: data.y, width: data.width,
                                height: data.height, editTime: new Date(), rotation: 0, viewType: viewType,
                                fileDesc: data.fileDesc, fileType: data.fileType, extension: data.extension, url: ''
                            };
                            var msgCont = {
                                serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: uploadMsg
                            };
                            socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                        });
                    });
                }
                else {
                    self.startUpload(data, serverId, socket, connection, my_sql_pool, boardConnData);
                }
            });
        };
        ComponentClass.prototype.hostable = function (fType) {
            for (var i = 0; i < UPLOADTYPES.length; i++) {
                if (fType.match(UPLOADTYPES[i])) {
                    return true;
                }
            }
            return false;
        };
        ComponentClass.prototype.newRemote = function (data, serverId, socket, connection, my_sql_pool, boardConnData) {
            console.log('BOARD: Received remote file.');
            var self = this;
            var userData = this.componentData[boardConnData.userId];
            var urlObj = urlMod.parse(data.fileURL);
            var userReq = urlObj;
            connection.commit(function (err) {
                if (err) {
                    console.log('BOARD: Error while performing new upload query.' + err);
                    self.dropElement(serverId, socket, my_sql_pool, boardConnData);
                    return connection.rollback(function () { console.error(err); connection.release(); });
                }
                var idMsg = { serverId: serverId, localId: data.localId };
                socket.emit('ELEMENT-ID', idMsg);
                connection.release();
            });
            var options = { method: 'HEAD', host: userReq.host, port: 443, path: userReq.path };
            var req = require('https').request(options, function (res) {
                var fType = res.headers['content-type'];
                var fSize = res.headers['content-length'];
                if (fSize > MAXSIZE) {
                    self.setRemoteContent(data, serverId, socket, my_sql_pool, boardConnData);
                }
                else {
                    if (self.hostable(fType)) {
                        self.setRemDownload(data, serverId, socket, my_sql_pool, boardConnData, fType);
                    }
                    else {
                        self.setRemoteContent(data, serverId, socket, my_sql_pool, boardConnData);
                    }
                }
            });
            req.end();
        };
        ComponentClass.prototype.setRemoteContent = function (data, serverId, socket, my_sql_pool, boardConnData) {
            var userData = this.componentData[boardConnData.userId];
            var self = this;
            var url = data.fileURL;
            var viewType = ViewTypes.LINK;
            var payload = {
                viewType: viewType
            };
            var msg = { header: MessageTypes.VIEWTYPE, payload: payload };
            var msgCont = {
                serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: msg
            };
            socket.emit('MSG-COMPONENT', msgCont);
            if (url.match(/youtube/) || url.match(/youtu.be/)) {
                var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
                var match = url.match(regExp);
                if (match && match[7].length == 11) {
                    url = 'https://www.youtube.com/embed/' + match[7];
                }
                viewType = ViewTypes.IFRAME;
            }
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    return connection.release();
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        return connection.release();
                    }
                    connection.query('INSERT INTO Upload_Space(Entry_ID, Source, Content_URL, Rotation, isComplete, View_Type, File_Description) ' +
                        'VALUES(?, ?, ?, ?, ?, ?, ?)', [serverId, url, url, 0, true, viewType, data.fileDesc], function (err, result) {
                        if (err) {
                            console.log('BOARD: Error while performing new remote file query.' + err);
                            return connection.release();
                        }
                        var uploadMsg = {
                            header: null, payload: null, userId: boardConnData.userId, x: data.x, y: data.y, width: data.width,
                            height: data.height, editTime: new Date(), rotation: 0, viewType: viewType,
                            fileDesc: data.fileDesc, fileType: data.fileType, extension: data.extension, url: url
                        };
                        var msgCont = {
                            serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: uploadMsg
                        };
                        socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                        connection.release();
                        self.startRemDownload(data, serverId, socket, my_sql_pool, boardConnData);
                    });
                });
            });
        };
        ComponentClass.prototype.setRemDownload = function (data, serverId, socket, my_sql_pool, boardConnData, fType) {
            var userData = this.componentData[boardConnData.userId];
            var fUUID = uuid.v4();
            var self = this;
            my_sql_pool.getConnection(function (err, connection) {
                if (err) {
                    console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                    return connection.release();
                }
                connection.query('USE Online_Comms', function (err) {
                    if (err) {
                        console.log('BOARD: Error while performing new control point query. ' + err);
                        return connection.release();
                    }
                    connection.query('SELECT UUID FROM Upload_Space WHERE UUID = ?', [fUUID], function (err, rows) {
                        if (err) {
                            console.log('BOARD: Error while performing new remote file query.' + err);
                            return connection.release();
                        }
                        if (rows[0] != null && rows[0] != undefined) {
                            connection.release();
                            self.setRemDownload(data, serverId, socket, my_sql_pool, boardConnData, fType);
                            return;
                        }
                        var viewType = ViewTypes.FILE;
                        if (data.fileType.match(/image/)) {
                            viewType = ViewTypes.IMAGE;
                        }
                        else if (data.fileType.match(/video/)) {
                            viewType = ViewTypes.VIDEO;
                        }
                        else if (data.fileType.match(/audio/)) {
                            viewType = ViewTypes.AUDIO;
                        }
                        var payload = {
                            viewType: viewType
                        };
                        var msg = { header: MessageTypes.VIEWTYPE, payload: payload };
                        var msgCont = {
                            serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: msg
                        };
                        socket.emit('MSG-COMPONENT', msgCont);
                        connection.query('INSERT INTO Upload_Space(Entry_ID, UUID, Source, Rotation, View_Type, File_Description) VALUES(?, ?, ?, ?, ?)', [serverId, fUUID, data.fileURL, 0, viewType, data.fileDesc], function (err, result) {
                            if (err) {
                                console.log('BOARD: Error while performing new remote file query.' + err);
                                return connection.release();
                            }
                            var fName = fUUID + '.' + data.fileURL.split('?')[0].split('.').pop();
                            var fileId = result.insertId;
                            userData.fNames[fileId] = fName;
                            userData.retries[serverId] = [];
                            var uploadMsg = {
                                header: null, payload: null, userId: boardConnData.userId, x: data.x, y: data.y, width: data.width,
                                height: data.height, editTime: new Date(), rotation: 0, viewType: viewType,
                                fileDesc: data.fileDesc, fileType: data.fileType, extension: data.extension, url: ''
                            };
                            var msgCont = {
                                serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: uploadMsg
                            };
                            socket.broadcast.to(boardConnData.roomId.toString()).emit('NEW-ELEMENT', msgCont);
                            connection.release();
                            self.startRemDownload(data, serverId, socket, my_sql_pool, boardConnData);
                        });
                    });
                });
            });
        };
        ComponentClass.prototype.startRemDownload = function (data, serverId, socket, my_sql_pool, boardConnData) {
            var self = this;
            var urlObj = urlMod.parse(data.fileURL);
            var userReq = urlObj;
            var userData = this.componentData[boardConnData.userId];
            userData.timeouts[serverId] = setInterval(function (id, place) { self.missedData(id, place, boardConnData, socket, my_sql_pool); }, 60000, serverId, 0);
            require('https').get(userReq, function (response) {
                if (response.statusCode == 301 || response.statusCode == 302) {
                }
                else if (response.headers['content-length'] > MAXSIZE) {
                    console.log('Image too large.');
                    clearInterval(userData.timeouts[serverId]);
                    userData.files[serverId] = null;
                    userData.fNames[serverId] = null;
                    userData.retries[serverId] = null;
                    this.dropElement(serverId, socket, my_sql_pool, boardConnData);
                }
                else if (!~[200, 304].indexOf(response.statusCode)) {
                    console.log('Received an invalid status code. Code is: ' + response.statusCode);
                    clearInterval(userData.timeouts[serverId]);
                    userData.files[serverId] = null;
                    userData.fNames[serverId] = null;
                    userData.retries[serverId] = null;
                    this.dropElement(serverId, socket, my_sql_pool, boardConnData);
                }
                else if (!response.headers['content-type'].match(/image/)) {
                    console.log('Not an image.');
                    clearInterval(userData.timeouts[serverId]);
                    userData.files[serverId] = null;
                    userData.fNames[serverId] = null;
                    userData.retries[serverId] = null;
                    this.dropElement(serverId, socket, my_sql_pool, boardConnData);
                }
                else {
                    console.log('BOARD: Getting Data');
                    var body = new Uint8Array(0);
                    response.on('error', function (err) {
                        console.log(err);
                    });
                    response.on('data', function (chunk) {
                        var tmpArray = new Uint8Array(body.byteLength + chunk.length);
                        tmpArray.set(new Uint8Array(body), 0);
                        tmpArray.set(new Uint8Array(chunk), body.byteLength);
                        body = tmpArray;
                    });
                    response.on('end', function () {
                        self.completeRemFile(serverId, socket, my_sql_pool, boardConnData, body, response.headers['content-type'], data.fileURL);
                    });
                }
            });
        };
        ComponentClass.prototype.completeRemFile = function (serverId, socket, my_sql_pool, boardConnData, upArray, fileType, origin, waitCount) {
            if (waitCount === void 0) { waitCount = 0; }
            var userData = this.componentData[boardConnData.userId];
            if (!userData.fNames[serverId]) {
                if (waitCount > 10) {
                    console.log('BOARD: Failed to complete upload, file data not set.');
                    clearInterval(userData.timeouts[serverId]);
                    userData.files[serverId] = null;
                    userData.fNames[serverId] = null;
                    userData.retries[serverId] = null;
                    this.dropElement(serverId, socket, my_sql_pool, boardConnData);
                }
                else {
                    setTimeout(this.completeRemFile, 100, serverId, socket, upArray, fileType, origin, ++waitCount);
                }
            }
            else {
                var buffer = new Buffer(upArray.byteLength);
                for (var i = 0; i < buffer.length; ++i) {
                    buffer[i] = upArray[i];
                }
                var params = {
                    Body: buffer, Metadata: { Origin: origin }, ContentType: fileType,
                    Bucket: 'whiteboard-storage', Key: '/UserTemp' + userData.fNames[serverId], ACL: 'public-read'
                };
                userData.retries[serverId] = null;
                var upload = new AWS.S3.ManagedUpload({ params: params, service: s3 });
                upload.send(function (err, upData) {
                    if (err) {
                        console.log('BOARD: Error sending file: ' + err);
                        return;
                    }
                    var fileURL = 'https://whiteboard-storage.s3.amazonaws.com/UserTemp/' + userData.fNames[serverId];
                    console.log('BOARD: Received All File Data.');
                    my_sql_pool.getConnection(function (err, connection) {
                        if (err) {
                            console.log('BOARD: Error while getting database connection to remove malformed curve. ' + err);
                            return connection.release();
                        }
                        connection.query('USE Online_Comms', function (err) {
                            if (err) {
                                console.log('BOARD: Error while performing new control point query. ' + err);
                                return connection.release();
                            }
                            connection.query('UPDATE Upload_Space SET isComplete = 1, Content_URL = ?, File_Type = ? WHERE Entry_ID = ?', [fileURL, fileType, serverId], function (err, rows) {
                                if (!err) {
                                    console.log('BOARD: Error while performing complete upload query. ' + err);
                                    return connection.release();
                                }
                                var payload = { fileURL: fileURL };
                                var compMsg = { header: MessageTypes.DONE, payload: payload };
                                var compCont = {
                                    serverId: serverId, userId: boardConnData.userId, type: Upload.MODENAME, payload: compMsg
                                };
                                socket.emit('MSG-COMPONENT', compCont);
                                socket.broadcast.to(boardConnData.roomId.toString()).emit('MSG-COMPONENT', compCont);
                                connection.release();
                            });
                        });
                    });
                });
            }
        };
        return ComponentClass;
    }(ComponentBase.Component));
    Upload.ComponentClass = ComponentClass;
})(Upload || (Upload = {}));
module.exports = function (registerComponent) {
    registerComponent(Upload.MODENAME, Upload.ComponentClass);
};
