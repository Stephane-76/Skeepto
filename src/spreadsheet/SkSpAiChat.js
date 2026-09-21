//=============================================================================
// SkSpAiChat.js — spreadsheet AI assistant panel (POST /ai/ask)
//=============================================================================

import React from 'react';
import SkComponent from '../component/SkComponent';
import SkButton from '../component/SkButton';
import {
  SK_ACTIVE_FILE_EVENT,
} from '../SkActiveFile.js';
import { fetchAiStatus, postAiAsk } from './SkSpAiApi.js';
import { getSpreadsheetContextForAi, persistSpreadsheetContextForAi, detectSelectionTargetIntent } from './SkSpAiSpreadsheetContext.js';
import SkAiCapabilitiesHelp from './SkAiCapabilitiesHelp.js';
import { getSpreadsheetLang, spreadsheetLangLabel } from './SkeeptoLang.js';
import './SkSpAiChat.css';

const ROLE_LABELS = {
  user: 'You',
  assistant: 'Assistant',
  system: 'Info',
};

export default class SkSpAiChat extends SkComponent {
  constructor(props) {
    super(props);
    this.state = {
      messages: [],
      workbookPath: '',
      activeSheet: '',
      selection: '',
      aiProvider: '',
      aiConfigured: null,
      spreadsheetAgent: false,
      textOnly: false,
      requiresMcpTunnel: false,
      mcpTunnelReachable: null,
      mcpPublicUrl: '',
      llamaReachable: null,
      llamaMcp: false,
      llamaBaseUrl: '',
      aiHints: [],
      loading: false,
      loadingElapsedSec: 0,
      error: '',
      draft: '',
      copiedMessageId: '',
      copiedAll: false,
    };
    this.inputRef = React.createRef();
    this.messagesRef = React.createRef();
    this.loadingTimerRef = null;
    this.copyTimerRef = null;
    this.askAbortController = null;
    this.askCancelNotified = false;
    this.handleActiveFileChange = this.handleActiveFileChange.bind(this);
    this.handleDraftChange = this.handleDraftChange.bind(this);
    this.handleSend = this.handleSend.bind(this);
    this.handleCancelAsk = this.handleCancelAsk.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleRefreshStatus = this.handleRefreshStatus.bind(this);
    this.handleCopyMessage = this.handleCopyMessage.bind(this);
    this.handleCopyAllMessages = this.handleCopyAllMessages.bind(this);
  }

  componentDidMount() {
    this.bindAiChatSync();
    this.syncSpreadsheetContext();
    this.loadAiStatus();
    if (typeof window !== 'undefined') {
      window.addEventListener(SK_ACTIVE_FILE_EVENT, this.handleActiveFileChange);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.SpInterface !== this.props.SpInterface) {
      this.bindAiChatSync();
    }
    this.syncSpreadsheetContext();
  }

  componentWillUnmount() {
    this.unbindAiChatSync();
    if (typeof window !== 'undefined') {
      window.removeEventListener(SK_ACTIVE_FILE_EVENT, this.handleActiveFileChange);
    }
    this.handleCancelAsk();
    this.clearLoadingTimer();
    if (this.copyTimerRef != null) {
      clearTimeout(this.copyTimerRef);
      this.copyTimerRef = null;
    }
  }

  clearLoadingTimer() {
    if (this.loadingTimerRef != null) {
      clearInterval(this.loadingTimerRef);
      this.loadingTimerRef = null;
    }
  }

  startLoadingTimer() {
    this.clearLoadingTimer();
    this.setState({ loadingElapsedSec: 0 });
    this.loadingTimerRef = setInterval(() => {
      this.setState((prev) => ({
        loadingElapsedSec: prev.loadingElapsedSec + 1,
      }));
    }, 1000);
  }

  bindAiChatSync() {
    const wSp = this.props.SpInterface;
    if (!wSp) {
      return;
    }
    wSp.m_SkSpAiChatSync = () => {
      this.syncSpreadsheetContext();
    };
  }

  unbindAiChatSync() {
    const wSp = this.props.SpInterface;
    if (wSp?.m_SkSpAiChatSync) {
      delete wSp.m_SkSpAiChatSync;
    }
  }

  handleInputFocus = () => {
    this.syncSpreadsheetContext();
  };

