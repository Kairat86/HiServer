import * as events from 'events';
import browser from 'bowser';

let RTCPeerConnection;
let RTCSessionDescription;
var configuration;

export default class Signaling extends events.EventEmitter {

    constructor(url, name,user_agent) {
        super();
        this.socket = null;
        this.peer_connections = {};
        this.freePeerId = null;
        this.oldPeerIds = [];
        this.session_id = '0-0';
        this.self_id = 0;
        this.url = url;
        this.name = name;
        this.user_agent=user_agent
        this.local_stream;
        this.keepalive_cnt = 0;

        RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection || window.msRTCPeerConnection;
        RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription || window.msRTCSessionDescription;
        navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia;


        if (browser.safari) {
            var OrigPeerConnection = RTCPeerConnection;

            RTCPeerConnection = function (pcConfig, pcConstraints) {
                if (pcConfig && pcConfig.iceServers) {
                    var newIceServers = [];
                    for (var i = 0; i < pcConfig.iceServers.length; i++) {
                        var server = pcConfig.iceServers[i];
                        if (!server.hasOwnProperty('urls') &&
                            server.hasOwnProperty('url')) {
                            server = JSON.parse(JSON.stringify(server));
                            server.urls = server.url;
                            delete server.url;
                            newIceServers.push(server);
                        } else {
                            newIceServers.push(pcConfig.iceServers[i]);
                        }
                    }
                    pcConfig.iceServers = newIceServers;
                }
                return new OrigPeerConnection(pcConfig, pcConstraints);
            };
        }
        var twilioIceServers = [
            { url: 'stun:global.stun.twilio.com:3478?transport=udp' }
        ];

        configuration = { "iceServers": [{ "url": "stun:stun.l.google.com:19302" }] };

        this.socket = new WebSocket(this.url);
        this.socket.onopen = () => {
            console.log("wss connect success...");
            this.self_id = this.getRandomUserId();
            this.msgNew();
            this.wsKeepaliveTimeoutId = setInterval(this.keepAlive, 12000);
        };

        this.socket.onmessage = (e) => {

            var parsedMessage = JSON.parse(e.data);

            console.info('on message: {\n    type = ' + parsedMessage.type + ', \n    data = ' + JSON.stringify(parsedMessage.data) + '\n}');

            switch (parsedMessage.type) {
                case 'invite':
                    this.onInvite(parsedMessage);
                    break;
                case 'ringing':
                    this.onRinging(parsedMessage);
                    break;
                case 'offer':
                    this.onOffer(parsedMessage);
                    break;
                case 'answer':
                    this.onAnswer(parsedMessage);
                    break;
                case 'candidate':
                    this.onCandidate(parsedMessage);
                    break;
                case 'peer':
                    this.onPeer(parsedMessage);
                    break;
                case 'leave':
                    this.onLeave(parsedMessage);
                    this.msgNew()
                    break;
                case 'bye':
                    this.onBye(parsedMessage);
                    break;
                case 'keepalive':
                    console.log('keepalive response!');
                    break;
                default:
                    console.error('Unrecognized message', parsedMessage);
            }
        };

        this.socket.onerror = (e) => {
            console.log('onerror::' + e.data);
        }

        this.socket.onclose = (e) => {
            console.log('onclose::' + e.data);
        }
    }

    keepAlive = () => {
        this.send({ type: 'keepalive', data: {} });
        console.log('Sent keepalive ' + ++this.keepalive_cnt + ' times!');
    }

    getLocalStream = (type) => {
        return new Promise((pResolve, pReject) => {
            var constraints = { audio: true, video: (type === 'video') ? { width: 1280, height: 720 } : false };
            var that = this;
            navigator.mediaDevices.getUserMedia(constraints)
                .then(function (mediaStream) {
                    pResolve(mediaStream);
                }).catch((err) => {
                    console.log(err.name + ": " + err.message);
                    pReject(err);
                }
                );
        });
    }

    msgNew() {
        console.log("msg new")
        let message = {
            type: 'new',
            user_agent: this.user_agent,
            name: this.name,
            id: this.self_id,
            oldPeerIds:this.oldPeerIds
        };
        this.send(message);
    }

    getRandomUserId() {
        var num = "";
        for (var i = 0; i < 6; i++) {
            num += Math.floor(Math.random() * 10);
        }
        return num;
    }

    send = (data) => {
        this.socket.send(JSON.stringify(data));
    }

    invite = (peer_id, media) => {
        this.session_id = this.self_id + '-' + peer_id;
        this.getLocalStream(media).then((stream) => {
            this.local_stream = stream;
            this.createPeerConnection(peer_id, media, true, stream);
            this.emit('localstream', stream);
            this.emit('new_call', this.self_id, this.session_id);
        });
    };

    bye = () => {
        let message = {
            type: 'bye',
            session_id: this.session_id,
            from: this.self_id,
        }
        this.send(message);
    }

    createOffer = (pc, id, media) => {
        pc.createOffer((desc) => {
            console.log('createOffer: ', desc.sdp);
            pc.setLocalDescription(desc, () => {
                console.log('setLocalDescription', pc.localDescription);
                let message = {
                    type: 'offer',
                    to: id,
                    media: media,
                    description: pc.localDescription,
                    session_id: this.session_id,
                };
                this.send(message);
            }, this.logError);
        }, this.logError);
    };

