import { token, currentChatId } from './config.js';
import { sendWebSocketMessage } from './websocket.js';

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStartTime = null;
let recordingTimer = null;

export async function toggleRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
        alert(
            'Микрофон недоступен: нужен HTTPS.\n' +
            'Для локальной сети — настрой mkcert на сервере.\n' +
            'Для интернета — домен + SSL.'
        );
        return;
    }
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

        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();
        audioChunks = [];

        const micBtn = document.getElementById('mic-btn');
        micBtn?.classList.add('mic-recording');

        recordingTimer = setInterval(() => {
            console.log(`Recording: ${Math.floor((Date.now() - recordingStartTime) / 1000)}s`);
        }, 1000);

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            clearInterval(recordingTimer);
            const ext = mimeType.includes('mp4') ? 'mp4' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
            const blob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
            const formData = new FormData();
            formData.append('file', blob, `voice_${Date.now()}.${ext}`);
            formData.append('token', token);

            try {
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json().catch(() => ({}));
                if (res.ok && currentChatId) {
                    sendWebSocketMessage({
                        type: 'file',
                        chat_id: currentChatId,
                        file_url: data.file_url,
                        file_type: 'audio'
                    });
                }
            } catch (e) {
                console.error('Voice upload:', e);
            }

            stream.getTracks().forEach(t => t.stop());
            isRecording = false;
            micBtn?.classList.remove('mic-recording');
        };
    })
    .catch(err => {
        console.error('Mic error:', err);
        alert('Не удалось получить доступ к микрофону');
        isRecording = false;
        document.getElementById('mic-btn')?.classList.remove('mic-recording');
    });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}