  handleActiveFileChange() {
    this.syncSpreadsheetContext();
  }

  syncSpreadsheetContext() {
    persistSpreadsheetContextForAi(this.props.SpInterface);
    const wCtx = getSpreadsheetContextForAi(this.props.SpInterface);
    const wNext = {
      workbookPath: wCtx.workbookPath,
      activeSheet: wCtx.sheet,
      selection: wCtx.selection || wCtx.cursorRef,
      cursorRef: wCtx.cursorRef,
    };
    if (
      wNext.workbookPath !== this.state.workbookPath ||
      wNext.activeSheet !== this.state.activeSheet ||
      wNext.selection !== this.state.selection
    ) {
      this.setState(wNext);
    }
  }

  async loadAiStatus() {
    try {
      const wStatus = await fetchAiStatus();
      if (wStatus?.message === 'error') {
        this.setState({
          aiConfigured: false,
          aiHints: [wStatus.error || 'Could not read /ai/status'],
        });
        return;
      }
      this.setState({
        aiConfigured: Boolean(wStatus.configured),
        aiProvider: typeof wStatus.provider === 'string' ? wStatus.provider : 'cursor',
        spreadsheetAgent: Boolean(wStatus.spreadsheetAgent),
        textOnly: Boolean(wStatus.textOnly),
        requiresMcpTunnel: Boolean(wStatus.requiresMcpTunnel),
        mcpTunnelReachable: wStatus.mcpTunnelReachable,
        mcpPublicUrl: typeof wStatus.mcpPublicUrl === 'string' ? wStatus.mcpPublicUrl : '',
        llamaReachable: wStatus.llamaReachable,
        llamaMcp: Boolean(wStatus.llamaMcp),
        llamaBaseUrl: typeof wStatus.llamaBaseUrl === 'string' ? wStatus.llamaBaseUrl : '',
        aiHints: Array.isArray(wStatus.hints) ? wStatus.hints : [],
      });
    } catch (e) {
      this.setState({
        aiConfigured: false,
        aiHints: [e?.message || String(e)],
      });
    }
  }

  scrollMessagesToEnd() {
    const wEl = this.messagesRef.current;
    if (wEl) {
      wEl.scrollTop = wEl.scrollHeight;
    }
  }

  appendMessage(role, text) {
    this.setState(
      (prev) => ({
        messages: [
          ...prev.messages,
          { id: `${Date.now()}-${prev.messages.length}`, role, text },
        ],
        error: '',
      }),
      () => this.scrollMessagesToEnd()
    );
  }

  handleDraftChange(event) {
    this.setState({ draft: event.target.value });
  }

