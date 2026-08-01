import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Save, Server, X } from 'lucide-react';
import { useApiKeysStore, ATLAS_CHAT_BASE_URL, ATLAS_GENERATION_BASE_URL } from '../stores/apiKeys';
import type { AdvancedProviderConfig, ApiSettings } from '../types/canvas';
import { parseAdvancedProviderModelText, stringifyAdvancedProviderModels } from '../utils/advancedProviders';

interface ApiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const MASKED_SECRET = /^\*{2,}/;

function atlasProviderFrom(settings: ApiSettings): AdvancedProviderConfig {
  return settings.advancedProviders?.find((provider) => provider.id === 'atlas' || provider.protocol === 'atlas') || {
    id: 'atlas', label: 'Atlas Cloud', protocol: 'atlas', baseUrl: ATLAS_GENERATION_BASE_URL,
    enabled: true, imageModels: [], videoModels: [], chatModels: [], defaults: {},
  };
}

function customProviderFrom(settings: ApiSettings): AdvancedProviderConfig {
  return settings.advancedProviders?.find((provider) => provider.id === 'custom-api') || {
    id: 'custom-api', label: '自定义 API', protocol: 'openai-compatible', baseUrl: '',
    enabled: false, imageModels: [], videoModels: [], chatModels: [], defaults: {},
  };
}

function retainedOrNewSecret(current: string | undefined, next: string) {
  const entered = next.trim();
  if (entered) return entered;
  return current && MASKED_SECRET.test(current.trim()) ? current : '';
}

function ModelTextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="nodrag nowheel w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs leading-5 text-zinc-900 outline-none focus:border-teal-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        placeholder="每行一个模型 ID"
      />
    </label>
  );
}

