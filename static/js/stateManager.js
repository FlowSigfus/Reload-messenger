const STATE_KEY = 'messenger_state';
let saveTimeout = null;

export function saveState(state) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        const currentState = loadState();
        const newState = { ...currentState, ...state };
        localStorage.setItem(STATE_KEY, JSON.stringify(newState));
    }, 500);
}

export function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch(e) { return {}; }
    }
    return {};
}

export function clearState() {
    localStorage.removeItem(STATE_KEY);
}