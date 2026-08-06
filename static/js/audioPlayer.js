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
    
    let isPlaying = false;
    let updateInterval = null;
    
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    function updateProgress() {
        if (audio.duration) {
            const percent = (audio.currentTime / audio.duration) * 100;
            progressBar.style.width = `${percent}%`;
            timeLabel.textContent = formatTime(audio.currentTime);
        }
    }
    
    function startUpdate() {
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(updateProgress, 100);
    }
    
    function stopUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
    }
    
    function play() {
        audio.play();
        isPlaying = true;
        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
        startUpdate();
    }
    
    function pause() {
        audio.pause();
        isPlaying = false;
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
        stopUpdate();
    }
    
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isPlaying) pause();
        else play();
    });
    
    audio.addEventListener('ended', () => {
        pause();
        progressBar.style.width = '0%';
        timeLabel.textContent = formatTime(0);
        audio.currentTime = 0;
    });
    
    audio.addEventListener('loadedmetadata', () => {
        timeLabel.textContent = formatTime(0);
        progressBar.style.width = '0%';
    });
    
    audio.addEventListener('timeupdate', updateProgress);
    
    progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = x / rect.width;
        if (audio.duration) {
            audio.currentTime = percent * audio.duration;
            updateProgress();
        }
    });
    
    container.cleanup = () => {
        pause();
        audio.pause();
        audio.src = '';
        if (updateInterval) clearInterval(updateInterval);
    };
    
    return container;
}