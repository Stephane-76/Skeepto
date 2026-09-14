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
  user: 'Vous',
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
          aiHints: [wStatus.error || 'Impossible de lire /ai/status'],
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
      this.appendMessage('system', 'Requête annulée.');
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
          'Tunnel MCP injoignable. Relancez bash Node/Server/start-ai-cursor.sh (tunnel auto), puis Actualiser + Cmd+Shift+R.',
      });
      return;
    }

    persistSpreadsheetContextForAi(this.props.SpInterface);
    const wCtx = getSpreadsheetContextForAi(this.props.SpInterface);
    const wWorkbookPath = wCtx.workbookPath || this.state.workbookPath;
    if (spreadsheetAgent && !wWorkbookPath) {
      this.setState({
        error: 'Aucun classeur ouvert. Ouvrez un fichier .sker avant de poser une question.',
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
          'Aucune cellule active détectée. Cliquez une cellule dans la grille — le bandeau doit afficher « Sélection : H7 » (ou une plage) — puis renvoyez.',
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
        throw new Error((wRes.error || 'Erreur IA') + wHintText);
      }

      const wAnswer =
        (typeof wRes.result === 'string' && wRes.result.trim() !== '')
          ? wRes.result
          : 'Requête terminée sans texte de réponse.';

      const wDuration =
        typeof wRes.durationMs === 'number' && wRes.durationMs > 0
          ? ` (${Math.round(wRes.durationMs / 1000)}s)`
          : '';
      this.appendMessage('assistant', wAnswer + wDuration);
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (!this.askCancelNotified) {
          this.appendMessage('system', 'Requête annulée.');
        }
        return;
      }
      let wMsg = e?.message || String(e);
      if (/^fetch failed$/i.test(wMsg.trim())) {
        wMsg =
          'Connexion au serveur impossible (fetch failed). ' +
          'Vérifiez que SkServer tourne et que llama-server répond sur le port 8080 (curl http://127.0.0.1:8080/health).';
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
          Vérification de la configuration IA…
        </div>
      );
    }
    if (aiProvider === 'llama') {
      if (aiConfigured && llamaReachable === true && llamaMcp) {
        return (
          <div className="SkSpAiChat-status SkSpAiChat-status--ok">
            Agent llama local + MCP sker (sans Cursor ni tunnel).
            {llamaBaseUrl ? <> · <code>{llamaBaseUrl}</code></> : null}
          </div>
        );
      }
      if (aiConfigured && llamaReachable === true) {
        return (
          <div className="SkSpAiChat-status SkSpAiChat-status--ok">
            Mode llama local — texte uniquement (pas de cellules, pas de MCP).
            {llamaBaseUrl ? <> · <code>{llamaBaseUrl}</code></> : null}
            {' '}
            Édition classeur : <code>start-ai-cursor.sh</code>
          </div>
        );
      }
      const wHints = aiHints.length > 0
        ? aiHints.join(' ')
        : 'Démarrez llama-server (./launch.sh) puis SkServer avec bash Node/Server/start-ai-llama.sh.';
      return (
        <div className="SkSpAiChat-status">
          {wHints}
        </div>
      );
    }
    if (aiConfigured && mcpTunnelReachable === true) {
      return (
        <div className="SkSpAiChat-status SkSpAiChat-status--ok">
          Assistant IA prêt (Cursor Cloud + MCP sker via tunnel HTTPS).
        </div>
      );
    }
    if (aiConfigured && mcpTunnelReachable === false) {
      return (
        <div className="SkSpAiChat-status">
          <strong>Tunnel MCP injoignable</strong> — Cursor Cloud ne peut pas appeler les outils tableur.
          <ol className="SkSpAiChat-steps">
            <li>
              Arrêter SkServer (Ctrl+C), puis relancer :{' '}
              <code>bash Node/Server/start-ai-cursor.sh</code>
              <br />
              <span className="SkSpAiChat-stepNote">
                (cloudflared + patch <code>SK_MCP_PUBLIC_URL</code> + SkServer — automatique)
              </span>
            </li>
            <li>
              Attendre <strong>Tunnel OK</strong> dans le terminal
            </li>
            <li>
              Cliquer <strong>Actualiser</strong> ci-dessous, puis hard-refresh (Cmd+Shift+R)
            </li>
          </ol>
          <p className="SkSpAiChat-stepNote">
            Manuel : <code>bash Node/IACursor/start-tunnel.sh</code> puis{' '}
            <code>bash Node/IACursor/patch-tunnel-env.sh</code> — ou{' '}
            <code>SK_TUNNEL_AUTO=0</code> pour désactiver l&apos;auto-tunnel.
          </p>
          {mcpPublicUrl ? (
            <div className="SkSpAiChat-mcpUrl">
              URL configurée (expirée ?) : <code>{mcpPublicUrl}</code>
            </div>
          ) : null}
        </div>
      );
    }
    const wHints = aiHints.length > 0
      ? aiHints.join(' ')
      : 'Configurez CURSOR_API_KEY et SK_MCP_PUBLIC_URL sur le serveur.';
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
            title="Copier ce message"
            aria-label="Copier ce message"
            onClick={() => void this.handleCopyMessage(msg.id, msg.text)}
          >
            {wCopied ? 'Copié' : 'Copier'}
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
          <p><strong>Mode texte</strong> — pas d&apos;édition du classeur.</p>
          <p>Réponses texte sans outils MCP.</p>
          <p>Exemples :</p>
          <ul>
            <li>Quelle est la liste des départements français ?</li>
            <li>Explique la TVA déductible vs collectée</li>
            <li>Différence entre charges et produits au PCG</li>
          </ul>
          <p className="SkSpAiChat-emptyNote">
            Pour écrire dans une cellule ou créer un tableau → mode agent tableur
            (<code>start-ai-llama-agent.sh</code> ou <code>start-ai-cursor.sh</code>).
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
            ? <>Classeur actif : <strong>{workbookPath}</strong></>
            : 'Aucun classeur actif'}
          {activeSheet ? (
            <>
              {' · '}
              Feuille : <strong>{activeSheet}</strong>
            </>
          ) : null}
          {selection ? (
            <>
              {' · '}
              Sélection : <strong>{selection}</strong>
            </>
          ) : (
            <>
              {' · '}
              <span className="SkSpAiChat-stepNote">Sélection : aucune — cliquez une cellule</span>
            </>
          )}
          {' · '}
          Affichage : <strong>{spreadsheetLangLabel(getSpreadsheetLang())}</strong>
          {' · fil '}
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
                title="Copier toute la conversation"
                onClick={() => void this.handleCopyAllMessages()}
                disabled={loading}
              >
                {copiedAll ? 'Conversation copiée' : 'Copier la conversation'}
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
              Actualiser
            </SkButton>
            {loading ? (
              <SkButton onClick={() => this.handleCancelAsk({ resetUi: true })}>
                Arrêter
              </SkButton>
            ) : null}
            <SkButton onClick={this.handleSend} disabled={loading || !draft.trim()}>
              {loading ? 'Envoi…' : 'Envoyer'}
            </SkButton>
            {loading ? (
              <span className="SkSpAiChat-busy">
                {spreadsheetAgent
                  ? `Agent tableur… ${loadingElapsedSec}s`
                  : textOnly
                    ? `Réponse texte… ${loadingElapsedSec}s`
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
