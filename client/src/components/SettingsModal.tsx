import { useEffect, useMemo, useState } from 'react';
import {
  createLLMConfig,
  deleteLLMConfig,
  fetchLLMConfig,
  fetchModels,
  fetchSystemPrompt,
  setActiveLLMConfig,
  updateLLMConfig,
  updateSystemPrompt,
  type ModelInfo,
} from '../api/config';
import { useChatDispatch } from '../store/ChatContext';
import { DEFAULT_SYSTEM_PROMPT } from 'shared/src/default-prompt';
import type { LLMConfigProfile } from 'shared/src/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type DraftConfigProfile = Omit<LLMConfigProfile, 'id'> & {
  id: number | string;
  api_token: string;
};

function makeDraft(profile: LLMConfigProfile): DraftConfigProfile {
  return {
    ...profile,
    api_token: '',
    context_window: profile.context_window ?? 0,
    compress_threshold: profile.compress_threshold ?? 1000,
  };
}

function createEmptyDraft(index: number): DraftConfigProfile {
  return {
    id: `draft-${Date.now()}-${index}`,
    name: `配置 ${index}`,
    api_url: '',
    api_token: '',
    token_set: false,
    model: '',
    context_window: 0,
    compress_threshold: 1000,
    updated_at: undefined,
  };
}

function getDraftKey(id: number | string) {
  return String(id);
}