    createPeerConnection = (id, media, isOffer, localstream) => {
        var pc = new RTCPeerConnection(configuration);
        this.peer_connections["" + id] = pc;
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                let message = {
                    type: 'candidate',
                    to: id,
                    candidate: event.candidate,
                    session_id: this.session_id,
                };
                this.send(message);
            }
        };

        pc.onnegotiationneeded = () => {
            console.log('onnegotiationneeded');
        };

        pc.oniceconnectionstatechange = (event) => {
            console.log('oniceconnectionstatechange', event);
            if (event.target.iceConnectionState === 'connected') {
                this.createDataChannel(pc);
            }
        };
        pc.onsignalingstatechange = (event) => {
            console.log('onsignalingstatechange', event);
        };

        pc.onaddstream = (event) => {
            console.log('onaddstream', event);
            this.emit('addstream', event.stream);
        };

        pc.onremovestream = (event) => {
            console.log('onremovestream', event);
            this.emit('removestream', event.stream);
        };

        pc.addStream(localstream);

        if (isOffer)
            this.createOffer(pc, id, media);
        return pc;
    }

    createDataChannel = (pc) => {
        if (pc.textDataChannel) {
            return;
        }
        var dataChannel = pc.createDataChannel("text");

        dataChannel.onerror = (error) => {
            console.log("dataChannel.onerror", error);
        };

        dataChannel.onmessage = (event) => {
            console.log("dataChannel.onmessage:", event.data);
            var content = document.getElementById('textRoomContent');
            //content.innerHTML = content.innerHTML + '<p>' + socketId + ': ' + event.data + '</p>';
        };

        dataChannel.onopen = () => {
            console.log('dataChannel.onopen');
        };

        dataChannel.onclose = () => {
            console.log("dataChannel.onclose");
        };

        pc.textDataChannel = dataChannel;
    }

    onPeer = (message) => {
        var data = message.data;
        this.invite(data.id, "video")
    }

    onOffer = (message) => {
        var data = message.data;
        var from = data.from;
        var media = data.media;
        this.session_id = data.session_id;
        this.emit('new_call', from, this.session_id);

        this.getLocalStream(media).then((stream) => {
            this.local_stream = stream;
            this.emit('localstream', stream);
            var pc = this.createPeerConnection(from, media, false, stream);

            if (pc && data.description) {
                pc.setRemoteDescription(new RTCSessionDescription(data.description), () => {
                    if (pc.remoteDescription.type == "offer")
                        pc.createAnswer((desc) => {
                            console.log('createAnswer: ', desc);
                            pc.setLocalDescription(desc, () => {
                                console.log('setLocalDescription', pc.localDescription);
                                let message = {
                                    type: 'answer',
                                    to: from,
                                    description: pc.localDescription,
                                    session_id: this.session_id,
                                }
                                this.send(message);
                            }, this.logError);
                        }, this.logError);
                }, this.logError);
            }
        });
    };

    onAnswer = (message) => {
        var data = message.data;
        var from = data.from;
        var pc = null;
        if (from in this.peer_connections) {
            pc = this.peer_connections[from];
        }
        if (pc && data.description) {
            //console.log('on answer sdp', data);
            pc.setRemoteDescription(new RTCSessionDescription(data.description), () => {
            }, this.logError);
        }
    };

    onCandidate = (message) => {
        var data = message.data;
        var from = data.from;
        var pc = null;
        if (from in this.peer_connections) {
            pc = this.peer_connections[from];
        }
        if (pc && data.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    };

    onLeave = (message) => {
        var id = message.data;
        console.log('leave', id);
        var peerConnections = this.peer_connections;
        var pc = peerConnections[id];
        if (pc !== undefined) {
            pc.close();
            delete peerConnections[id];
            this.emit('leave', id);
        }
        if (this.local_stream != null) {
            this.closeMediaStream(this.local_stream);
            this.local_stream = null;
        }
    };

    onBye = (message) => {
        console.log('on bye')
        var data = message.data;
        var from = data.from;
        var to = data.to;
        var peerConnections = this.peer_connections;
        var pc = peerConnections[to] || peerConnections[from];
        if (pc !== undefined) {
            pc.close();
            delete peerConnections[to];
            this.emit('call_end', to, this.session_id);
        }
        if (this.local_stream != null) {
            this.closeMediaStream(this.local_stream);
            this.local_stream = null;
        }
        const ids = this.session_id.split('-');
        var oldId = ids[1];
        if(oldId==this.self_id)oldId=ids[0]
        this.oldPeerIds.push(oldId)
        this.session_id = '0-0';
        this.msgNew()
    };

    logError = (error) => {
        console.log("logError", error);
    };

    sendText() {
        var text = "test send text...";//document.getElementById('textRoomInput').value;
        if (text == "") {
            alert('Enter something');
        } else {
            //document.getElementById('textRoomInput').value = '';
            // var content = document.getElementById('textRoomContent');
            // content.innerHTML = content.innerHTML + '<p>' + 'Me' + ': ' + text + '</p>';
            for (var key in this.peer_connections) {
                var pc = this.peer_connections[key];
                pc.textDataChannel.send(text);
            }
        }
    }

    closeMediaStream = (stream) => {
        if (!stream)
            return;

        let tracks = stream.getTracks();

        for (let i = 0, len = tracks.length; i < len; i++) {
            tracks[i].stop();
        }
    }
}