const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    on: (channel: string, func: Function) => {
        ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
});
