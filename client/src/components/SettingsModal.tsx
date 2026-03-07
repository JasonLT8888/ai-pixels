import { useState, useEffect } from 'react';
import { fetchLLMConfig, updateLLMConfig, fetchSystemPrompt, updateSystemPrompt, fetchModels } from '../api/config';
import { useChatDispatch } from '../store/ChatContext';
import { DEFAULT_SYSTEM_PROMPT } from 'shared/src/default-prompt';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const [apiUrl, setApiUrl] = useState('');
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [tokenSet, setTokenSet] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const chatDispatch = useChatDispatch();

  useEffect(() => {
    if (!open) return;
    fetchLLMConfig().then((cfg: any) => {
      setApiUrl(cfg.api_url || '');
      setModel(cfg.model || '');
      setTokenSet(cfg.token_set || false);
      setToken('');
    }).catch(() => {});
    fetchSystemPrompt().then((p: any) => {
      setPrompt(p.content || '');
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const handleFetchModels = async () => {
    if (!apiUrl) {
      setModelError('请先填写 API 地址');
      return;
    }
    const effectiveToken = token || (tokenSet ? '__saved__' : '');
    if (!effectiveToken) {
      setModelError('请先填写 API Token');
      return;
    }

    setFetchingModels(true);
    setModelError('');
    try {
      // If token field is empty but token was previously saved, pass empty string
      // so the backend uses the saved token
      const tokenToSend = token || '';
      const list = await fetchModels(apiUrl, tokenToSend);
      setModels(list);
      chatDispatch({ type: 'SET_MODELS', models: list });
      if (list.length > 0 && !list.includes(model)) {
        setModel(list[0]);
      }
    } catch (err: any) {
      setModelError(err.message || '拉取失败');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLLMConfig({ api_url: apiUrl, model, api_token: token || undefined });
      await updateSystemPrompt(prompt);
      // Sync selected model to chat context
      chatDispatch({ type: 'SET_SELECTED_MODEL', model });
      onClose();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">设置</h3>

        <label className="modal-label">
          API 地址
          <input
            className="modal-input"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <label className="modal-label">
          API Token
          <input
            className="modal-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSet ? '已设置，留空保持不变' : '输入 API Token'}
          />
        </label>

        <div className="modal-label">
          模型名称
          <div className="model-fetch-row">
            {models.length > 0 ? (
              <select
                className="modal-input modal-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className="modal-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
                style={{ flex: 1 }}
              />
            )}
            <button
              className="modal-btn modal-btn-fetch"
              onClick={handleFetchModels}
              disabled={fetchingModels}
            >
              {fetchingModels ? '拉取中…' : '拉取模型列表'}
            </button>
          </div>
          {modelError && <span className="model-fetch-error">{modelError}</span>}
        </div>

        <div className="modal-label">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>系统提示词（内置，不可修改）</span>
          </div>
          <textarea
            className="modal-textarea"
            value={DEFAULT_SYSTEM_PROMPT}
            readOnly
            rows={4}
            style={{ opacity: 0.6, cursor: 'default' }}
          />
        </div>

        <div className="modal-label">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>追加提示词</span>
            <button
              className="modal-btn modal-btn-fetch"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setPrompt('')}
              type="button"
            >
              清空
            </button>
          </div>
          <textarea
            className="modal-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="在此追加额外的提示词内容（可选）…"
            rows={3}
          />
        </div>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onClose}>取消</button>
          <button className="modal-btn modal-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