export default function SettingsModal({ open, onClose }: Props) {
  const [profiles, setProfiles] = useState<DraftConfigProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<number | string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<number | string | null>(null);
  const [deletedProfileIds, setDeletedProfileIds] = useState<number[]>([]);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [modelsByProfile, setModelsByProfile] = useState<Record<string, ModelInfo[]>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const chatDispatch = useChatDispatch();

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const selectedProfileModels = selectedProfile ? modelsByProfile[getDraftKey(selectedProfile.id)] || [] : [];

  useEffect(() => {
    if (!open) return;

    fetchLLMConfig().then((collection) => {
      const draftProfiles = collection.profiles.map(makeDraft);
      const nextProfiles = draftProfiles.length > 0 ? draftProfiles : [createEmptyDraft(1)];
      const activeId = collection.active_config_id ?? nextProfiles[0]?.id ?? null;
      setProfiles(nextProfiles);
      setActiveProfileId(activeId);
      setSelectedProfileId(activeId ?? nextProfiles[0]?.id ?? null);
      setDeletedProfileIds([]);
      setModelsByProfile({});
      setModelError('');
    }).catch(() => {});

    fetchSystemPrompt().then((p: { content?: string }) => {
      setPrompt(p.content || '');
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const updateSelectedProfile = (patch: Partial<DraftConfigProfile>) => {
    if (!selectedProfile) return;
    setProfiles((current) => current.map((profile) => (
      profile.id === selectedProfile.id ? { ...profile, ...patch } : profile
    )));
  };

  const handleAddProfile = () => {
    const next = createEmptyDraft(profiles.length + 1);
    setProfiles((current) => [...current, next]);
    setSelectedProfileId(next.id);
    setActiveProfileId((current) => current ?? next.id);
    setModelError('');
  };

  const handleDeleteProfile = () => {
    if (!selectedProfile) return;

    const selectedProfileIdValue = selectedProfile.id;
    if (typeof selectedProfileIdValue === 'number') {
      setDeletedProfileIds((current) => [...current, selectedProfileIdValue]);
    }

    const remaining = profiles.filter((profile) => profile.id !== selectedProfileIdValue);
    if (remaining.length === 0) {
      const fallback = createEmptyDraft(1);
      setProfiles([fallback]);
      setSelectedProfileId(fallback.id);
      setActiveProfileId(fallback.id);
      return;
    }

    const nextSelected = remaining[0];
    setProfiles(remaining);
    setSelectedProfileId(nextSelected.id);
    if (activeProfileId === selectedProfileIdValue) {
      setActiveProfileId(nextSelected.id);
    }
  };

  const handleFetchModels = async () => {
    if (!selectedProfile) return;
    if (!selectedProfile.api_url) {
      setModelError('请先填写 API 地址');
      return;
    }
    if (!selectedProfile.api_token && !selectedProfile.token_set) {
      setModelError('请先填写 API Token');
      return;
    }

    setFetchingModels(true);
    setModelError('');
    try {
      const list = await fetchModels({
        configId: typeof selectedProfile.id === 'number' ? selectedProfile.id : undefined,
        apiUrl: selectedProfile.api_url,
        apiToken: selectedProfile.api_token || undefined,
      });

      setModelsByProfile((current) => ({
        ...current,
        [getDraftKey(selectedProfile.id)]: list,
      }));

      if (list.length > 0 && !list.find((item) => item.id === selectedProfile.model)) {
        updateSelectedProfile({
          model: list[0].id,
          context_window: list[0].context_window ?? selectedProfile.context_window ?? 0,
        });
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
      const idMap = new Map<string, number>();

      for (const profileId of deletedProfileIds) {
        await deleteLLMConfig(profileId);
      }

      for (const profile of profiles) {
        const payload = {
          name: profile.name,
          api_url: profile.api_url,
          model: profile.model,
          api_token: profile.api_token || undefined,
          context_window: profile.context_window ?? 0,
          compress_threshold: profile.compress_threshold ?? 1000,
        };

        if (typeof profile.id === 'number') {
          const updated = await updateLLMConfig(profile.id, payload);
          idMap.set(getDraftKey(profile.id), updated.id);
        } else {
          const created = await createLLMConfig({ ...payload, make_active: false });
          idMap.set(getDraftKey(profile.id), created.id);
        }
      }

      const resolvedActiveId = activeProfileId == null
        ? null
        : idMap.get(getDraftKey(activeProfileId)) ?? (typeof activeProfileId === 'number' ? activeProfileId : null);
      const collection = await setActiveLLMConfig(resolvedActiveId);

      await updateSystemPrompt(prompt);

      const nextProfiles = collection.profiles || [];
      const selectedNumericId = selectedProfileId == null
        ? null
        : idMap.get(getDraftKey(selectedProfileId)) ?? (typeof selectedProfileId === 'number' ? selectedProfileId : null);
      const nextActive = nextProfiles.find((profile) => profile.id === collection.active_config_id) ?? nextProfiles[0] ?? null;
      const nextSelected = nextProfiles.find((profile) => profile.id === selectedNumericId) ?? nextActive;
      const nextSelectedModels = nextSelected ? modelsByProfile[getDraftKey(selectedProfileId ?? nextSelected.id)] || [] : [];
      const selectedModelInfo = nextSelectedModels.find((item) => item.id === nextSelected?.model);

      chatDispatch({ type: 'SET_CONFIG_PROFILES', profiles: nextProfiles });
      chatDispatch({ type: 'SET_SELECTED_CONFIG', configId: nextSelected?.id ?? null });
      chatDispatch({ type: 'SET_SELECTED_MODEL', model: nextSelected?.model ?? '' });
      chatDispatch({
        type: 'SET_CONTEXT_CONFIG',
        contextWindow: selectedModelInfo?.context_window ?? nextSelected?.context_window ?? 0,
        compressThreshold: nextSelected?.compress_threshold ?? 1000,
      });
      chatDispatch({
        type: 'SET_MODELS',
        models: nextSelected
          ? [...new Set([nextSelected.model, ...nextSelectedModels.map((item) => item.id)].filter(Boolean))]
          : [],
      });

      onClose();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-settings" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">设置</h3>

        <div className="settings-config-layout">
          <div className="settings-config-sidebar">
            <div className="settings-config-sidebar-header">
              <span>API 配置</span>
              <button className="modal-btn modal-btn-fetch" onClick={handleAddProfile} type="button">
                新增
              </button>
            </div>

            <div className="settings-config-list">
              {profiles.map((profile) => (
                <button
                  key={getDraftKey(profile.id)}
                  className={`settings-config-item${profile.id === selectedProfileId ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedProfileId(profile.id);
                    setModelError('');
                  }}
                  type="button"
                >
                  <span className="settings-config-item-name">{profile.name || '未命名配置'}</span>
                  <span className="settings-config-item-meta">
                    {activeProfileId === profile.id ? '当前默认' : '可选配置'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-config-editor">
            {selectedProfile && (
              <>
                <div className="settings-config-editor-actions">
                  <button
                    className={`modal-btn modal-btn-fetch${activeProfileId === selectedProfile.id ? ' is-active' : ''}`}
                    onClick={() => setActiveProfileId(selectedProfile.id)}
                    type="button"
                  >
                    {activeProfileId === selectedProfile.id ? '已设为默认' : '设为默认'}
                  </button>
                  <button className="modal-btn modal-btn-cancel" onClick={handleDeleteProfile} type="button">
                    删除配置
                  </button>
                </div>

                <label className="modal-label">
                  配置名称
                  <input
                    className="modal-input"
                    value={selectedProfile.name}
                    onChange={(e) => updateSelectedProfile({ name: e.target.value })}
                    placeholder="例如：OpenAI 正式环境"
                  />
                </label>

                <label className="modal-label">
                  API 地址
                  <input
                    className="modal-input"
                    value={selectedProfile.api_url}
                    onChange={(e) => updateSelectedProfile({ api_url: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>

                <label className="modal-label">
                  API Token
                  <input
                    className="modal-input"
                    type="password"
                    value={selectedProfile.api_token}
                    onChange={(e) => updateSelectedProfile({ api_token: e.target.value })}
                    placeholder={selectedProfile.token_set ? '已设置，留空保持不变' : '输入 API Token'}
                  />
                </label>

                <div className="modal-label">
                  模型名称
                  <div className="model-fetch-row">
                    {selectedProfileModels.length > 0 ? (
                      <select
                        className="modal-input modal-select"
                        value={selectedProfile.model}
                        onChange={(e) => {
                          const model = e.target.value;
                          const info = selectedProfileModels.find((item) => item.id === model);
                          updateSelectedProfile({
                            model,
                            context_window: info?.context_window ?? selectedProfile.context_window ?? 0,
                          });
                        }}
                      >
                        {selectedProfileModels.map((item) => (
                          <option key={item.id} value={item.id}>{item.id}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="modal-input"
                        value={selectedProfile.model}
                        onChange={(e) => updateSelectedProfile({ model: e.target.value })}
                        placeholder="gpt-4o-mini"
                        style={{ flex: 1 }}
                      />
                    )}
                    <button
                      className="modal-btn modal-btn-fetch"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      type="button"
                    >
                      {fetchingModels ? '拉取中…' : '拉取模型列表'}
                    </button>
                  </div>
                  {modelError && <span className="model-fetch-error">{modelError}</span>}
                </div>

                <label className="modal-label">
                  上下文窗口大小（tokens，0 = 未知）
                  <input
                    className="modal-input"
                    type="number"
                    min={0}
                    value={selectedProfile.context_window ?? 0}
                    onChange={(e) => updateSelectedProfile({ context_window: Math.max(0, Number(e.target.value)) })}
                    placeholder="0"
                  />
                </label>

                <label className="modal-label">
                  自动压缩阈值（剩余 tokens 少于此值时触发）
                  <input
                    className="modal-input"
                    type="number"
                    min={0}
                    value={selectedProfile.compress_threshold ?? 1000}
                    onChange={(e) => updateSelectedProfile({ compress_threshold: Math.max(0, Number(e.target.value)) })}
                    placeholder="1000"
                  />
                </label>
              </>
            )}
          </div>
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
