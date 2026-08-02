import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArchiveX } from 'lucide-react';

function LegacyDesktopDisabledNode({ data, selected }: NodeProps) {
  const record = (data || {}) as Record<string, unknown>;
  const label = String(record.label || record.title || record.name || '历史节点');
  return (
    <div className={`min-w-[260px] rounded-xl border bg-[#18181b] p-4 shadow-xl ${selected ? 'border-amber-300/70' : 'border-amber-400/25'}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[#18181b] !bg-amber-300" />
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
        <ArchiveX size={16} />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-2 max-w-[300px] text-[11px] leading-5 text-white/55">
        这是旧画布中的历史节点，当前 Atlas 桌面版本未启用。节点数据会保留，但不会向旧平台发送请求。
      </p>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[#18181b] !bg-amber-300" />
    </div>
  );
}

export default memo(LegacyDesktopDisabledNode);
