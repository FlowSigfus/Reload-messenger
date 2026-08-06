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
        if (terminalVisible) terminalInput.focus();
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
        switch(command) {
            case '/chats':
                const resp = await fetch('/api/chats', { headers: { 'Authorization': `Bearer ${token}` } });
                const chats = await resp.json();
                chats.forEach(chat => addOutput(`${chat.id}: ${chat.is_group ? chat.name : chat.other_user}`));
                break;
            case '/open':
                if (args[0]) {
                    selectChat(parseInt(args[0]));
                    addOutput(`Opened chat ${args[0]}`);
                } else addOutput('Usage: /open <chat_id>', true);
                break;
            case '/send':
                if (args.length) {
                    document.getElementById('message-text').value = args.join(' ');
                    sendMessageWithFiles();
                    addOutput(`Sent: ${args.join(' ')}`);
                } else addOutput('Usage: /send <message>', true);
                break;
            case '/exit':
                toggleTerminal();
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