  handleKeyDown(event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.handleSend();
    }
  }

  handleRefreshStatus() {
    void this.loadAiStatus();
  }

  async copyTextToClipboard(text) {
    const wValue = String(text ?? '');
    if (wValue === '') {
      return false;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(wValue);
      return true;
    }
    const wTa = document.createElement('textarea');
    wTa.value = wValue;
    wTa.setAttribute('readonly', '');
    wTa.style.position = 'fixed';
    wTa.style.left = '-9999px';
    document.body.appendChild(wTa);
    wTa.select();
    let wOk = false;
    try {
      wOk = document.execCommand('copy');
    } finally {
      document.body.removeChild(wTa);
    }
    return wOk;
  }

  flashCopyFeedback(kind, messageId = '') {
    if (this.copyTimerRef != null) {
      clearTimeout(this.copyTimerRef);
    }
    this.setState({
      copiedMessageId: kind === 'message' ? messageId : '',
      copiedAll: kind === 'all',
    });
    this.copyTimerRef = setTimeout(() => {
      this.setState({ copiedMessageId: '', copiedAll: false });
      this.copyTimerRef = null;
    }, 1600);
  }

  async handleCopyMessage(messageId, text) {
    try {
      const wOk = await this.copyTextToClipboard(text);
      if (wOk) {
        this.flashCopyFeedback('message', messageId);
      }
    } catch (e) {
      console.warn('SkSpAiChat: copy failed', e);
    }
  }

  async handleCopyAllMessages() {
    const { messages } = this.state;
    if (!Array.isArray(messages) || messages.length === 0) {
      return;
    }
    const wText = messages
      .map((msg) => {
        const wLabel = ROLE_LABELS[msg.role] || msg.role;
        return `${wLabel}\n${msg.text}`;
      })
      .join('\n\n—\n\n');
    try {
      const wOk = await this.copyTextToClipboard(wText);
      if (wOk) {
        this.flashCopyFeedback('all');
      }
    } catch (e) {
      console.warn('SkSpAiChat: copy all failed', e);
    }
  }

  handleCancelAsk({ resetUi = false } = {}) {
    if (!this.askAbortController) {
      if (resetUi && this.state.loading) {
        this.clearLoadingTimer();
        this.setState({ loading: false });
      }
      return;
    }
    this.askCancelNotified = resetUi;
    this.askAbortController.abort();
    this.askAbortController = null;
    if (resetUi) {
      this.clearLoadingTimer();
      this.setState({ loading: false });
      this.appendMessage('system', 'Request canceled.');
    }
  }

  async handleSend() {
    const wPrompt = (this.state.draft || '').trim();
    if (!wPrompt || this.state.loading) {
      return;
    }

    const { spreadsheetAgent, requiresMcpTunnel } = this.state;

    if (requiresMcpTunnel && this.state.aiConfigured && this.state.mcpTunnelReachable === false) {
      this.setState({
        error:
          'MCP tunnel unreachable. Rerun bash Node/Server/start-ai-cursor.sh (auto tunnel), then Refresh + Cmd+Shift+R.',
      });
      return;
    }

    persistSpreadsheetContextForAi(this.props.SpInterface);
    const wCtx = getSpreadsheetContextForAi(this.props.SpInterface);
    const wWorkbookPath = wCtx.workbookPath || this.state.workbookPath;
    if (spreadsheetAgent && !wWorkbookPath) {
      this.setState({
        error: 'No workbook is open. Open a .sker file before asking a question.',
      });
      return;
    }

    if (
      spreadsheetAgent &&
      detectSelectionTargetIntent(wPrompt) &&
      !wCtx.cursorRef &&
      !wCtx.selection
    ) {
      this.setState({
        error:
          'No active cell detected. Click a cell in the grid — the banner should show “Selection: H7” (or a range) — then send again.',
      });
      return;
    }

    this.appendMessage('user', wPrompt);
    this.setState({ draft: '', loading: true, error: '' });
    this.startLoadingTimer();
    this.handleCancelAsk();
    this.askAbortController = new AbortController();

    try {
      const wRes = await postAiAsk({
        prompt: wPrompt,
        workbookPath: wWorkbookPath,
        spreadsheetContext: {
          sheet: wCtx.sheet,
          selection: wCtx.selection,
          cursorRef: wCtx.cursorRef,
        },
        history: (this.state.messages || [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-6)
          .map((m) => ({ role: m.role, content: String(m.text || '') })),
        spreadsheetLang: getSpreadsheetLang(),
        timeoutMs: 600_000,
        signal: this.askAbortController.signal,
      });

      if (wRes?.message === 'error') {
        const wHintText = Array.isArray(wRes.hints) && wRes.hints.length > 0
          ? `\n\n${wRes.hints.join('\n')}`
          : '';
        throw new Error((wRes.error || 'AI error') + wHintText);
      }

      const wAnswer =
        (typeof wRes.result === 'string' && wRes.result.trim() !== '')
          ? wRes.result
          : 'Request finished with no response text.';

      const wDuration =
        typeof wRes.durationMs === 'number' && wRes.durationMs > 0
          ? ` (${Math.round(wRes.durationMs / 1000)}s)`
          : '';
      this.appendMessage('assistant', wAnswer + wDuration);
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (!this.askCancelNotified) {
          this.appendMessage('system', 'Request canceled.');
        }
        return;
      }
      let wMsg = e?.message || String(e);
      if (/^fetch failed$/i.test(wMsg.trim())) {
        wMsg =
          'Could not connect to the server (fetch failed). ' +
          'Check that SkServer is running and llama-server answers on port 8080 (curl http://127.0.0.1:8080/health).';
      }
      this.setState({ error: wMsg });
      this.appendMessage('system', wMsg);
    } finally {
      this.askAbortController = null;
      this.askCancelNotified = false;
      this.clearLoadingTimer();
      this.setState({ loading: false });
      if (this.inputRef.current) {
        this.inputRef.current.focus();
      }
    }
  }

  renderStatusBanner() {
    const {
      aiConfigured,
      aiProvider,
      mcpTunnelReachable,
      mcpPublicUrl,
      llamaReachable,
      llamaMcp,
      llamaBaseUrl,
      aiHints,
    } = this.state;
    if (aiConfigured === null) {
      return (
        <div className="SkSpAiChat-status">
          Checking AI configuration…
        </div>
      );
    }
    if (aiProvider === 'llama') {
      if (aiConfigured && llamaReachable === true && llamaMcp) {
        return (
          <div className="SkSpAiChat-status SkSpAiChat-status--ok">
            Local llama agent + sker MCP (no Cursor, no tunnel).
            {llamaBaseUrl ? <> · <code>{llamaBaseUrl}</code></> : null}
          </div>
        );
      }
      if (aiConfigured && llamaReachable === true) {
        return (
          <div className="SkSpAiChat-status SkSpAiChat-status--ok">
            Local llama mode — text only (no cells, no MCP).
            {llamaBaseUrl ? <> · <code>{llamaBaseUrl}</code></> : null}
            {' '}
            Workbook editing: <code>start-ai-cursor.sh</code>
          </div>
        );
      }
      const wHints = aiHints.length > 0
        ? aiHints.join(' ')
        : 'Start llama-server (./launch.sh) then SkServer with bash Node/Server/start-ai-llama.sh.';
      return (
        <div className="SkSpAiChat-status">
          {wHints}
        </div>
      );
    }
    if (aiConfigured && mcpTunnelReachable === true) {
      return (
        <div className="SkSpAiChat-status SkSpAiChat-status--ok">
          AI assistant ready (Cursor Cloud + sker MCP over HTTPS tunnel).
        </div>
      );
    }
    if (aiConfigured && mcpTunnelReachable === false) {
      return (
        <div className="SkSpAiChat-status">
          <strong>MCP tunnel unreachable</strong> — Cursor Cloud cannot call spreadsheet tools.
          <ol className="SkSpAiChat-steps">
            <li>
              Stop SkServer (Ctrl+C), then restart:{' '}
              <code>bash Node/Server/start-ai-cursor.sh</code>
              <br />
              <span className="SkSpAiChat-stepNote">
                (cloudflared + patch <code>SK_MCP_PUBLIC_URL</code> + SkServer — automatic)
              </span>
            </li>
            <li>
              Wait for <strong>Tunnel OK</strong> in the terminal
            </li>
            <li>
              Click <strong>Refresh</strong> below, then hard-refresh (Cmd+Shift+R)
            </li>
          </ol>
          <p className="SkSpAiChat-stepNote">
            Manual: <code>bash Node/IACursor/start-tunnel.sh</code> then{' '}
            <code>bash Node/IACursor/patch-tunnel-env.sh</code> — or{' '}
            <code>SK_TUNNEL_AUTO=0</code> to disable the auto-tunnel.
          </p>
          {mcpPublicUrl ? (
            <div className="SkSpAiChat-mcpUrl">
              Configured URL (expired?): <code>{mcpPublicUrl}</code>
            </div>
          ) : null}
        </div>
      );
    }
    const wHints = aiHints.length > 0
      ? aiHints.join(' ')
      : 'Set CURSOR_API_KEY and SK_MCP_PUBLIC_URL on the server.';
    return (
      <div className="SkSpAiChat-status">
        {wHints}
      </div>
    );
  }

  renderMessage(msg) {
    const { copiedMessageId } = this.state;
    const wCopied = copiedMessageId === msg.id;
    return (
      <div
        key={msg.id}
        className={`SkSpAiChat-msg SkSpAiChat-msg--${msg.role}`}
      >
        <div className="SkSpAiChat-msgHead">
          <div className="SkSpAiChat-msgRole">
            {ROLE_LABELS[msg.role] || msg.role}
          </div>
          <button
            type="button"
            className={`SkSpAiChat-copyBtn${wCopied ? ' SkSpAiChat-copyBtn--done' : ''}`}
            title="Copy this message"
            aria-label="Copy this message"
            onClick={() => void this.handleCopyMessage(msg.id, msg.text)}
          >
            {wCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="SkSpAiChat-msgBody">{msg.text}</div>
      </div>
    );
  }

  renderEmptyState() {
    if (this.state.textOnly) {
      return (
        <div className="SkSpAiChat-empty">
          <p><strong>Text mode</strong> — no workbook editing.</p>
          <p>Text answers without MCP tools.</p>
          <p>Examples:</p>
          <ul>
            <li>What is the list of French departments?</li>
            <li>Explain deductible vs collected VAT</li>
            <li>Difference between expenses and income in the PCG</li>
          </ul>
          <p className="SkSpAiChat-emptyNote">
            To write in a cell or create a table → spreadsheet agent mode
            (<code>start-ai-llama-agent.sh</code> or <code>start-ai-cursor.sh</code>).
          </p>
        </div>
      );
    }
    return <SkAiCapabilitiesHelp />;
  }

  render() {
    const {
      messages,
      workbookPath,
      activeSheet,
      selection,
      spreadsheetAgent,
      textOnly,
      loading,
      loadingElapsedSec,
      error,
      draft,
      copiedAll,
    } = this.state;

    return (
      <div className="SkSpAiChat" ref={this.m_Ref}>
        {this.renderStatusBanner()}

        <div className="SkSpAiChat-workbook">
          {workbookPath
            ? <>Active workbook: <strong>{workbookPath}</strong></>
            : 'No active workbook'}
          {activeSheet ? (
            <>
              {' · '}
              Sheet: <strong>{activeSheet}</strong>
            </>
          ) : null}
          {selection ? (
            <>
              {' · '}
              Selection: <strong>{selection}</strong>
            </>
          ) : (
            <>
              {' · '}
              <span className="SkSpAiChat-stepNote">Selection: none — click a cell</span>
            </>
          )}
          {' · '}
          Display: <strong>{spreadsheetLangLabel(getSpreadsheetLang())}</strong>
          {' · file '}
          <strong>US</strong>
        </div>

        <div className="SkSpAiChat-messages" ref={this.messagesRef}>
          {messages.length === 0 ? (
            this.renderEmptyState()
          ) : (
            messages.map((msg) => this.renderMessage(msg))
          )}
        </div>

        <div className="SkSpAiChat-form">
          {messages.length > 0 ? (
            <div className="SkSpAiChat-copyAllRow">
              <button
                type="button"
                className={`SkSpAiChat-copyBtn SkSpAiChat-copyBtn--all${copiedAll ? ' SkSpAiChat-copyBtn--done' : ''}`}
                title="Copy the whole conversation"
                onClick={() => void this.handleCopyAllMessages()}
                disabled={loading}
              >
                {copiedAll ? 'Conversation copied' : 'Copy conversation'}
              </button>
            </div>
          ) : null}
          <textarea
            ref={this.inputRef}
            className="SkSpAiChat-input"
            placeholder={
              spreadsheetAgent
                ? 'Question on the workbook (MCP)… (Ctrl+Enter)'
                : textOnly
                  ? 'Question on text (Ctrl+Enter)…'
                  : 'Ask your question on this workbook… (Ctrl+Enter)'
            }
            value={draft}
            onFocus={this.handleInputFocus}
            onChange={this.handleDraftChange}
            onKeyDown={this.handleKeyDown}
            disabled={loading}
          />
          <div className="SkSpAiChat-actions">
            <SkButton onClick={this.handleRefreshStatus} disabled={loading}>
              Refresh
            </SkButton>
            {loading ? (
              <SkButton onClick={() => this.handleCancelAsk({ resetUi: true })}>
                Stop
              </SkButton>
            ) : null}
            <SkButton onClick={this.handleSend} disabled={loading || !draft.trim()}>
              {loading ? 'Sending…' : 'Send'}
            </SkButton>
            {loading ? (
              <span className="SkSpAiChat-busy">
                {spreadsheetAgent
                  ? `Spreadsheet agent… ${loadingElapsedSec}s`
                  : textOnly
                    ? `Text reply… ${loadingElapsedSec}s`
                    : `Agent… ${loadingElapsedSec}s`}
              </span>
            ) : null}
          </div>
          {error ? <div className="SkSpAiChat-error">{error}</div> : null}
        </div>
      </div>
    );
  }
}