export default function ApiSettingsModal({ open, onClose }: ApiSettingsModalProps) {
  const settings = useApiKeysStore((state) => state.settings);
  const loading = useApiKeysStore((state) => state.loading);
  const error = useApiKeysStore((state) => state.error);
  const save = useApiKeysStore((state) => state.save);
  const atlas = useMemo(() => atlasProviderFrom(settings), [settings]);
  const custom = useMemo(() => customProviderFrom(settings), [settings]);

  const [showAtlasKey, setShowAtlasKey] = useState(false);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [atlasKey, setAtlasKey] = useState('');
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customLabel, setCustomLabel] = useState('自定义 API');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customImageModels, setCustomImageModels] = useState('');
  const [customVideoModels, setCustomVideoModels] = useState('');
  const [customChatModels, setCustomChatModels] = useState('');
  const [fileSavePath, setFileSavePath] = useState('');
  const [canvasAutoSavePath, setCanvasAutoSavePath] = useState('');
  const [resourceLibraryPath, setResourceLibraryPath] = useState('');
  const [themeTemplatePath, setThemeTemplatePath] = useState('');

  useEffect(() => {
    if (!open) return;
    setAtlasKey('');
    setCustomEnabled(custom.enabled === true);
    setCustomLabel(custom.label || '自定义 API');
    setCustomBaseUrl(custom.baseUrl || '');
    setCustomKey('');
    setCustomImageModels(stringifyAdvancedProviderModels(custom.imageModels));
    setCustomVideoModels(stringifyAdvancedProviderModels(custom.videoModels));
    setCustomChatModels(stringifyAdvancedProviderModels(custom.chatModels));
    setFileSavePath(settings.fileSavePath || '');
    setCanvasAutoSavePath(settings.canvasAutoSavePath || '');
    setResourceLibraryPath(settings.resourceLibraryPath || '');
    setThemeTemplatePath(settings.themeTemplatePath || '');
  }, [custom, open, settings]);

  if (!open) return null;

  const handleSave = async () => {
    const nextAtlas: AdvancedProviderConfig = {
      ...atlas,
      id: 'atlas',
      label: 'Atlas Cloud',
      protocol: 'atlas',
      baseUrl: ATLAS_GENERATION_BASE_URL,
      enabled: true,
      apiKey: retainedOrNewSecret(atlas.apiKey, atlasKey),
    };
    const nextCustom: AdvancedProviderConfig = {
      ...custom,
      id: 'custom-api',
      label: customLabel.trim() || '自定义 API',
      protocol: 'openai-compatible',
      baseUrl: customBaseUrl.trim(),
      enabled: customEnabled,
      apiKey: retainedOrNewSecret(custom.apiKey, customKey),
      imageModels: parseAdvancedProviderModelText(customImageModels),
      videoModels: parseAdvancedProviderModelText(customVideoModels),
      chatModels: parseAdvancedProviderModelText(customChatModels),
    };
    await save({
      advancedProviders: [nextAtlas, nextCustom],
      fileSavePath: fileSavePath.trim(),
      canvasAutoSavePath: canvasAutoSavePath.trim(),
      resourceLibraryPath: resourceLibraryPath.trim(),
      themeTemplatePath: themeTemplatePath.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-300 bg-zinc-50 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-500/15 p-2 text-teal-600 dark:text-teal-300"><KeyRound size={22} /></div>
            <div>
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">API Key 设置（Atlas Cloud + 自定义 API）</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">只保留 Atlas 与一个可选的 OpenAI 兼容自定义入口。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-zinc-300 p-2 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800" aria-label="关闭"><X size={20} /></button>
        </header>

        <div className="space-y-5 overflow-y-auto p-6">
          <section className="rounded-2xl border border-teal-300 bg-teal-50/70 p-5 dark:border-teal-700 dark:bg-teal-950/25">
            <div className="flex items-start gap-3">
              <Server className="mt-0.5 shrink-0 text-teal-600 dark:text-teal-300" size={20} />
              <div className="min-w-0 flex-1">
                <h3 className="font-black text-zinc-900 dark:text-white">Atlas Cloud</h3>
                <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-300">Render 环境变量 <code className="font-mono">ATLASCLOUD_API_KEY</code> 优先。输入框留空不会清除服务端环境变量。</p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-teal-200 bg-white/80 px-3 py-2 dark:border-teal-800 dark:bg-zinc-950/50">生成：<span className="break-all font-mono">{ATLAS_GENERATION_BASE_URL}</span></div>
                  <div className="rounded-xl border border-teal-200 bg-white/80 px-3 py-2 dark:border-teal-800 dark:bg-zinc-950/50">LLM：<span className="break-all font-mono">{ATLAS_CHAT_BASE_URL}</span></div>
                </div>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-semibold">Atlas API Key（可选，本地覆盖）</span>
                  <div className="flex gap-2">
                    <input type={showAtlasKey ? 'text' : 'password'} value={atlasKey} onChange={(event) => setAtlasKey(event.target.value)} placeholder={atlas.hasApiKey || atlas.apiKey ? '已保存；留空保持不变' : 'Render 已配置时可留空'} className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500 dark:border-zinc-700 dark:bg-zinc-950" />
                    <button type="button" onClick={() => setShowAtlasKey((value) => !value)} className="rounded-xl border border-zinc-300 px-3 dark:border-zinc-700" aria-label="显示或隐藏 Atlas Key">{showAtlasKey ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                  </div>
                </label>
                <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">模型目录：图像 {atlas.imageModels?.length || 0} · 视频 {atlas.videoModels?.length || 0} · LLM {atlas.chatModels?.length || 0}。厂商前缀只是 Atlas 官方模型 ID。</div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-950/40">
            <label className="flex items-center justify-between gap-4">
              <div><h3 className="font-black text-zinc-900 dark:text-white">自定义 API</h3><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">唯一保留的扩展入口，支持 OpenAI 兼容协议，默认关闭。</p></div>
              <input type="checkbox" checked={customEnabled} onChange={(event) => setCustomEnabled(event.target.checked)} className="h-5 w-5 accent-teal-500" />
            </label>
            <div className={`mt-4 grid gap-4 ${customEnabled ? '' : 'pointer-events-none opacity-45'}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5"><span className="text-xs font-semibold">名称</span><input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                <label className="space-y-1.5"><span className="text-xs font-semibold">Base URL</span><input value={customBaseUrl} onChange={(event) => setCustomBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
              </div>
              <label className="space-y-1.5"><span className="text-xs font-semibold">API Key</span><div className="flex gap-2"><input type={showCustomKey ? 'text' : 'password'} value={customKey} onChange={(event) => setCustomKey(event.target.value)} placeholder={custom.hasApiKey || custom.apiKey ? '已保存；留空保持不变' : 'sk-...'} className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /><button type="button" onClick={() => setShowCustomKey((value) => !value)} className="rounded-xl border border-zinc-300 px-3 dark:border-zinc-700">{showCustomKey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
              <div className="grid gap-4 lg:grid-cols-3"><ModelTextArea label="图像模型" value={customImageModels} onChange={setCustomImageModels} /><ModelTextArea label="视频模型" value={customVideoModels} onChange={setCustomVideoModels} /><ModelTextArea label="LLM 模型" value={customChatModels} onChange={setCustomChatModels} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-950/40">
            <h3 className="font-black text-zinc-900 dark:text-white">Qingchen 配置目录</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">只保留清尘命名的画布、资源库和主题目录。</p>
            <div className="mt-4 grid gap-3">
              {[
                ['素材自动保存路径', fileSavePath, setFileSavePath],
                ['画布自动保存路径', canvasAutoSavePath, setCanvasAutoSavePath],
                ['资源库路径', resourceLibraryPath, setResourceLibraryPath],
                ['主题模板路径', themeTemplatePath, setThemeTemplatePath],
              ].map(([label, value, setter]) => (
                <label key={String(label)} className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:items-center"><span className="text-xs font-semibold">{String(label)}</span><input value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
              ))}
            </div>
          </section>

          {error && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
        </div>

        <footer className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700"><button type="button" onClick={onClose} className="rounded-xl border border-zinc-300 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">取消</button><button type="button" onClick={handleSave} disabled={loading} className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-black text-zinc-950 hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}保存</button></footer>
      </div>
    </div>
  );
}
