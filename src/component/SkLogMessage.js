const logLevel = 'debug'; // Can be 'debug', 'info', etc.

export function LogMessage(level, message) {
    //const levels = ['debug', 'info', 'warn', 'error'];
    const levels = ['warn', 'error'];
    if (levels.indexOf(level) >= levels.indexOf(logLevel)) {
        console.log(`[${level.toUpperCase()}] ${message}`);
    }
}
