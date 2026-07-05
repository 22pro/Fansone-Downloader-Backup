const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fansoneApp', {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  setConfig: (patch) => ipcRenderer.invoke('app:set-config', patch),
  chooseDownloadDir: () => ipcRenderer.invoke('app:choose-download-dir'),
  openPath: (target) => ipcRenderer.invoke('app:open-path', target),
  getAppState: () => ipcRenderer.invoke('app:get-state'),
  setAppState: (state) => ipcRenderer.invoke('app:set-state', state),
  fetchImage: (urls) => ipcRenderer.invoke('image:fetch-first', urls),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  getSidebarAd: () => ipcRenderer.invoke('ad:get-sidebar'),
  openExternal: (target) => ipcRenderer.invoke('shell:open-external', target),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),

  authStatus: () => ipcRenderer.invoke('auth:status'),
  openLogin: () => ipcRenderer.invoke('auth:open-login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onAuthChanged: (callback) => ipcRenderer.on('auth-changed', callback),

  getSubscriptions: (params) => ipcRenderer.invoke('fansone:get-subscriptions', params),
  getPosts: (params) => ipcRenderer.invoke('fansone:get-posts', params),

  addDownloads: (posts) => ipcRenderer.invoke('download:add-posts', posts),
  listJobs: () => ipcRenderer.invoke('download:list-jobs'),
  cancelJob: (jobId) => ipcRenderer.invoke('download:cancel', jobId),
  pauseDownloads: () => ipcRenderer.invoke('download:pause'),
  resumeDownloads: () => ipcRenderer.invoke('download:resume'),
  retryFailedDownloads: () => ipcRenderer.invoke('download:retry-failed'),
  clearDownloadRecords: () => ipcRenderer.invoke('download:clear-records'),
  onDownloadEvent: (callback) => ipcRenderer.on('download-event', (_event, payload) => callback(payload))
});
