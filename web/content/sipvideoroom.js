// We make use of this 'server' variable to provide the address of the
// REST Janus API. By default, in this example we assume that Janus is
// co-located with the web server hosting the HTML pages but listening
// on a different port (8088, the default for HTTP in Janus), which is
// why we make use of the 'window.location.hostname' base address. Since
// Janus can also do HTTPS, and considering we don't really want to make
// use of HTTP for Janus if your demos are served on HTTPS, we also rely
// on the 'window.location.protocol' prefix to build the variable, in
// particular to also change the port used to contact Janus (8088 for
// HTTP and 8089 for HTTPS, if enabled).
// In case you place Janus behind an Apache frontend (as we did on the
// online demos at http://janus.conf.meetecho.com) you can just use a
// relative path for the variable, e.g.:
//
// 		let server = "/janus";
//
// which will take care of this on its own.
//
//
// If you want to use the WebSockets frontend to Janus, instead, you'll
// have to pass a different kind of address, e.g.:
//
// 		let server = "ws://" + window.location.hostname + ":8188";
//
// Of course this assumes that support for WebSockets has been built in
// when compiling the server. WebSockets support has not been tested
// as much as the REST API, so handle with care!
//
//
// If you have multiple options available, and want to let the library
// autodetect the best way to contact your server (or pool of servers),
// you can also pass an array of servers, e.g., to provide alternative
// means of access (e.g., try WebSockets first and, if that fails, fall
// back to plain HTTP) or just have failover servers:
//
//		let server = [
//			"ws://" + window.location.hostname + ":8188",
//			"/janus"
//		];
//
// This will tell the library to try connecting to each of the servers
// in the presented order. The first working server will be used for
// the whole session.
//

let server = null;
if(window.location.protocol === 'http:') {
	server = "http://" + window.location.hostname + ":8088/janus";
} else {
	server = "https://" + window.location.hostname + ":8089/janus";
}

let janus = null,
	sipcall = null,

	// VideRoom related stuff
	videocall = null,
	myusername = null,
	myid = null,
	mystream = null,
	// We use this other ID just to map our subscriptions to us
	mypvtid = null,

	sipOpaqueId = "sipvideoroom-" + Janus.randomString(12),
	videoroomOpaqueId = "sipvideoroom-" + Janus.randomString(12),

	spinner = null,

	selectedApproach = null,
	registered = false,
	masterId = null, 
	helpers = {}, 
	helpersCount = 0,

	incoming = null;

$(document).ready(function() {

	$('#start_1').click(function() {
		JanusProcess('700000100001', (err, res) => {
			if (err) {
				console.log("[SipVideoRoom] Error: " + err);
				return;
			}
			console.log("[SipVideoRoom] " + res);
		});
	});

	$('#start_2').click(function() {
		JanusProcess('700000100002', (err, res) => {
			if (err) {
				bootbox.alert(err);
				return;
			}
			console.log("[SipVideoRoom] " + res);
		});
	});

	$('#start_3').click(function() {
		JanusProcess('700000100003', (err, res) => {
			if (err) {
				bootbox.alert(err);
				return;
			}
			console.log("[SipVideoRoom] " + res);
		});
	});


	// Initialize the library (all console debuggers enabled)
	
});


