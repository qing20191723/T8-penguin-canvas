import { useEffect, useMemo, useState } from 'react';
import { getAtlasModelCapability, type AtlasCapabilityField, type AtlasModelCapability } from '../../services/api';
import { ATLAS_NODE_MANAGED_FIELDS, verifiedAtlasFallbackCapability } from '../../utils/atlasCapability';

const capabilityCache = new Map<string, AtlasModelCapability>();

function displayValue(field: AtlasCapabilityField, params: Record<string, any>) {
  return params[field.name] ?? field.default ?? (field.type === 'boolean' ? false : '');
}

function jsonValue(value: unknown) {
  if (value === undefined || value === '') return '';
  try { return JSON.stringify(value, null, 2); } catch { return ''; }
}

export default function AtlasCapabilityFields({
  model,
  kind,
  params,
  onChange,
}: {
  model: string;
  kind: 'image' | 'video';
  params: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
}) {
  const [capability, setCapability] = useState<AtlasModelCapability | null>(() => capabilityCache.get(model) || null);
  const [state, setState] = useState<'loading' | 'ready' | 'degraded'>(capability ? 'ready' : 'loading');

  useEffect(() => {
    if (!model) return;
    const cached = capabilityCache.get(model);
    if (cached) {
      setCapability(cached);
      setState('ready');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    getAtlasModelCapability(model, { signal: controller.signal })
      .then((next) => {
        if (next.kind !== kind) throw new Error('Atlas schema kind mismatch');
        capabilityCache.set(model, next);
        setCapability(next);
        setState('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCapability(verifiedAtlasFallbackCapability(model, kind));
        setState('degraded');
      });
    return () => controller.abort();
  }, [kind, model]);

  const visibleFields = useMemo(
    () => (capability?.fields || []).filter((field) => !ATLAS_NODE_MANAGED_FIELDS.has(field.name)),
    [capability],
  );

  if (state === 'loading') return <div className="text-[10px] text-white/40">正在读取 Atlas 官方模型目录…</div>;
  if (!capability) return <div className="text-[10px] text-amber-300">目录降级：该模型没有已核验的本地参数回退，仅提交节点公共字段。</div>;

  return (
    <div className="space-y-2">
      {state === 'degraded' && (
        <div className="text-[10px] text-amber-300">目录降级：当前使用该模型已核验的最小字段集，不推测其他参数。</div>
      )}
      {visibleFields.map((field) => {
        const value = displayValue(field, params);
        return (
          <label key={field.name} className="block text-[10px] text-white/55">
            <span className="mb-1 block">{field.name}{field.required ? ' *' : ''}</span>
            {field.enum?.length ? (
              <select
                value={String(value)}
                onChange={(event) => onChange({ [field.name]: event.target.value })}
                className="nodrag w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white"
              >
                {!field.required && field.default === undefined && <option value="">未设置</option>}
                {field.enum.map((item) => <option key={JSON.stringify(item)} value={String(item)}>{String(item)}</option>)}
              </select>
            ) : field.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => onChange({ [field.name]: event.target.checked })}
                className="nodrag"
              />
            ) : field.type === 'array' || field.type === 'object' ? (
              <textarea
                value={jsonValue(value)}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (!raw) return onChange({ [field.name]: undefined });
                  try { onChange({ [field.name]: JSON.parse(raw) }); } catch { /* keep last valid value */ }
                }}
                rows={3}
                className="nodrag nowheel w-full resize-y rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[10px] text-white"
              />
            ) : (
              <input
                type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                value={String(value)}
                min={field.min}
                max={field.max}
                step={field.type === 'integer' ? 1 : 'any'}
                onChange={(event) => onChange({
                  [field.name]: field.type === 'number' || field.type === 'integer'
                    ? (event.target.value === '' ? undefined : Number(event.target.value))
                    : event.target.value,
                })}
                className="nodrag w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white"
              />
            )}
          </label>
        );
      })}
      <div className="truncate text-[9px] text-white/25" title={capability.schemaDigest}>{capability.schemaDigest}</div>
    </div>
  );
}
