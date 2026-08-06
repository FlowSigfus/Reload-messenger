import { token, currentChatId } from './config.js';
import { sendWebSocketMessage } from './websocket.js';

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStartTime = null;
let recordingTimer = null;

export async function toggleRecording() {
    if (isRecording) stopRecording();
    else startRecording();
}

function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        let mimeType = '';
        if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';

        const options = mimeType ? { mimeType } : undefined;
        mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();
        audioChunks = [];

        const micBtn = document.getElementById('mic-btn');
        micBtn.classList.add('mic-recording');

        recordingTimer = setInterval(() => {
            const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
            console.log(`Recording: ${duration}s`);
        }, 1000);

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            clearInterval(recordingTimer);
            const extension = mimeType.includes('mp4') ? 'mp4' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
            const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
            const formData = new FormData();
            formData.append('file', audioBlob, `voice_${Date.now()}.${extension}`);
            formData.append('token', token);

            try {
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (res.ok && currentChatId) {
                    sendWebSocketMessage({
                        type: 'file',
                        chat_id: currentChatId,
                        file_url: data.file_url,
                        file_type: 'audio'
                    });
                } else {
                    console.error('Upload failed', data);
                }
            } catch (err) {
                console.error('Upload error', err);
            }

            stream.getTracks().forEach(track => track.stop());
            isRecording = false;
            micBtn.classList.remove('mic-recording');
        };
    })
    .catch(err => console.error('Microphone error:', err));
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}