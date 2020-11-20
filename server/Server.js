import express from 'express';
import fs from 'fs';
import ws from 'ws';
import http from 'http';
import https from 'https';
import path from 'path';

const app = express();
app.use(express.static(path.join(process.cwd(), "dist")));

class CallHandler {

    constructor() {
        this.wss = null;
        this.ws = null;
        this.clients = new Set();
        this.server = null;
        this.ssl_server = null;
        this.sessions = [];
    }

    init() {

        const ws_server_port = (process.env.PORT || 4442);
        this.server = http.createServer(app).listen(ws_server_port, () => {
            console.log("start WS Server: bind => ws://0.0.0.0:" + ws_server_port);
        });
        this.ws = new ws.Server({ server: this.server });
        this.ws.on('connection', this.onConnection);

        const options = {
            key: fs.readFileSync('certs/key.pem'),
            cert: fs.readFileSync('certs/cert.pem')
        };

        const wss_server_port = (process.env.PORT + 1 || 4443);
        this.ssl_server = https.createServer(options, app).listen(wss_server_port, () => {
            console.log("Start WSS Server: bind => wss://0.0.0.0:" + wss_server_port);
        });

        this.wss = new ws.Server({ server: this.ssl_server });
        this.wss.on('connection', this.onConnection);
        http.createServer(function (req, res) {
            if(req.url=='/out'){
                fs.readFile('nohup.out','utf-8',  (err, data)=> {
                    console.log('data=>'+data.type)
                    if (err) {
                      next(err) // Pass errors to Express.
                    } else {
                        console.log("writing out")
                        res.writeHead(200, {'Content-Type': 'text/plain'});
                        const arr = data.trim().split("\n");
                        res.write(arr.slice(arr.length-100).toString());
                        res.end();
                    }
                  })
            }else{
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end();
            }
        }).listen(8086,'127.0.0.1', () => {
            console.log("http")});
    }

      getFreePeer = (client_self, oldPeersIds) => {
        console.log('get free peers from '+this.clients.size);
        for(const client of this.clients) {
            const same = client === client_self;
            console.log(`id=${client.id}, busy=${client.busy}, same=${same}`)
            const peer = {};
            if (!client.busy && !same && !oldPeersIds.includes(client.id)) {
                if (client.hasOwnProperty('id')) {
                    peer.id = client.id;
                }
                if (client.hasOwnProperty('name')) {
                    peer.name = client.name;
                }
                if (client.hasOwnProperty('user_agent')) {
                    peer.user_agent = client.user_agent;
                }
                if (client.hasOwnProperty('session_id')) {
                    peer.session_id = client.session_id;
                }
                client.busy=true
                return peer
            }
        }
        return null
    };

    onClose = (client_self) => {
        const session_id = client_self.session_id;
        if (session_id !== undefined) {
            for (let i = 0; i < this.sessions.length; i++) {
                let item = this.sessions[i];
                if (item.id === session_id) {
                    this.sessions.splice(i, 1);
                    break;
                }
            }
        }
        const msg = {
            type: "leave",
            data: client_self.id,
        };

        let _send = this._send;
        console.log("sess id=>"+session_id)
        this.clients.forEach(function (client) {
            if (session_id!==undefined && client !== client_self && client.session_id === session_id){ 
             client.busy = false;
            _send(client, JSON.stringify(msg));
            }
        });
    };

    onConnection = (client_self) => {
        let _send = this._send;
        this.clients.add(client_self);
        client_self.on("close", (data) => {
            this.clients.delete(client_self);
            this.onClose(client_self)
        });

        client_self.on("message", message => {
            let msg;
            try {
                message = JSON.parse(message);
                if(message.type=='new'){
                    console.log("message.type:: " + message.type + ", \nbody: " + JSON.stringify(message));
                }else{
                    console.log("message.type:: " + message.type + ", \nto: " + message.to);
                }
            } catch (e) {
                console.log(e.message);
            }

            switch (message.type) {
                case 'new': { 
                    client_self.id = "" + message.id;
                    client_self.name = message.name;
                    client_self.user_agent = message.user_agent;
                    client_self.busy = false
                    const p = this.getFreePeer(client_self, message.oldPeerIds);
                    if (p==null)return
                    const msg = {
                        type: "peer",
                        data: p,
                    };
                    client_self.send(JSON.stringify(msg))
                }
                    break;
                case 'bye': {
                    let session = null;
                    this.sessions.forEach((sess) => {
                        if (sess.id === message.session_id) {
                            session = sess;
                        }
                    });

                    if (!session) {
                        msg = {
                            type: "error",
                            data: {
                                error: "Invalid session " + message.session_id,
                            },
                        };
                        _send(client_self, JSON.stringify(msg));
                        return;
                    }

                    this.clients.forEach((client) => {
                        if (client.session_id === message.session_id) {
                            try {
                                const msg = {
                                    type: "bye",
                                    data: {
                                        session_id: message.session_id,
                                        from: message.from,
                                        to: (client.id === session.from ? session.to : session.from),
                                    },
                                };
                                _send(client, JSON.stringify(msg));
                                client.busy = false
                            } catch (e) {
                                console.log("onUserJoin:" + e.message);
                            }
                        }
                    });
                }
                    break;
                case "offer": {
                    let peer = null;
                    this.clients.forEach(function (client) {
                        if (client.hasOwnProperty('id') && client.id === "" + message.to) {
                            peer = client;
                        }
                    });

                    if (peer != null) {
                        msg = {
                            type: "offer",
                            data: {
                                to: peer.id,
                                from: client_self.id,
                                media: message.media,
                                session_id: message.session_id,
                                description: message.description,
                            }
                        };
                        _send(peer, JSON.stringify(msg));
                        peer.session_id = message.session_id;
                        client_self.session_id = message.session_id;

                        let session = {
                            id: message.session_id,
                            from: client_self.id,
                            to: peer.id,
                        };
                        this.sessions.push(session);
                        client_self.busy = true;
                        for (const c of this.clients) {
                            if (c.id === peer.id) {
                                c.busy = true;
                                break
                            }
                        }
                    }
                    break;
                }
                case 'answer': {
                    msg = {
                        type: "answer",
                        data: {
                            from: client_self.id,
                            to: message.to,
                            description: message.description,
                        }
                    };

                    this.clients.forEach(function (client) {
                        if (client.id === "" + message.to && client.session_id === message.session_id) {
                            try {
                                _send(client, JSON.stringify(msg));
                            } catch (e) {
                                console.log("onUserJoin:" + e.message);
                            }
                        }
                    });
                }
                    break;
                case 'candidate': {
                    msg = {
                        type: "candidate",
                        data: {
                            from: client_self.id,
                            to: message.to,
                            candidate: message.candidate,
                        }
                    };

                    this.clients.forEach(function (client) {
                        if (client.id === "" + message.to && client.session_id === message.session_id) {
                            try {
                                _send(client, JSON.stringify(msg));
                            } catch (e) {
                                console.log("onUserJoin:" + e.message);
                            }
                        }
                    });
                }
                    break;
                case 'keepalive':
                    _send(client_self, JSON.stringify({ type: 'keepalive', data: {} }));
                    break;
                default:
                    console.log("Unhandled message: " + message.type);
            }
        });
    };

    _send = (client, message) => {
        try {
            client.send(message);
        } catch (e) {
            console.log("Send failure !: " + e);
        }
    }
}

let callHandler = new CallHandler();
callHandler.init();
