import './style.css'

// Firebase App (the core Firebase SDK) is always required and must be listed first
import firebase from "firebase/app";
import "firebase/firestore";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB0JCWsoLtOC9x-wgcBBsoylgBDVNs0kRQ",
  authDomain: "webrtc-demo-73dea.firebaseapp.com",
  projectId: "webrtc-demo-73dea",
  storageBucket: "webrtc-demo-73dea.appspot.com",
  messagingSenderId: "835758690976",
  appId: "1:835758690976:web:2bc5126a79b177bb7c2fc5",
  measurementId: "G-0R0HNHEX0L"
};

// firebase.apps.length = No. of firebase apps connected.
if(!firebase.apps.length){
  firebase.initializeApp(firebaseConfig);
}

// Initialize firestore
const firestore = firebase.firestore();

// Main app

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302","stun:stun2.l.google.com:19302"]
    }
  ],
  iceCandidatePoolSize: 10 // No. of ice candidates to get from these stun servers
};

// Start RTC p2p connection and gives us various event handlers.
let pc = new RTCPeerConnection(servers)

let localStream = null;
let remoteStream = null;

let globalCallId = null;

// HTML elements
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');



// 1. Setup media sources
const startWebcam = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
  remoteStream = new MediaStream();

  //  Push tracks from local steam to peer connection
  localStream.getTracks().forEach((track) =>{
    pc.addTrack(track,localStream); //Peer connection add track
  });

  // Pull track from remote stream, add to video stream
  pc.ontrack = (event) =>{
    event.streams[0].getTracks().forEach((track) =>{
      remoteStream.addTrack(track); 
    });
  }

  webcamVideo.srcObject = localStream;
  webcamVideo.muted = true;
  remoteVideo.srcObject = remoteStream;
  callButton.disabled = false;
  answerButton.disabled = false;
}

startWebcam()

//  2. Create an offer
callButton.onclick = async () =>{
  hangupButton.disabled = false;
  answerButton.disabled = true;

  //  Reference firestore collection
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  globalCallId = callDoc.id; // Generate random id from firebase
  callInput.value = globalCallId
  callInput.select();
  callInput.setSelectionRange(0, 99999); /* For mobile devices */

  answerButton.innerHTML = "Copied to clipboard"

  /* Copy the text inside the text field */
  document.execCommand("copy");

  // Listen for onicecandidate event and get ice candidates for caller, save it in db.
  pc.onicecandidate = event => {
    // If event.candidate exists, write to json in offerCandidates firestore collection
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  }
  
  //  Create offer
  const offerDescription = await pc.createOffer();  //Contains an SDP value
  await pc.setLocalDescription(offerDescription); // Sets local SDP value
  //  This also starts generating ice candidates , hence the listener above.

  //  JS object to be stored in firestore for answer
  const offer = {
    sdp : offerDescription.sdp,
    type : offerDescription.type,
  }

  //  Save offer to firestore for signaling in offer field of the call doc
  await callDoc.set({offer});


  //  After this , we wait for answer and the below code fires when an answer is recieved.
  
  //  Listen for answer from remote by listening to changes on calls collection in firestore 
  //  onSnapshot fires a callback everytime a doc change, here we define that callback function
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data()

    //  When remote answers, 
    //  Check if we dont have remote SDP , and we just got an answer, do :
    if(!pc.currentRemoteDescription && data?.answer){
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription); // Sets remote SDP value
    } 
    
    // When you get a hangup from answerer
    if(data?.hangup){
      pc.close()
      pc.onicecandidate = null;
      webcamVideo.srcObject = null;
      remoteVideo.srcObject = null;
      location.reload();
    }
  });

  //  When answered, check new doc addded to answerCandidates collection
  //  Add it to our ice candidates list
  answerCandidates.onSnapshot((snapshot)=> {
    snapshot.docChanges().forEach((change) => {
      if(change.type === 'added'){
        const candidate = new RTCIceCandidate(change.doc.data()); // Create ice candidate from the new doc in answerCandidate collection
        pc.addIceCandidate(candidate); // Add remote ice candidates to peer connection
      }
    })
  })
}



//  3. Answer the call with unique ID
//  The below code is for the answerer side (keep in mind)
answerButton.onclick = async ()=> {
  const callId = callInput.value;
  globalCallId = callId;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  // Add answer icecandidate to firestore collection
  pc.onicecandidate = event => {
    event.candidate && answerCandidates.add(event.candidate.toJSON())
  };

  const callData = (await callDoc.get()).data(); // Contains offer description
  
  const offerDescription= callData.offer; //  Offer
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription)); // Generate a Session Description from offer, 
  //  and set as remote description for a peer connection

  const answerDescription= await pc.createAnswer(); // Generate answer SDP locally
  await pc.setLocalDescription(answerDescription);  // Set it as local description for pc

  //  JS object to be stored in firestore for answer
  const answer = {
    type: answerDescription.type,
    sdp : answerDescription.sdp
  } 

  //  Add answer field to the call doc
  await callDoc.update({answer});

  // Listener on offerCandidates for when a new ice candidate is added to collection,
  // then create a ice candidate locally too.
  // (This is not required if the ice candidates are generated beforehand , so may not notice anything in firestore)
  offerCandidates.onSnapshot((snapshot)=>{
    snapshot.docChanges().forEach((change)=>{
      if(change.type === 'added'){
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    })
  })

  //  For hangup
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data()

    // When you get a hangup from the caller
    if(data?.hangup){
      pc.close()
      pc.onicecandidate = null;
      webcamVideo.srcObject = null;
      remoteVideo.srcObject = null;
      location.reload();
    }
  });

  hangupButton.disabled = false;
  answerButton.disabled = true;
}

hangupButton.onclick = async ()=>{
  //  Add hangup field true in call doc
  const callDoc = firestore.collection('calls').doc(globalCallId);
  await callDoc.update({hangup: true})

  //  Close peer connection
  pc.close()
  pc.onicecandidate = null;
  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;

  //  Reload because fuck it.
  location.reload();
}