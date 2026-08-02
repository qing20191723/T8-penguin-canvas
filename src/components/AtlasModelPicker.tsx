import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Star } from 'lucide-react';
import type { AdvancedProviderConfig, AtlasCatalogItem } from '../types/canvas';

export type AtlasRecentModelMode =
  | 'image'
  | 'image-edit'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'llm'
  | 'speech'
  | 'music';

const RECENT_PREFIX = 't8.atlas.recent-model.v1.';
export const ATLAS_RECOMMENDED_MODELS = [
  'bytedance/seedream-v5.0-pro/text-to-image',
  'bytedance/seedream-v5.0-pro/edit',
  'google/nano-banana-pro/text-to-image',
  'google/nano-banana-pro/edit',
  'openai/gpt-image-2/text-to-image',
  'openai/gpt-image-2/edit',
  'alibaba/wan-2.7/text-to-video',
  'alibaba/wan-2.7/image-to-video',
  'alibaba/wan-2.7/reference-to-video',
  'atlascloud/wan-2.7-spicy/reference-to-video',
  'bytedance/seedance-2.0/text-to-video',
  'bytedance/seedance-2.0/image-to-video',
  'moonshotai/kimi-k3',
  'bytedance/seed-audio-1.0',
];

export function atlasModelFamily(id: string) {
  const family = id.split('/')[1] || id;
  return family.replace(/\/(?:text-to-image|image-to-video|reference-to-video|edit)$/, '');
}

export function atlasModelOperation(item: AtlasCatalogItem) {
  const id = item.id.toLowerCase();
  if (item.type.toLowerCase() === 'text') return 'LLM';
  if (/\basr\b|speech-to-text|transcri/.test(id)) return '语音识别';
  if (/music|song/.test(id)) return '音乐';
  if (item.type.toLowerCase() === 'audio') return '语音/音频';
  if (id.includes('reference-to-video')) return '参考生视频';
  if (id.includes('image-to-video')) return '图生视频';
  if (id.includes('text-to-video')) return '文生视频';
  if (/\/edit$|image-to-image|inpaint|outpaint/.test(id)) return '图像编辑';
  if (item.type.toLowerCase() === 'image') return '文生图';
  return item.type;
}

function fallbackItem(id: string, kind: 'image' | 'video' | 'llm' | 'audio'): AtlasCatalogItem {
  const type = kind === 'llm' ? 'Text' : `${kind[0].toUpperCase()}${kind.slice(1)}`;
  return {
    id,
    model: id,
    name: id,
    displayName: id,
    type,
    provider: id.split('/')[0] || 'Atlas',
    schema: '',
  };
}

export function rememberAtlasModel(mode: AtlasRecentModelMode, model: string) {
  try { window.localStorage.setItem(`${RECENT_PREFIX}${mode}`, model); } catch { /* local storage can be disabled */ }
}

export function readRememberedAtlasModel(mode: AtlasRecentModelMode) {
  try { return window.localStorage.getItem(`${RECENT_PREFIX}${mode}`) || ''; } catch { return ''; }
}

function recentModeForModel(item: AtlasCatalogItem, fallback: AtlasRecentModelMode): AtlasRecentModelMode {
  const operation = atlasModelOperation(item);
  if (operation === '图像编辑') return 'image-edit';
  if (operation === '文生图') return 'image';
  if (operation === '文生视频') return 'text-to-video';
  if (operation === '图生视频') return 'image-to-video';
  if (operation === '参考生视频') return 'reference-to-video';
  if (operation === 'LLM') return 'llm';
  if (operation === '音乐') return 'music';
  if (item.type.toLowerCase() === 'audio') return 'speech';
  return fallback;
}

export default function AtlasModelPicker({
  provider,
  kind,
  mode,
  value,
  onChange,
}: {
  provider: AdvancedProviderConfig;
  kind: 'image' | 'video' | 'llm' | 'audio';
  mode: AtlasRecentModelMode;
  value: string;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const models = kind === 'image'
    ? provider.imageModels || []
    : kind === 'video'
      ? provider.videoModels || []
      : kind === 'audio'
        ? provider.audioModels || []
        : provider.chatModels || [];
  const items = useMemo(() => {
    const catalog = new Map((provider.atlasCatalog?.items || []).map((item) => [item.id, item]));
    const recommendedOrder = new Map(ATLAS_RECOMMENDED_MODELS.map((id, index) => [id, index]));
    return models.map((id) => catalog.get(id) || fallbackItem(id, kind)).sort((left, right) => {
      const a = recommendedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const b = recommendedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return a - b || left.id.localeCompare(right.id);
    });
  }, [kind, models, provider.atlasCatalog?.items]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (value || !items.length) return;
    const remembered = readRememberedAtlasModel(mode);
    onChange(items.some((item) => item.id === remembered) ? remembered : items[0].id);
  }, [items, mode, onChange, value]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!normalizedQuery) return true;
    return [item.id, item.displayName, item.name, item.provider, atlasModelOperation(item), ...(item.tags || []), ...(item.categories || [])]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const groups = new Map<string, AtlasCatalogItem[]>();
  for (const item of filtered) {
    const label = `${item.provider || item.id.split('/')[0]} · ${atlasModelFamily(item.id)} · ${atlasModelOperation(item)}`;
    groups.set(label, [...(groups.get(label) || []), item]);
  }
  const selected = items.find((item) => item.id === value);
  const source = provider.atlasCatalog?.source || 'fallback';

  return (
    <div ref={rootRef} className="relative nodrag nowheel">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`w-full rounded border px-2 py-1.5 text-left text-[11px] outline-none ${selected ? 'border-white/10 bg-[#18181b]' : 'border-amber-400/40 bg-amber-500/10'}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">{selected?.displayName || value || '选择 Atlas 模型'}</span>
          <ChevronDown size={12} className="shrink-0 text-white/50" />
        </span>
        {selected && selected.displayName !== selected.id && <span className="block truncate text-[9px] text-white/35">{selected.id}</span>}
      </button>
      {!selected && value && <div className="mt-1 text-[9px] text-amber-200">所选模型已不在当前官方目录中；不会自动改用其他收费模型。</div>}
      <div className="mt-1 text-[9px] text-white/35">
        {source === 'live' ? `官方实时目录 · ${provider.atlasCatalog?.total || items.length} 个模型` : source === 'cache' ? '本机目录缓存' : '目录降级'}
      </div>
      {open && (
        <div className="absolute z-[120] mt-1 w-full min-w-[320px] overflow-hidden rounded-lg border border-white/15 bg-[#111114] shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1.5">
            <Search size={12} className="text-white/40" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索厂商、模型家族或任务模式"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-white/30"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {[...groups.entries()].map(([group, groupItems]) => (
              <div key={group} className="mb-1">
                <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-white/35">{group}</div>
                {groupItems.map((item) => {
                  const recommended = ATLAS_RECOMMENDED_MODELS.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        rememberAtlasModel(recentModeForModel(item, mode), item.id);
                        onChange(item.id);
                        setOpen(false);
                        setQuery('');
                      }}
                      className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-white/10"
                    >
                      {item.id === value ? <Check size={12} className="mt-0.5 shrink-0 text-emerald-300" /> : recommended ? <Star size={12} className="mt-0.5 shrink-0 text-amber-300" /> : <span className="w-3 shrink-0" />}
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] text-white/85">{item.displayName || item.name || item.id}</span>
                        <span className="block truncate text-[9px] text-white/35">{item.id}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!filtered.length && <div className="px-3 py-6 text-center text-[10px] text-white/40">没有匹配的模型</div>}
          </div>
        </div>
      )}
    </div>
  );
}
