import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { createMuiTheme, MuiThemeProvider, withStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Button from '@material-ui/core/Button';
import blue from '@material-ui/core/colors/blue';
import List from '@material-ui/core/List';
import Dialog from '@material-ui/core/Dialog';
import Typography from '@material-ui/core/Typography';
import Slide from '@material-ui/core/Slide';
import VideoOnIcon from '@material-ui/icons/Videocam';
import PhoneIcon from '@material-ui/icons/CallEnd';
import VideoOffIcon from '@material-ui/icons/VideocamOff';
import MicIcon from '@material-ui/icons/Mic';
import MicOffIcon from '@material-ui/icons/MicOff';
import SkipNextRoundedIcon from '@material-ui/icons/SkipNextRounded';
import LocalVideoView from './LocalVideoView';
import RemoteVideoView from './RemoteVideoView';
import css from './layout.css';
import Signaling from './Signaling';
import CircularProgress from "@material-ui/core/CircularProgress";

const theme = createMuiTheme({
    palette: {
        primary: blue,
    },
});

const styles = {
    root: {
        flexGrow: 1,
    },
    flex: {
        flex: 1,
    },
    menuButton: {
        marginLeft: -12,
        marginRight: 20,
    },

    btnTool: {
        color: 'white',
        marginRight: 20,
    },
};

function Transition(props) {
    return <Slide direction="up" {...props} />;
}

class App extends Component {

    constructor(props) {
        super(props);

        this.selfView = null;
        this.remoteView = null;
        this.signaling = null;

        this.state = {
            peers: [],
            self_id: null,
            open: false,
            localStream: null,
            remoteStream: null,
            audio_muted: false,
            video_muted: false,
        };
    }
    getFreePeerId = (peers) => {
        var i;
        for (i in peers) {
           const p = peers[i]
            if (!p.busy && p.id != this.state.self_id) {
                return p.id;
            }
        }
        console.log("no free peer")
        return null;
    }
    componentDidMount = () => {
        var url = 'wss://' + window.location.hostname + ':4443';
        this.signaling = new Signaling(url, "hi");
        this.signaling.on('peers', (peers, self) => {
            this.setState({ peers, self_id: self });
            const id = this.getFreePeerId(peers);
            console.log(`id to call ${id}`)
           if(id!=null) this.signaling.invite(id, "video")
        });

        this.signaling.on('new_call', (from, sessios) => {
            console.log("new call")
            this.setState({ open: true });
        });

        this.signaling.on('localstream', (stream) => {
            this.setState({ localStream: stream });
        });

        this.signaling.on('addstream', (stream) => {
            this.setState({ remoteStream: stream });
        });

        this.signaling.on('removestream', (stream) => {
            this.setState({ remoteStream: null });
        });

        this.signaling.on('call_end', (to, session) => {
            this.setState({ open: false, localStream: null, remoteStream: null });
        });

        this.signaling.on('leave', (to) => {
            this.setState({ open: false, localStream: null, remoteStream: null });
        });
    };

    handleClickOpen = () => {
        this.setState({ open: true });
    };

    handleClose = () => {
        this.setState({ open: false });
    };

    handleInvitePeer = (peer_id, type) => {
        this.signaling.invite(peer_id, type);
    };

    handleBye = () => {
        this.signaling.bye();
    };

    /**
     * video open/close
     */
    onVideoOnClickHandler = () => {
        let video_muted = !this.state.video_muted;
        this.onToggleLocalVideoTrack(video_muted);
        this.setState({ video_muted });
    };

    onToggleLocalVideoTrack = (muted) => {
        const videoTracks = this.state.localStream.getVideoTracks();
        if (videoTracks.length === 0) {
            console.log("No local video available.");
            return;
        }
        console.log("Toggling video mute state.");
        for (var i = 0; i < videoTracks.length; ++i) {
            videoTracks[i].enabled = !muted;
        }
    };

    /**
     * mic open/close
     */
    onAudioClickHandler = () => {
        let audio_muted = !this.state.audio_muted;
        this.onToggleLocalAudioTrack(audio_muted);
        this.setState({ audio_muted });
    };


    onToggleLocalAudioTrack = (muted) => {
        const audioTracks = this.state.localStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.log("No local audio available.");
            return;
        }
        console.log("Toggling audio mute state.");
        for (var i = 0; i < audioTracks.length; ++i) {
            audioTracks[i].enabled = !muted;
        }
    };

    render() {
        const { classes } = this.props;
        return (
            <MuiThemeProvider theme={theme}>
                <div className={classes.root}>
                    <CircularProgress />
                    <h5 style={{ marginLeft: '-35%' }}>Waiting for an interlocutor...</h5>
                    <Dialog
                        fullScreen
                        open={this.state.open}
                        onClose={this.handleClose}
                        TransitionComponent={Transition}
                    >
                        <AppBar className={classes.appBar}>
                            <Toolbar>
                                <Typography variant="title" color="inherit" className={classes.flex}>
                                    Calling
                                </Typography>
                            </Toolbar>
                        </AppBar>
                        <div>
                            {
                                this.state.remoteStream != null ?
                                    <RemoteVideoView stream={this.state.remoteStream} id={'remoteview'} /> : null
                            }
                            {
                                this.state.localStream != null ?
                                    <LocalVideoView stream={this.state.localStream} muted={this.state.video_muted}
                                        id={'localview'} /> : null
                            }
                        </div>
                        <div className={css.btnTools}>
                            <Button variant="fab" mini color="primary" aria-label="add" style={styles.btnTool}
                                onClick={this.onVideoOnClickHandler}>
                                {
                                    this.state.video_muted ? <VideoOffIcon /> : <VideoOnIcon />
                                }
                            </Button>
                            <Button variant="fab" mini color="primary" aria-label="add" style={styles.btnTool}
                                onClick={this.onAudioClickHandler}>
                                {
                                    this.state.audio_muted ? <MicOffIcon /> : <MicIcon />
                                }
                            </Button>
                            <Button variant="fab" color="secondary" aria-label="add" style={styles.btnTool}
                                onClick={this.handleBye}>
                                <SkipNextRoundedIcon />
                            </Button>
                        </div>

                    </Dialog>

                </div>
            </MuiThemeProvider>
        );
    }
}

App.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(App);
