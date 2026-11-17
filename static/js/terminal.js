import { selectChat, sendMessageWithFiles } from './chat.js';

let terminalVisible = false;
let commandHistory = [];
let historyIndex = -1;
let terminalInput, terminalOutput, terminalDiv;

export function initTerminal() {
    terminalDiv = document.getElementById('terminal');
    terminalInput = document.getElementById('terminal-input');
    terminalOutput = document.getElementById('terminal-output');
    if (!terminalDiv) return;

    window.toggleTerminal = () => {
        terminalVisible = !terminalVisible;
        terminalDiv.style.display = terminalVisible ? 'flex' : 'none';
        if (terminalVisible) terminalInput?.focus();
    };

        function addOutput(text, isError = false) {
            const line = document.createElement('div');
            line.textContent = text;
            if (isError) line.style.color = '#ff4444';
            terminalOutput.appendChild(line);
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }

        async function processCommand(cmd) {
            if (!cmd.trim()) return;
            commandHistory.push(cmd);
            historyIndex = commandHistory.length;
            addOutput(`> ${cmd}`);
            const [command, ...args] = cmd.split(' ');
            const token = localStorage.getItem('token');

            switch (command) {
                case '/chats': {
                    const resp = await fetch('/api/chats', { headers: { 'Authorization': `Bearer ${token}` } });
                    if (!resp.ok) { addOutput('Failed to load chats', true); break; }
                    const chats = await resp.json();
                    chats.forEach(chat => addOutput(`${chat.id}: ${chat.is_group ? chat.name : chat.other_user}`));
                    break;
                }
                case '/open': {
                    if (!args[0]) { addOutput('Usage: /open <chat_id>', true); break; }
                    await selectChat(parseInt(args[0]));
                    addOutput(`Opened chat ${args[0]}`);
                    break;
                }
                case '/send': {
                    if (!args.length) { addOutput('Usage: /send <message>', true); break; }
                    const textEl = document.getElementById('message-text');
                    if (textEl) textEl.value = args.join(' ');
                    await sendMessageWithFiles();
                    addOutput(`Sent: ${args.join(' ')}`);
                    break;
                }
                case '/exit':
                    window.toggleTerminal();
                    break;
                default:
                    addOutput(`Unknown command: ${command}`, true);
            }
        }

        terminalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                processCommand(terminalInput.value);
                terminalInput.value = '';
            } else if (e.key === 'ArrowUp') {
                if (historyIndex > 0) {
                    historyIndex--;
                    terminalInput.value = commandHistory[historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    terminalInput.value = commandHistory[historyIndex];
                } else {
                    historyIndex = commandHistory.length;
                    terminalInput.value = '';
                }
            }
        });
}
