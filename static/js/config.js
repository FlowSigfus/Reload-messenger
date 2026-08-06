export let token = null;
export let currentChatId = null;
export let ws = null;
export let currentUserId = null;
export let vapidPublicKey = null;

export const WS_RECONNECT_MAX_ATTEMPTS = 10;
export const WS_RECONNECT_DELAY_BASE = 2000;

export function setToken(t) { token = t; }
export function setCurrentChatId(id) { currentChatId = id; }
export function setCurrentUserId(id) { currentUserId = id; }
export function setVapidPublicKey(key) { vapidPublicKey = key; }