const allAudios = new Set();

export function createAudioPlayer(audioUrl, messageId) {
    const container = document.createElement('div');
    container.className = 'custom-audio-player';
    container.dataset.msgId = messageId;

    const playBtn = document.createElement('button');
    playBtn.className = 'audio-play-btn';
    playBtn.innerHTML = '<i class="fas fa-play"></i>';

    const progressContainer = document.createElement('div');
    progressContainer.className = 'audio-progress-container';

    const progressBar = document.createElement('div');
    progressBar.className = 'audio-progress-bar';

    const timeLabel = document.createElement('span');
    timeLabel.className = 'audio-time';
    timeLabel.textContent = '0:00';

    progressContainer.appendChild(progressBar);
    container.appendChild(playBtn);
    container.appendChild(progressContainer);
    container.appendChild(timeLabel);

    const audio = new Audio(audioUrl);
    audio.preload = 'metadata';
    allAudios.add(audio);

    let isPlaying = false;

    function formatTime(sec) {
        if (isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function updateProgress() {
        if (audio.duration) {
            progressBar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
            timeLabel.textContent = formatTime(audio.currentTime);
        }
    }

    function play() {
        allAudios.forEach(a => { if (a !== audio && !a.paused) a.pause(); });
        audio.play();
        isPlaying = true;
        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    }

    function pause() {
        audio.pause();
        isPlaying = false;
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
    }

    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isPlaying) pause(); else play();
    });

        audio.addEventListener('ended', () => {
            pause();
            progressBar.style.width = '0%';
            timeLabel.textContent = formatTime(0);
            audio.currentTime = 0;
        });

        audio.addEventListener('loadedmetadata', () => {
            timeLabel.textContent = formatTime(0);
        });

        audio.addEventListener('timeupdate', updateProgress);

        progressContainer.addEventListener('click', (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            if (audio.duration) {
                audio.currentTime = percent * audio.duration;
                updateProgress();
            }
        });

        container.cleanup = () => {
            pause();
            audio.src = '';
            allAudios.delete(audio);
        };

        return container;
}
