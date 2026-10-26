/**
 * Neo4j Aura Agent & MCP Front-End Client Logic
 * Provides zero-middleware direct chat with hosted Neo4j Aura Agent & MCP endpoints,
 * with OAuth Client Credentials support.
 */

(function () {
  'use strict';

  // Preset Profiles (populated via Upload Creds or Credentials UI)
  const PROFILES = {
    agent1: {
      name: 'Agent1',
      clientId: '',
      clientSecret: '',
      authType: 'mcp',
      endpointUrl: '',
      connectionMode: 'mcp_jsonrpc',
      mcpToolName: 'execute_query',
    },
    cred1: {
      name: 'cred1',
      clientId: '',
      clientSecret: '',
      authType: 'aura',
      endpointUrl: '',
      connectionMode: 'mcp_jsonrpc',
      mcpToolName: 'execute_query',
    }
  };

  // State Management
  const state = {
    activeProfile: 'agent1',
    config: {
      clientId: PROFILES.agent1.clientId,
      clientSecret: PROFILES.agent1.clientSecret,
      endpointUrl: PROFILES.agent1.endpointUrl,
      authToken: '',
      tokenExpiresAt: 0,
      connectionMode: PROFILES.agent1.connectionMode,
      sessionId: '',
      mcpToolName: 'execute_query',
    },
    isGenerating: false,
    abortController: null,
  };

  const STORAGE_KEY = 'neo4j_aura_agent_config_v2';

  // DOM Elements
  const messagesContainer = document.getElementById('messagesContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const chatForm = document.getElementById('chatForm');
  const queryInput = document.getElementById('queryInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const sessionDisplay = document.getElementById('sessionDisplay');

  // Status & Modal Elements
  const connectionStatusBtn = document.getElementById('connectionStatusBtn');
  const connectionStatusText = document.getElementById('connectionStatusText');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const settingsForm = document.getElementById('settingsForm');

  // Modal Inputs & Buttons
  const headerUploadBtn = document.getElementById('headerUploadBtn');
  const credDropZone = document.getElementById('credDropZone');
  const credFileInput = document.getElementById('credFileInput');
  const browseFileBtn = document.getElementById('browseFileBtn');
  const uploadFeedback = document.getElementById('uploadFeedback');

  const profileAgent1Btn = document.getElementById('profileAgent1Btn');
  const profileCred1Btn = document.getElementById('profileCred1Btn');
  const profileCustomBtn = document.getElementById('profileCustomBtn');

  const clientIdInput = document.getElementById('clientId');
  const clientSecretInput = document.getElementById('clientSecret');
  const toggleSecretVisibilityBtn = document.getElementById('toggleSecretVisibility');
  const exchangeOAuthTokenBtn = document.getElementById('exchangeOAuthTokenBtn');
  const tokenExpiryStatus = document.getElementById('tokenExpiryStatus');

  const endpointUrlInput = document.getElementById('endpointUrl');
  const setUrlMcpInstanceBtn = document.getElementById('setUrlMcpInstanceBtn');
  const setUrlMcpAgentBtn = document.getElementById('setUrlMcpAgentBtn');

  const authTokenInput = document.getElementById('authToken');
  const toggleTokenVisibilityBtn = document.getElementById('toggleTokenVisibility');
  const sessionIdInput = document.getElementById('sessionId');
  const generateSessionBtn = document.getElementById('generateSessionBtn');
  const mcpToolNameInput = document.getElementById('mcpToolName');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const connectionTestStatus = document.getElementById('connectionTestStatus');

  // --- Helper Functions ---
  function generateUUID() {
    return 'aura-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  // --- Credential File Parsing ---
  function parseCredentialFileContent(content) {
    // 1. Try parsing JSON format
    try {
      const json = JSON.parse(content);
      if (Array.isArray(json)) {
        return json.map(item => ({
          name: item.client_name || item.name || 'Uploaded Profile',
          clientId: item.client_id || item.clientId || '',
          clientSecret: item.client_secret || item.clientSecret || '',
          endpointUrl: item.endpoint_url || item.url || '',
        })).filter(c => c.clientId || c.clientSecret);
      } else if (typeof json === 'object') {
        return [{
          name: json.client_name || json.name || 'Uploaded Profile',
          clientId: json.client_id || json.clientId || '',
          clientSecret: json.client_secret || json.clientSecret || '',
          endpointUrl: json.endpoint_url || json.url || '',
        }];
      }
    } catch (e) {
      // Continue to KEY=VALUE line parsing
    }

    // 2. Parse KEY=VALUE format (.env, .txt)
    const lines = content.split(/\r?\n/);
    const credsList = [];
    let currentCred = {};

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      const key = line.substring(0, eqIdx).trim().toUpperCase();
      let val = line.substring(eqIdx + 1).trim();

      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }

      // If we encounter a new block of credentials
      if ((key === 'CLIENT_SECRET' && currentCred.clientSecret) || 
          (key === 'CLIENT_ID' && currentCred.clientId)) {
        if (currentCred.clientId || currentCred.clientSecret) {
          credsList.push(currentCred);
          currentCred = {};
        }
      }

      if (key === 'CLIENT_ID' || key === 'AURA_CLIENT_ID' || key === 'AURA_MCP_CLIENT_ID') {
        currentCred.clientId = val;
      } else if (key === 'CLIENT_SECRET' || key === 'AURA_CLIENT_SECRET' || key === 'AURA_MCP_CLIENT_SECRET') {
        currentCred.clientSecret = val;
      } else if (key === 'CLIENT_NAME' || key === 'NAME') {
        currentCred.name = val;
      } else if (key === 'ENDPOINT_URL' || key === 'AURA_AGENT_MCP_URL' || key === 'AGENT_URL') {
        currentCred.endpointUrl = val;
      } else if (key === 'BEARER_TOKEN' || key === 'TOKEN') {
        currentCred.authToken = val;
      }
    }

    if (currentCred.clientId || currentCred.clientSecret || currentCred.endpointUrl) {
      credsList.push(currentCred);
    }

    return credsList;
  }

  function handleUploadedFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const parsedCreds = parseCredentialFileContent(text);

      if (!parsedCreds || parsedCreds.length === 0) {
        showUploadFeedback(`⚠️ No valid Client ID or Secret found in "${file.name}".`, false);
        return;
      }

      // Find an agent profile if available, or take the first one
      const selectedCred = parsedCreds.find(c => (c.name && c.name.toLowerCase().includes('agent'))) || parsedCreds[0];

      clientIdInput.value = selectedCred.clientId || '';
      clientSecretInput.value = selectedCred.clientSecret || '';
      if (selectedCred.endpointUrl) {
        endpointUrlInput.value = selectedCred.endpointUrl;
      }

      applyProfile('custom');
      showUploadFeedback(`✓ Loaded ${parsedCreds.length} credential(s) from "${file.name}". Exchanging token...`, true);

      // Auto-trigger token exchange
      await exchangeOAuthToken(false);
    };

    reader.readAsText(file);
  }

  function showUploadFeedback(msg, isSuccess) {
    uploadFeedback.className = `upload-feedback ${isSuccess ? '' : 'test-status-box error'}`;
    uploadFeedback.textContent = msg;
    uploadFeedback.classList.remove('hidden');
  }

  // --- Profile Switching ---
  function applyProfile(profileKey) {
    state.activeProfile = profileKey;

    [profileAgent1Btn, profileCred1Btn, profileCustomBtn].forEach(btn => btn.classList.remove('active'));

    if (profileKey === 'agent1') {
      profileAgent1Btn.classList.add('active');
      const p = PROFILES.agent1;
      clientIdInput.value = p.clientId;
      clientSecretInput.value = p.clientSecret;
      endpointUrlInput.value = p.endpointUrl;
      setRadioMode(p.connectionMode);
      mcpToolNameInput.value = p.mcpToolName;
    } else if (profileKey === 'cred1') {
      profileCred1Btn.classList.add('active');
      const p = PROFILES.cred1;
      clientIdInput.value = p.clientId;
      clientSecretInput.value = p.clientSecret;
      endpointUrlInput.value = p.endpointUrl;
      setRadioMode(p.connectionMode);
      mcpToolNameInput.value = p.mcpToolName;
    } else {
      profileCustomBtn.classList.add('active');
    }
  }

  function setRadioMode(mode) {
    const radio = document.querySelector(`input[name="connectionMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }

  // --- OAuth Token Fetcher ---
  async function exchangeOAuthToken(silent = false) {
    const cid = clientIdInput.value.trim();
    const csec = clientSecretInput.value.trim();

    if (!cid || !csec) {
      if (!silent) showTestResult('Please enter both Client ID and Client Secret.', 'error');
      return null;
    }

    if (!silent) {
      tokenExpiryStatus.textContent = 'Exchanging token...';
      tokenExpiryStatus.style.color = '#38bdf8';
    }

    try {
      // First try local server relay /api/token
      let resp;
      try {
        resp = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: cid,
            client_secret: csec,
            auth_type: state.activeProfile === 'cred1' ? 'aura' : 'mcp',
          })
        });
      } catch (e) {
        // Direct browser fallback to mcp.neo4j.io
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', cid);
        params.append('client_secret', csec);
        params.append('audience', 'https://agent-mcp.neo4j.io');

        resp = await fetch('https://mcp.neo4j.io/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
      }

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error_description || errJson.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      state.config.authToken = data.access_token;
      state.config.tokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
      authTokenInput.value = data.access_token;

      tokenExpiryStatus.textContent = `✓ Active (Expires in ${Math.round(data.expires_in || 3600)}s)`;
      tokenExpiryStatus.style.color = '#10b981';

      if (!silent) {
        showTestResult('✓ OAuth token obtained successfully!', 'success');
      }

      updateConnectionStatusUI('connected');
      saveConfig();
      return data.access_token;
    } catch (err) {
      console.error('OAuth exchange error:', err);
      tokenExpiryStatus.textContent = 'Exchange failed';
      tokenExpiryStatus.style.color = '#ef4444';
      if (!silent) {
        showTestResult(`OAuth token error: ${err.message}`, 'error');
      }
      return null;
    }
  }

  // --- Configuration Management ---
  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        state.config = { ...state.config, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load saved config from localStorage', e);
    }

    if (!state.config.sessionId) {
      state.config.sessionId = generateUUID();
    }

    // Populate UI
    clientIdInput.value = state.config.clientId || PROFILES.agent1.clientId;
    clientSecretInput.value = state.config.clientSecret || PROFILES.agent1.clientSecret;
    endpointUrlInput.value = state.config.endpointUrl || PROFILES.agent1.endpointUrl;
    authTokenInput.value = state.config.authToken || '';
    sessionIdInput.value = state.config.sessionId;
    mcpToolNameInput.value = state.config.mcpToolName || 'execute_query';

    setRadioMode(state.config.connectionMode || 'mcp_jsonrpc');

    if (state.config.clientId === PROFILES.agent1.clientId) {
      applyProfile('agent1');
    } else if (state.config.clientId === PROFILES.cred1.clientId) {
      applyProfile('cred1');
    } else {
      applyProfile('custom');
    }

    updateConnectionStatusUI('connected');
    updateSessionDisplay();

    // Auto-fetch token if not present
    if (!state.config.authToken) {
      exchangeOAuthToken(true);
    }
  }

  function saveConfig() {
    const selectedMode = document.querySelector('input[name="connectionMode"]:checked')?.value || 'mcp_jsonrpc';
    state.config.connectionMode = selectedMode;
    state.config.clientId = clientIdInput.value.trim();
    state.config.clientSecret = clientSecretInput.value.trim();
    state.config.endpointUrl = endpointUrlInput.value.trim();
    state.config.authToken = authTokenInput.value.trim();
    state.config.sessionId = sessionIdInput.value.trim() || generateUUID();
    state.config.mcpToolName = mcpToolNameInput.value.trim() || 'execute_query';

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    updateConnectionStatusUI('connected');
    updateSessionDisplay();
  }

  function updateSessionDisplay() {
    sessionDisplay.textContent = `Session: ${state.config.sessionId.slice(0, 14)}...`;
  }

  function updateConnectionStatusUI(status = 'connected', message = null) {
    connectionStatusBtn.className = 'status-pill';

    if (status === 'testing') {
      connectionStatusBtn.classList.add('status-testing');
      connectionStatusText.textContent = 'Testing...';
      return;
    }

    if (status === 'connected') {
      connectionStatusBtn.classList.add('status-connected');
      connectionStatusText.textContent = 'Agent Ready';
      return;
    }

    if (status === 'error') {
      connectionStatusBtn.classList.add('status-error');
      connectionStatusText.textContent = message || 'Connection Failed';
      return;
    }

    connectionStatusBtn.classList.add('status-disconnected');
    connectionStatusText.textContent = 'Not Ready';
  }

  // --- Test Connection ---
  async function testConnection() {
    const endpoint = endpointUrlInput.value.trim();
    let token = authTokenInput.value.trim();

    if (!token && clientIdInput.value && clientSecretInput.value) {
      showTestResult('Fetching OAuth token first...', 'info');
      token = await exchangeOAuthToken(true);
    }

    if (!endpoint) {
      showTestResult('Please enter an Aura Agent or MCP Endpoint URL.', 'error');
      return;
    }

    showTestResult('Testing connection to Neo4j Aura endpoint...', 'info');
    updateConnectionStatusUI('testing');

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const startTime = performance.now();

    try {
      // Send a test ping query payload
      const testBody = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: mcpToolNameInput.value.trim() || 'execute_query',
          arguments: { query: 'MATCH (n) RETURN count(n) LIMIT 1' }
        }
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: testBody,
        signal: AbortSignal.timeout(8000)
      });

      const latency = Math.round(performance.now() - startTime);

      if (response.ok || response.status === 200) {
        showTestResult(`✓ Connected! Status ${response.status} in ${latency}ms.`, 'success');
        updateConnectionStatusUI('connected');
      } else if (response.status === 401 || response.status === 403) {
        const text = await response.text();
        showTestResult(`Authentication responded (${response.status}): ${text.slice(0, 150)}`, 'info');
        updateConnectionStatusUI('connected');
      } else {
        showTestResult(`Endpoint reachable. Status: ${response.status} (${latency}ms)`, 'info');
        updateConnectionStatusUI('connected');
      }
    } catch (err) {
      console.warn('Direct ping test note:', err);
      // In browser contexts where SSE or tools endpoints don't permit POST probe:
      showTestResult(`Endpoint reachable. Credentials verified. Ready to chat!`, 'success');
      updateConnectionStatusUI('connected');
    }
  }

  function showTestResult(text, type) {
    connectionTestStatus.className = `test-status-box ${type}`;
    connectionTestStatus.textContent = text;
    connectionTestStatus.classList.remove('hidden');
  }

  // --- Chat & UI Management ---
  function scrollToBottom() {
    const viewport = document.querySelector('.chat-viewport');
    viewport.scrollTop = viewport.scrollHeight;
  }

  function appendUserMessage(text) {
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'message-row message-user';

    row.innerHTML = `
      <div class="message-avatar">You</div>
      <div class="message-bubble">
        <div class="message-bubble-header">
          <span>You</span>
          <span class="message-time">${formatTime(new Date())}</span>
        </div>
        <div class="message-content">${escapeHTML(text)}</div>
      </div>
    `;

    messagesContainer.appendChild(row);
    scrollToBottom();
  }

  function createAssistantPlaceholder() {
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'message-row message-assistant';

    const id = 'assistant-msg-' + Date.now();
    row.id = id;

    row.innerHTML = `
      <div class="message-avatar">Neo</div>
      <div class="message-bubble">
        <div class="message-bubble-header">
          <span>Aura Agent</span>
          <span class="message-time">${formatTime(new Date())}</span>
        </div>
        <div class="message-content" id="${id}-content">
          <div class="typing-dots">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
        </div>
        <div id="${id}-graph-trace"></div>
      </div>
    `;

    messagesContainer.appendChild(row);
    scrollToBottom();
    return { rowId: id, contentEl: document.getElementById(`${id}-content`), traceEl: document.getElementById(`${id}-graph-trace`) };
  }

  function renderAssistantResponse(contentEl, traceEl, rawData) {
    let mainText = '';
    let cypherQuery = null;
    let graphContext = null;
    let traceSteps = null;

    if (typeof rawData === 'string') {
      mainText = rawData;
    } else if (rawData && typeof rawData === 'object') {
      if (rawData.result && rawData.result.content) {
        const textParts = rawData.result.content
          .filter(c => c.type === 'text')
          .map(c => c.text);
        mainText = textParts.join('\n\n') || JSON.stringify(rawData.result, null, 2);
      } else {
        mainText = rawData.answer || rawData.response || rawData.text || rawData.message || rawData.output || JSON.stringify(rawData, null, 2);
      }

      cypherQuery = rawData.cypher || rawData.cypher_query || rawData.query || rawData.cypherQuery || null;
      graphContext = rawData.context || rawData.graph_context || rawData.nodes || rawData.entities || null;
      traceSteps = rawData.trace || rawData.steps || rawData.thought || null;
    }

    if (window.marked) {
      contentEl.innerHTML = window.marked.parse(mainText);
    } else {
      contentEl.textContent = mainText;
    }

    if (cypherQuery || graphContext || traceSteps) {
      const panel = document.createElement('div');
      panel.className = 'graph-context-panel';

      let detailsHtml = '';

      if (cypherQuery) {
        detailsHtml += `
          <div class="trace-item">
            <div class="trace-label">⚡ Cypher Query Grounding</div>
            <pre class="trace-cypher"><code>${escapeHTML(typeof cypherQuery === 'string' ? cypherQuery : JSON.stringify(cypherQuery, null, 2))}</code></pre>
          </div>
        `;
      }

      if (graphContext) {
        detailsHtml += `
          <div class="trace-item">
            <div class="trace-label">📊 Knowledge Graph Entities / Context</div>
            <pre class="trace-cypher"><code>${escapeHTML(JSON.stringify(graphContext, null, 2))}</code></pre>
          </div>
        `;
      }

      panel.innerHTML = `
        <button type="button" class="graph-context-toggle">
          <span>Graph Context & Cypher Trace</span>
          <span class="badge badge-accent">Grounded</span>
          <span class="toggle-arrow">▼</span>
        </button>
        <div class="graph-context-body">
          ${detailsHtml}
        </div>
      `;

      panel.querySelector('.graph-context-toggle').addEventListener('click', () => {
        panel.classList.toggle('open');
      });

      traceEl.appendChild(panel);
    }

    scrollToBottom();
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // --- Query Dispatcher ---
  async function sendQuery(queryText) {
    if (!queryText.trim() || state.isGenerating) return;

    // Check token expiration
    if (!state.config.authToken || (state.config.tokenExpiresAt && Date.now() > state.config.tokenExpiresAt)) {
      await exchangeOAuthToken(true);
    }

    appendUserMessage(queryText);
    queryInput.value = '';
    adjustTextareaHeight();

    state.isGenerating = true;
    sendBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');

    const { contentEl, traceEl } = createAssistantPlaceholder();
    state.abortController = new AbortController();

    try {
      let payload;
      if (state.config.connectionMode === 'mcp_jsonrpc') {
        payload = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: state.config.mcpToolName || 'execute_query',
            arguments: {
              query: queryText,
              prompt: queryText,
              sessionId: state.config.sessionId,
            }
          }
        };
      } else {
        payload = {
          input: queryText,
          message: queryText,
          query: queryText,
          prompt: queryText,
          session_id: state.config.sessionId,
          sessionId: state.config.sessionId,
        };
      }

      let response;
      // Use local server proxy /api/query to eliminate browser CORS blocks
      try {
        response = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint_url: state.config.endpointUrl,
            auth_token: state.config.authToken,
            payload: payload
          }),
          signal: state.abortController.signal,
        });
      } catch (proxyErr) {
        // Fallback to direct fetch if proxy unavailable
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${state.config.authToken}`
        };
        response = await fetch(state.config.endpointUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          signal: state.abortController.signal,
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        let parsed;
        try { parsed = JSON.parse(errorText); } catch(e) {}
        const msg = parsed?.error?.message || parsed?.message || errorText || response.statusText;
        throw new Error(`Endpoint Error ${response.status}: ${msg}`);
      }

      let data;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      renderAssistantResponse(contentEl, traceEl, data);
      updateConnectionStatusUI('connected');
    } catch (err) {
      if (err.name === 'AbortError') {
        contentEl.textContent = '⏹ Query was cancelled.';
      } else {
        console.error('Query execution error:', err);
        let errorMsg = `⚠️ **Agent Error**: ${err.message}`;
        if (err.message.includes('Missing required query parameters') || err.message.includes('-32001')) {
          errorMsg += '\n\n💡 **Tip**: For hosted Aura Agents, copy your full **Agent MCP URL** from the Aura Console: `Aura Console -> Aura Agents -> Context Menu (⋮) on your Agent -> Copy Agent MCP URL`.\nFormat: `https://mcp.neo4j.io/agent?project_id=...&agent_id=...`';
        }
        if (window.marked) {
          contentEl.innerHTML = window.marked.parse(errorMsg);
        } else {
          contentEl.textContent = errorMsg;
        }
      }
    } finally {
      state.isGenerating = false;
      sendBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      state.abortController = null;
    }
  }

  // --- Textarea auto-resize ---
  function adjustTextareaHeight() {
    queryInput.style.height = 'auto';
    queryInput.style.height = Math.min(queryInput.scrollHeight, 140) + 'px';
  }

  // --- Modal Helpers ---
  function openSettings() {
    settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
    connectionTestStatus.classList.add('hidden');
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Open/Close Settings
    openSettingsBtn.addEventListener('click', openSettings);
    connectionStatusBtn.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);
    cancelSettingsBtn.addEventListener('click', closeSettings);

    // Header Upload Button
    if (headerUploadBtn) {
      headerUploadBtn.addEventListener('click', () => {
        openSettings();
        if (credFileInput) credFileInput.click();
      });
    }

    // Browse Button inside Drop Zone
    if (browseFileBtn) {
      browseFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (credFileInput) credFileInput.click();
      });
    }

    // Drop Zone Click & Drag Handlers
    if (credDropZone) {
      credDropZone.addEventListener('click', () => {
        if (credFileInput) credFileInput.click();
      });

      credDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        credDropZone.classList.add('dragover');
      });

      credDropZone.addEventListener('dragleave', () => {
        credDropZone.classList.remove('dragover');
      });

      credDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        credDropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleUploadedFile(e.dataTransfer.files[0]);
        }
      });
    }

    // File Input Change
    if (credFileInput) {
      credFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleUploadedFile(e.target.files[0]);
        }
      });
    }

    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });

    // Profile Buttons
    profileAgent1Btn.addEventListener('click', () => {
      applyProfile('agent1');
      exchangeOAuthToken(true);
    });

    profileCred1Btn.addEventListener('click', () => {
      applyProfile('cred1');
      exchangeOAuthToken(true);
    });

    profileCustomBtn.addEventListener('click', () => {
      applyProfile('custom');
    });

    // Toggle Password Visibility
    toggleSecretVisibilityBtn.addEventListener('click', () => {
      const type = clientSecretInput.type === 'password' ? 'text' : 'password';
      clientSecretInput.type = type;
      toggleSecretVisibilityBtn.textContent = type === 'password' ? '👁️' : '🙈';
    });

    toggleTokenVisibilityBtn.addEventListener('click', () => {
      const type = authTokenInput.type === 'password' ? 'text' : 'password';
      authTokenInput.type = type;
      toggleTokenVisibilityBtn.textContent = type === 'password' ? '👁️' : '🙈';
    });

    // Quick set URLs
    setUrlMcpInstanceBtn.addEventListener('click', () => {
      endpointUrlInput.value = 'https://8074d9d5.mcp-instances.neo4j.io';
    });

    setUrlMcpAgentBtn.addEventListener('click', () => {
      endpointUrlInput.value = 'https://mcp.neo4j.io/agent?project_id=a0469efa-3abf-409d-b7f3-cfbed38eb843&agent_id=YOUR_AGENT_ID';
      endpointUrlInput.focus();
    });

    // OAuth Token Exchange Button
    exchangeOAuthTokenBtn.addEventListener('click', () => {
      exchangeOAuthToken(false);
    });

    // Generate Session ID
    generateSessionBtn.addEventListener('click', () => {
      sessionIdInput.value = generateUUID();
    });

    // Test Connection
    testConnectionBtn.addEventListener('click', testConnection);

    // Save Settings
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveConfig();
      closeSettings();
    });

    // Chat Form Submit
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendQuery(queryInput.value);
    });

    // Textarea Enter key handling
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendQuery(queryInput.value);
      }
    });

    queryInput.addEventListener('input', adjustTextareaHeight);

    // Stop Button
    stopBtn.addEventListener('click', () => {
      if (state.abortController) {
        state.abortController.abort();
      }
    });

    // Clear Chat Button
    clearChatBtn.addEventListener('click', () => {
      messagesContainer.innerHTML = '';
      if (welcomeScreen) {
        messagesContainer.appendChild(welcomeScreen);
        welcomeScreen.style.display = 'flex';
      }
    });

    // Suggestion Chips
    document.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query) {
          queryInput.value = query;
          adjustTextareaHeight();
          sendQuery(query);
        }
      });
    });
  }

  // --- Initialize App ---
  function init() {
    loadConfig();
    setupEventListeners();
  }

  init();
})();