function JanusProcess(account, callback) {

	// Destroy all previous versions of Janus 
	if (janus !== null && typeof(janus.destroy) === 'function') {
		janus.destroy();
	}
	
	Janus.init({debug: "all", callback: function() {

		// Make sure the browser supports WebRTC
		if(!Janus.isWebrtcSupported()) {
			callback("[JanusProcess] No WebRTC support... ", null);
			return;
		}
		// Create session
		janus = new Janus({
				server: server,
				success: function() {
					// Attach to SIP plugin
					janus.attach({
						plugin: "janus.plugin.sip",
						opaqueId: sipOpaqueId,
						success: function(pluginHandle) {
							sipcall = pluginHandle;
							Janus.log("[SipVideoRoom] Plugin attached! (" + sipcall.getPlugin() + ", id=" + sipcall.getId() + ")");

							$("#start_1").hide();
							$("#start_2").hide();
							$("#start_3").hide();

							$("#account_name").html("Using account: " + account);
							
							// Prepare the username registration
							registerUsername(account);
							callback(null, "[SipVideoRoom] RegisterUsername started...");
						},
						error: function(error) {
							callback("[SipVideoRoom]  -- Error attaching plugin..." + error, null);
							return;
						},
						iceState: function(state) {
							Janus.log("[SipVideoRoom] ICE state changed to " + state);
						},
						mediaState: function(medium, on) {
							Janus.log("[SipVideoRoom] Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
						},
						webrtcState: function(on) {
							Janus.log("[SipVideoRoom] Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
							$("#audiolocal").parent().unblock();
						},
						onmessage: function(msg, jsep) {
							Janus.debug("[SipVideoRoom] ::: Got a message :::", msg);
							// Any error?
							if(msg["error"]) {
								callback("[SipVideoRoom] Message error: " + msg["error"], null);
							}
							let callId = msg["call_id"];
							let result = msg["result"];
							if(result && result["event"]) {
								let event = result["event"];
								// Event Switch

								if (event === 'registration_failed') {
									callback("[SipVideoRoom] Registration failed: " + result["code"] + " " + result["reason"], null);
									return;
								} else if (event === 'registered') {
									Janus.log("[SipVideoRoom] Successfully registered as " + result["username"] + ", calling...");

									// Time to make a call to ConfBridge!
									doSipAudioCall(number_to_dial); 

								} else if(event === 'calling') {
									Janus.log("[SipVideoRoom] Waiting for the peer to answer...");
									// Show "Hangup" button
									$('#hangup').removeAttr('disabled').removeClass('hidden').click(doHangup);
									// TODO Any ringtone?
								} else if (event === 'incomingcall') {
									Janus.log("Incoming call from " + result["username"] + ", ignoring....");										
								} else if(event === 'accepting') {
									// Response to an offerless INVITE, var's wait for an 'accepted'
									Janus.log("accepting from " + JSON.stringify(result) + ", continue....");
								} else if(event === 'progress') {
									Janus.log("[SipVideoRoom] There's early media from " + result["username"] + ", wairing for the call!", jsep);
									// Call can start already: handle the remote answer
									if(jsep) {
										sipcall.handleRemoteJsep({ jsep: jsep, error: doHangup });
									}
									toastr.info("Early media...");
								} else if(event === 'accepted') {
									Janus.log("[SipVideoRoom] " + result["username"] + " accepted the call!", jsep);
									// Call can start, now: handle the remote answer
									if(jsep) {
										sipcall.handleRemoteJsep({ 
											jsep: jsep, 
											error: doHangup 
										});
									}
									sipcall.callId = callId;

								} else if (event === 'updatingcall') {
									// We got a re-INVITE: while we may prompt the user (e.g.,
									// to notify about media changes), to keep things simple
									// we just accept the update and send an answer right away
									Janus.log("[SipVideoRoom] Got re-INVITE");
									let doAudio = (jsep.sdp.indexOf("m=audio ") > -1),
										doVideo = (jsep.sdp.indexOf("m=video ") > -1);
									sipcall.createAnswer(
										{
											jsep: jsep,
											media: { audio: doAudio, video: doVideo },
											success: function(jsep) {
												Janus.debug("[SipVideoRoom] Got SDP " + jsep.type + "! audio=" + doAudio + ", video=" + doVideo + ":", jsep);
												let body = { request: "update" };
												sipcall.send({ message: body, jsep: jsep });
											},
											error: function(error) {
												Janus.log("[SipVideoRoom] WebRTC error... " + error.message, null);
											}
										});
								} else if (event === 'message') {
									// We got a MESSAGE
									Janus.log('[SipVideoRoom] Got message ' + JSON.stringify(result));
								} else if(event === 'info') {
									// We got an INFO
									Janus.log('[SipVideoRoom] Got info ' + JSON.stringify(result));
								} else if(event === 'notify') {
									Janus.log('[SipVideoRoom] Got notify ' + JSON.stringify(result));
								} else if(event === 'transfer') {
									Janus.log('[Sip] Got a transfer reqeuest, ignoring :' + JSON.stringify(result));
								} else if(event === 'hangup') {
									Janus.log("[SipVideoRoom] Call hung up (" + result["code"] + " " + result["reason"] + ")!");
									// Reset status
									sipcall.hangup();
									$('#myvideo').remove();
									$('#videos').hide();
								}
							}
						},
// Local Stream part						
						onlocalstream: function(stream) {
							Janus.debug("[SipVideoRoom] ::: Got a local audio stream, doing nothing", stream);
						},
// Remote stream part
						onremotestream: function(stream) {
							Janus.debug("[SipVideoRoom] ::: Got a remote audio stream :::", stream);
							
							$('#audioremote').removeClass('hide').show();
							if($('#remoteaudio').length === 0) {
								$('#audioremote').append(
									'<audio class="rounded centered" id="remoteaudio" autoplay/>'
								);
							}

							Janus.debug("[SipVideoRoom] Attaching remote stream to #remoteaudio container");
							Janus.attachMediaStream($('#remoteaudio').get(0), stream);

							// Show video button
							$('#videostart').removeClass('hidden').unbind('click').click(() => {
								startVideo(account);
							});
						},
// End streams part
						oncleanup: function() {
							Janus.log("[SipVideoRoom] ::: Got a cleanup notification :::");
							if(sipcall)
								sipcall.callId = null;
						}
					});
				},
				error: function(error) {
					callback(error, null);
					return;
				},
				destroyed: function() {
					window.location.reload();
				}
		});
	}});
}

function registerUsername(account) {
	// Try a registration
	let register = {
		request: "register",
		username: "sip:" + account + "@" + sip_proxy,
		authuser: account,
		display_name: "Test " + account,
		secret: account,
		proxy: "sip:" + sip_proxy + ":" + sip_proxy_port,
	};

	sipcall.send({ message: register });
}

function doSipAudioCall(destination) {

	Janus.log("[SipVideoRoom] This is a SIP audio call to " + destination);

	sipcall.createOffer(
		{
			media: {
				audioSend: true, 
				audioRecv: true,		// We DO want audio
				videoSend: false, 
				videoRecv: false		// We DO NOT want video
			},
			success: function(jsep) {
				Janus.debug("[SipVideoRoom] Got SDP!", jsep);
				let body = { 
					request: "call", 
					uri: "sip:" + destination + "@" + sip_proxy + ":" + sip_proxy_port, 
				};
				sipcall.send({ 
					message: body, 
					jsep: jsep 
				});
			},
			error: function(error) {
				Janus.error("[SipVideoRoom][actuallyDoCall] No SSL on host? WebRTC error...", error);
			}
		});
}

function doHangup() {

	let hangup = { 
		request: "hangup" 
	};
	Janus.debug("[SipVideoRoom][doHangup] Call hangup...");
	sipcall.send({ message: hangup });
	sipcall.hangup();
	window.location.reload();
}


// ******************** VIDEO PART **************************

// **********************************************************
// **********************************************************
// **********************************************************
// **********************************************************
// **********************************************************
// **********************************************************
// **********************************************************

function startVideo(account) {

	$("#videostart").hide();

	Janus.debug("[SipVideoRoom][startVideo] Starting videoRoom plugin...");

	$('#videos').removeClass('hide').show();

	// Attach to VideoRoom plugin	
	janus.attach(
		{
			plugin: "janus.plugin.videoroom",
			opaqueId: videoroomOpaqueId,
			success: function(pluginHandle) {

				videocall = pluginHandle;
				Janus.log("[SipVideoRoom][startVideo] Plugin attached! (" + videocall.getPlugin() + ", id=" + videocall.getId() + ")");
				Janus.log("[SipVideoRoom][startVideo]  -- This is a publisher/manager");
				// Prepare the username registration

				let joinRequest = {
					request: "join",
					room: videoroom,
					ptype: "publisher",
					display: account
				};
				myusername = account;
				videocall.send({ 
					message: joinRequest 
				});
			},
			error: function(error) {
				Janus.error("[SipVideoRoom][startVideo]   -- Error attaching plugin...", error);
				bootbox.alert("[SipVideoRoom][startVideo] Error attaching plugin... " + error);
			},
			consentDialog: function(on) {
				Janus.debug("[SipVideoRoom][startVideo] Consent dialog should be " + (on ? "on" : "off") + " now");
			},
			iceState: function(state) {
				Janus.log("[SipVideoRoom][startVideo] ICE state changed to " + state);
			},
			mediaState: function(medium, on) {
				Janus.log("[SipVideoRoom][startVideo] Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
				$("#videolocal").parent().parent().unblock();
				if (!on) {
					return;
				}
				$('#publish').remove();
			},
			webrtcState: function(on) {
				Janus.log("[SipVideoRoom][startVideo] Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
			},
			onmessage: function(msg, jsep) {
				Janus.debug("[SipVideoRoom][startVideo] ::: Got a message (publisher) :::", msg);
				
				let event = msg["videoroom"];
				Janus.debug("[SipVideoRoom][startVideo] Event: " + event);

				if(event) {
					if(event === "joined") {
						// Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
						myid = msg["id"];
						mypvtid = msg["private_id"];
						Janus.log("[SipVideoRoom][startVideo] Successfully joined room " + msg["room"] + " with ID " + myid);

						publishOwnFeed();

						// Any new feed to attach to?
						if(msg["publishers"]) {
							let list = msg["publishers"];
							Janus.debug("[SipVideoRoom][startVideo] Got a list of available publishers/feeds:", list);
							for(let f in list) {
								let id = list[f]["id"];
								let display = list[f]["display"];
								let audio = list[f]["audio_codec"];
								let video = list[f]["video_codec"];
								Janus.debug("[SipVideoRoom][startVideo]   >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
								newRemoteFeed(id, display, audio, video);
							}
						}
					} else if(event === "destroyed") {
						// The room has been destroyed
						Janus.warn("[SipVideoRoom][startVideo] The room has been destroyed!");
					} else if(event === "event") {
						// Any new feed to attach to?
						if(msg["publishers"]) {
							let list = msg["publishers"];
							Janus.debug("[SipVideoRoom][startVideo] Got a list of available publishers/feeds:", list);
							for(let f in list) {
								let id = list[f]["id"];
								let display = list[f]["display"];
								let audio = list[f]["audio_codec"];
								let video = list[f]["video_codec"];
								Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
								newRemoteFeed(id, display, audio, video);
							}
						} else if(msg["leaving"]) {
							// One of the publishers has gone away?
							let leaving = msg["leaving"];
							Janus.log("[SipVideoRoom][startVideo] Publisher left: " + leaving);
							let remoteFeed = null;
							for(let i=1; i<6; i++) {
								if(feeds[i] && feeds[i].rfid == leaving) {
									remoteFeed = feeds[i];
									break;
								}
							}
							if(remoteFeed != null) {
								Janus.debug("[SipVideoRoom][startVideo] Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
								$('#remote'+remoteFeed.rfindex).empty().hide();
								$('#videoremote'+remoteFeed.rfindex).empty();
								feeds[remoteFeed.rfindex] = null;
								remoteFeed.detach();
							}
						} else if(msg["unpublished"]) {
							// One of the publishers has unpublished?
							let unpublished = msg["unpublished"];
							Janus.log("[SipVideoRoom][startVideo] Publisher left: " + unpublished);
							if(unpublished === 'ok') {
								// That's us
								videocall.hangup();
								return;
							}
							let remoteFeed = null;
							for(let i=1; i < 6; i++) {
								if(feeds[i] && feeds[i].rfid == unpublished) {
									remoteFeed = feeds[i];
									break;
								}
							}
							if(remoteFeed != null) {
								Janus.debug("[SipVideoRoom][startVideo] Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
								$('#remote'+remoteFeed.rfindex).empty().hide();
								$('#videoremote'+remoteFeed.rfindex).empty();
								feeds[remoteFeed.rfindex] = null;
								remoteFeed.detach();
							}
						} else if(msg["error"]) {
							Janus.log("[SipVideoRoom][startVideo] Error(" +msg["error_code"] + "): " + msg["error"]);
						}
					}
				}
				if(jsep) {
					Janus.debug("[SipVideoRoom][startVideo] Handling SDP as well...", jsep);
					videocall.handleRemoteJsep({ 
						jsep: jsep 
					});

					let video = msg["video_codec"];
					if(mystream && mystream.getVideoTracks() && mystream.getVideoTracks().length > 0 && !video) {
						// Video has been rejected
						Janus.log("[SipVideoRoom][startVideo] Our video stream has been rejected, viewers won't see us");
						// Hide the webcam video
						$('#myvideo').hide();
						$('#videolocal').append(
							'<div class="no-video-container">' +
								'<i class="fa fa-video-camera fa-5 no-video-icon" style="height: 100%;"></i>' +
								'<span class="no-video-text" style="font-size: 16px;">Video rejected, no webcam</span>' +
							'</div>');
					}
				}
			},
			onlocalstream: function(stream) {
				
				Janus.debug("[SipVideoRoom][startVideo]  ::: Got a local stream :::", stream);
				
				mystream = stream;
				$('#videos').removeClass('hide').show();
				if($('#myvideo').length === 0) {
					$('#videolocal').append('<video class="rounded centered" id="myvideo" width="100%" height="100%" autoplay playsinline muted="muted"/>');
					// Add an 'unpublish' button
					$('#videolocal').append('<button class="btn btn-warning btn-xs" id="unpublish" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;">Unpublish</button>');
					$('#unpublish').click(unpublishOwnFeed);
				}
				$('#publisher').removeClass('hide').show();

				Janus.attachMediaStream($('#myvideo').get(0), stream);

				if(videocall.webrtcStuff.pc.iceConnectionState !== "completed" &&
						videocall.webrtcStuff.pc.iceConnectionState !== "connected") {
					$("#videolocal").parent().parent().block({
						message: '<b>Publishing...</b>',
						css: {
							border: 'none',
							backgroundColor: 'transparent',
							color: 'white'
						}
					});
				}
				let videoTracks = stream.getVideoTracks();
				if(!videoTracks || videoTracks.length === 0) {
					// No webcam
					$('#myvideo').hide();
					if($('#videolocal .no-video-container').length === 0) {
						$('#videolocal').append(
							'<div class="no-video-container">' +
								'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
								'<span class="no-video-text">No webcam available</span>' +
							'</div>');
					}
				} else {
					$('#videolocal .no-video-container').remove();
					$('#myvideo').removeClass('hide').show();
				}
			},
			onremotestream: function(stream) {
				// The publisher stream is sendonly, we don't expect anything here
				Janus.log("[SipVideoRoom][startVideo] onremotestream > The publisher stream is sendonly, we don't expect anything here");
			},
			oncleanup: function() {
				Janus.log("[SipVideoRoom][startVideo] ::: Got a cleanup notification: we are unpublished now :::");
				mystream = null;
				$('#videolocal').html('<button id="publish" class="btn btn-primary">Publish</button>');
				$('#publish').click(function() { 
					publishOwnFeed(); 
				});
				$("#videolocal").parent().parent().unblock();
			}
		});
}




function publishOwnFeed() {

	videocall.createOffer(
		{
			// Add data:true here if you want to publish datachannels as well
			media: { 
				audioRecv: false, 
				videoRecv: false, 
				audioSend: false, 
				videoSend: true 
			},	// Publishers are sendonly
			// If you want to test simulcasting (Chrome and Firefox only), then
			// pass a ?simulcast=true when opening this demo page: it will turn
			// the following 'simulcast' property to pass to janus.js to true

			success: function(jsep) {
				Janus.debug("[SipVideoRoom][startVideo] publishOwnFeed Got publisher SDP!", jsep);
				let publish = { 
					request: "configure", 
					audio: false, 
					video: true 
				};
				// You can force a specific codec to use when publishing by using the
				// audiocodec and videocodec properties, for instance:
				// 		publish["audiocodec"] = "opus"
				// to force Opus as the audio codec to use, or:
				// 		publish["videocodec"] = "vp9"
				// to force VP9 as the videocodec to use. In both case, though, forcing
				// a codec will only work if: (1) the codec is actually in the SDP (and
				// so the browser supports it), and (2) the codec is in the list of
				// allowed codecs in a room. With respect to the point (2) above,
				// refer to the text in janus.plugin.videoroom.jcfg for more details
				videocall.send({ 
					message: publish,
					jsep: jsep
				});
			},
			error: function(error) {
				Janus.error("[SipVideoRoom][startVideo] publishOwnFeed WebRTC error:", error);
			}
		});
}

function unpublishOwnFeed() {
	// Unpublish our stream
	let unpublish = { 
		request: "unpublish" 
	};
	videocall.send({ 
		message: unpublish 
	});
}

function newRemoteFeed(id, display, audio, video) {

	// A new feed has been published, create a new plugin handle and attach to it as a subscriber
	let remoteFeed = null;

	janus.attach({
			plugin: "janus.plugin.videoroom",
			opaqueId: videoroomOpaqueId,
			success: function(pluginHandle) {
				remoteFeed = pluginHandle;
				remoteFeed.simulcastStarted = false;
				Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
				Janus.log("  -- This is a subscriber");
				// We wait for the plugin to send us an offer
				let subscribe = {
					request: "join",
					room: videoroom,
					ptype: "subscriber",
					feed: id,
					private_id: mypvtid
				};
				// In case you don't want to receive audio, video or data, even if the
				// publisher is sending them, set the 'offer_audio', 'offer_video' or
				// 'offer_data' properties to false (they're true by default), e.g.:
				// 		subscribe["offer_video"] = false;
				// For example, if the publisher is VP8 and this is Safari, let's avoid video
				if(Janus.webRTCAdapter.browserDetails.browser === "safari" &&
						(video === "vp9"
						|| (video === "vp8" 
							&& !Janus.safariVp8))) {
					if(video) {
						video = video.toUpperCase()
					}
					Janus.log("[SipVideoRoom][newRemoteFeed] Publisher is using " + video + ", but Safari doesn't support it: disabling video");
					subscribe["offer_video"] = false;
				}
				remoteFeed.videoCodec = video;
				remoteFeed.send({ message: subscribe });
			},
			error: function(error) {
				Janus.error("[SipVideoRoom][newRemoteFeed] -- Error attaching plugin...", error);
			},
			onmessage: function(msg, jsep) {
				Janus.debug("[SipVideoRoom][newRemoteFeed]::: Got a message (subscriber) :::", msg);
				let event = msg["videoroom"];
				Janus.debug("Event: " + event);
				if(msg["error"]) {
					bootbox.alert(msg["error"]);
				} else if(event) {
					if(event === "attached") {
						// Subscriber created and attached
						for(let i=1;i<6;i++) {
							if(!feeds[i]) {
								feeds[i] = remoteFeed;
								remoteFeed.rfindex = i;
								break;
							}
						}
						remoteFeed.rfid = msg["id"];
						remoteFeed.rfdisplay = msg["display"];
						if(!remoteFeed.spinner) {
							let target = document.getElementById('videoremote'+remoteFeed.rfindex);
							remoteFeed.spinner = new Spinner({top:100}).spin(target);
						} else {
							remoteFeed.spinner.spin();
						}
						Janus.log("[SipVideoRoom][newRemoteFeed] Successfully attached to feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") in room " + msg["room"]);
						$('#remote'+remoteFeed.rfindex).removeClass('hide').html(remoteFeed.rfdisplay).show();
					} else if(event === "event") {
						Janus.log("[SipVideoRoom][newRemoteFeed] Got event: " + msg);
						// Check if we got an event on a simulcast-related event from this publisher
						// let substream = msg["substream"];
						// let temporal = msg["temporal"];
						// if((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
						// 	if(!remoteFeed.simulcastStarted) {
						// 		remoteFeed.simulcastStarted = true;
						// 		// Add some new buttons
						// 		addSimulcastButtons(remoteFeed.rfindex, remoteFeed.videoCodec === "vp8" || remoteFeed.videoCodec === "h264");
						// 	}
						// 	// We just received notice that there's been a switch, update the buttons
						// 	updateSimulcastButtons(remoteFeed.rfindex, substream, temporal);
						// }
					} else {
						Janus.log("[SipVideoRoom][newRemoteFeed] What has just happened?");
						// What has just happened?
					}
				}
				if(jsep) {
					Janus.debug("[SipVideoRoom][newRemoteFeed] Handling SDP as well...", jsep);
					// Answer and attach
					remoteFeed.createAnswer(
						{
							jsep: jsep,
							// Add data:true here if you want to subscribe to datachannels as well
							// (obviously only works if the publisher offered them in the first place)
							media: { 
								audioSend: false, 
								videoSend: false 
							},	// We want recvonly audio/video
							success: function(jsep) {
								Janus.debug("[SipVideoRoom][newRemoteFeed] Got SDP!", jsep);
								let body = { 
									request: "start", 
									room: videoroom 
								};
								remoteFeed.send({ 
									message: body, 
									jsep: jsep 
								});
							},
							error: function(error) {
								Janus.error("[SipVideoRoom][newRemoteFeed] WebRTC error:", error);
							}
						});
				}
			},
			iceState: function(state) {
				Janus.log("[SipVideoRoom][newRemoteFeed]  ICE state of this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") changed to " + state);
			},
			webrtcState: function(on) {
				Janus.log("[SipVideoRoom][newRemoteFeed]  Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
			},
			onlocalstream: function(stream) {
				// The subscriber stream is recvonly, we don't expect anything here
			},
			onremotestream: function(stream) {
				Janus.debug("[SipVideoRoom][newRemoteFeed]  Remote feed #" + remoteFeed.rfindex + ", stream:", stream);
				let addButtons = false;
				if($('#remotevideo'+remoteFeed.rfindex).length === 0) {
					addButtons = true;
					// No remote video yet
					$('#videoremote'+remoteFeed.rfindex).append('<video class="rounded centered" id="waitingvideo' + remoteFeed.rfindex + '" width=320 height=240 />');
					$('#videoremote'+remoteFeed.rfindex).append('<video class="rounded centered relative hide" id="remotevideo' + remoteFeed.rfindex + '" width="100%" height="100%" autoplay playsinline/>');
					$('#videoremote'+remoteFeed.rfindex).append(
						'<span class="label label-primary hide" id="curres'+remoteFeed.rfindex+'" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;"></span>' +
						'<span class="label label-info hide" id="curbitrate'+remoteFeed.rfindex+'" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;"></span>');
					// Show the video, hide the spinner and show the resolution when we get a playing event
					$("#remotevideo"+remoteFeed.rfindex).bind("playing", function () {
						if(remoteFeed.spinner)
							remoteFeed.spinner.stop();
						remoteFeed.spinner = null;
						$('#waitingvideo'+remoteFeed.rfindex).remove();
						if(this.videoWidth)
							$('#remotevideo'+remoteFeed.rfindex).removeClass('hide').show();
						let width = this.videoWidth;
						let height = this.videoHeight;
						$('#curres'+remoteFeed.rfindex).removeClass('hide').text(width+'x'+height).show();
						if(Janus.webRTCAdapter.browserDetails.browser === "firefox") {
							// Firefox Stable has a bug: width and height are not immediately available after a playing
							setTimeout(function() {
								let width = $("#remotevideo"+remoteFeed.rfindex).get(0).videoWidth;
								let height = $("#remotevideo"+remoteFeed.rfindex).get(0).videoHeight;
								$('#curres'+remoteFeed.rfindex).removeClass('hide').text(width+'x'+height).show();
							}, 2000);
						}
					});
				}
				Janus.attachMediaStream($('#remotevideo'+remoteFeed.rfindex).get(0), stream);
				let videoTracks = stream.getVideoTracks();
				if(!videoTracks || videoTracks.length === 0) {
					// No remote video
					$('#remotevideo'+remoteFeed.rfindex).hide();
					if($('#videoremote'+remoteFeed.rfindex + ' .no-video-container').length === 0) {
						$('#videoremote'+remoteFeed.rfindex).append(
							'<div class="no-video-container">' +
								'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
								'<span class="no-video-text">No remote video available</span>' +
							'</div>');
					}
				} else {
					$('#videoremote'+remoteFeed.rfindex+ ' .no-video-container').remove();
					$('#remotevideo'+remoteFeed.rfindex).removeClass('hide').show();
				}
				// if(!addButtons)
				// 	return;
				// if(	Janus.webRTCAdapter.browserDetails.browser === "chrome" 
				// 	|| Janus.webRTCAdapter.browserDetails.browser === "firefox" 
				// 	|| Janus.webRTCAdapter.browserDetails.browser === "safari") {
				// 	$('#curbitrate'+remoteFeed.rfindex).removeClass('hide').show();
				// 	bitrateTimer[remoteFeed.rfindex] = setInterval(function() {
				// 		// Display updated bitrate, if supported
				// 		let bitrate = remoteFeed.getBitrate();
				// 		$('#curbitrate'+remoteFeed.rfindex).text(bitrate);
				// 		// Check if the resolution changed too
				// 		let width = $("#remotevideo"+remoteFeed.rfindex).get(0).videoWidth;
				// 		let height = $("#remotevideo"+remoteFeed.rfindex).get(0).videoHeight;
				// 		if(width > 0 && height > 0)
				// 			$('#curres'+remoteFeed.rfindex).removeClass('hide').text(width+'x'+height).show();
				// 	}, 1000);
				// }
			},
			oncleanup: function() {
				Janus.log("[SipVideoRoom][newRemoteFeed] ::: Got a cleanup notification (remote feed " + id + ") :::");
				if(remoteFeed.spinner) {
					remoteFeed.spinner.stop();
				}
				remoteFeed.spinner = null;
				$('#remotevideo'+remoteFeed.rfindex).remove();
				$('#waitingvideo'+remoteFeed.rfindex).remove();
				$('#novideo'+remoteFeed.rfindex).remove();

				// $('#curres'+remoteFeed.rfindex).remove();
				// if(bitrateTimer[remoteFeed.rfindex] !== null && bitrateTimer[remoteFeed.rfindex] !== null)
				// 	clearInterval(bitrateTimer[remoteFeed.rfindex]);
				// bitrateTimer[remoteFeed.rfindex] = null;
				// remoteFeed.simulcastStarted = false;
				// $('#simulcast'+remoteFeed.rfindex).remove();
			}
		});
}