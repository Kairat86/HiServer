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
                    if (err) {
                      next(err) // Pass errors to Express.
                    } else {
                        res.writeHead(200, {'Content-Type': 'text/plain'});
                        const arr = data.trim().split(/(?<=\n)/g);
                        res.write(arr.slice(arr.length-130).toString());
                        res.end();
                    }
                  })
            }else{
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end();
            }
        }).listen(8080,'0.0.0.0');
    }

      getFreePeer = (client_self, oldPeersIds) => {
        console.log('get free peer from '+this.clients.size);
        for(const client of this.clients) {
            const same = (client === client_self || client.id==client_self.id);
            console.log(`id=${client.id}, busy=${client.busy}, same=${same}`)
            const peer = {};
            if (!client.busy && !same && !oldPeersIds.includes(client.id)) {
                if (client.hasOwnProperty('id')) {
                    peer.id = client.id;
                }
                if (client.hasOwnProperty('name')) {
                    peer.name = client.name;
                }
                if (client.hasOwnProperty('session_id')) {
                    peer.session_id = client.session_id;
                }
                if (client.hasOwnProperty('mc')) {
                    peer.mc = client.mc;
                }
                client.busy=true
                return peer
            }
        }
        return null
    };

    onConnection = (client_self) => {
        let _send = this._send;
        this.clients.add(client_self);
        client_self.on("close", (data) => {
            this.clients.delete(client_self);
            console.log('on close id=>'+client_self.id)
        });

        client_self.on("message", message => {
            let msg;
            try {
                message = JSON.parse(message);
                if(message.type=='new'){
                    console.log(JSON.stringify(message));
                }else{
                    console.log("message.type: " + message.type + "; to: " + message.to);
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
                    client_self.mc=message.mc;
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
                    client_self.busy=message.is_busy
                    if(message.to==null)return;
                    _send(client_self,JSON.stringify(this.bye()));
                    for(let client of this.clients) {
                        if (client.id==message.to) {
                            try {
                                const msg = this.bye();
                                _send(client, JSON.stringify(msg));
                            } catch (e) {
                                console.log("onUserJoin:" + e.message);
                            }
                            break;
                        }
                    }
                }
                    break;
                case "offer": {
                    let peer = null;
                    for(let client of this.clients) {
                        if (client.id ===  message.to) {
                            peer = client;
                            break;
                        }
                    }

                    if (peer != null) {
                        msg = {
                            type: "offer",
                            data: {
                                to: peer.id,
                                from: client_self.id,
                                media: message.media,
                                description: message.description,
                                mc:message.mc
                            }
                        };
                        _send(peer, JSON.stringify(msg));

                        client_self.busy = true;
                        peer.busy=true;
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

                    for(let client of this.clients) {
                        if (client.id === message.to) {
                            try {
                                _send(client, JSON.stringify(msg));
                            } catch (e) {
                                console.log("onUserJoin:" + e.message);
                            }
                            break;
                        }
                    }
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

                    for(let client of this.clients) {
                        if (client.id === message.to) {
                            try {
                                _send(client, JSON.stringify(msg));
                            } catch (e) {
                                console.log("onUserJoin:" + e.message);
                            }
                            break;
                        }
                    }
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

    bye() {
        return { type: "bye" };
    }
}

let callHandler = new CallHandler();
callHandler.init();
