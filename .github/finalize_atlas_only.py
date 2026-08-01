from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/stores/apiKeys.ts',
    ".filter((provider) => provider?.protocol !== 'jimeng-cli');",
    ".filter((provider) => provider?.protocol === 'atlas');",
)

replace_once(
    'src/utils/advancedProviders.ts',
    """  return {
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: '',
    provider: null,
    available: false,
  };
}""",
    """  const atlasProvider = available.find((provider) => provider.protocol === 'atlas') || available[0];
  if (atlasProvider) {
    const models = advancedProviderModelOptions(atlasProvider, kind);
    const requested = String(current?.providerModel || '').trim();
    return {
      providerSource: atlasProvider.protocol,
      providerId: atlasProvider.id,
      providerModel: requested && models.includes(requested) ? requested : (models[0] || ''),
      provider: atlasProvider,
      available: true,
    };
  }
  return {
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: '',
    provider: null,
    available: false,
  };
}""",
)

llm = Path('src/components/nodes/LLMNode.tsx')
text = llm.read_text(encoding='utf-8')
old_options = """                    <option value=\"zhenzhen\" style={{ background: '#18181b', color: '#ffffff' }}>
                      贞贞的AI工坊-独立LLM Key(默认)
                    </option>
                    <option value=\"seedance-nz\" style={{ background: '#18181b', color: '#ffffff' }}>
                      贞贞的平价AI小屋
                    </option>
"""
if text.count(old_options) != 1:
    raise SystemExit('LLMNode old provider options did not match exactly once')
text = text.replace(old_options, '', 1)
text = text.replace('贞贞的平价AI小屋 · ${seedanceNzModel}', 'Atlas Cloud · ${externalProviderModel || \'动态模型\'}')
text = text.replace('贞贞的AI工坊 · 独立 LLM Key · 多模态 · 流式', 'Atlas Cloud · 动态 LLM 模型目录')
text = text.replace('贞贞的平价AI小屋', 'Atlas Cloud')
text = text.replace('贞贞的AI工坊-独立LLM Key(默认)', 'Atlas Cloud')
llm.write_text(text, encoding='utf-8')

for path, first_label, second_label in [
    ('src/components/nodes/ImageNode.tsx', '贞贞工坊（默认）', '贞贞的平价AI小屋'),
    ('src/components/nodes/VideoNode.tsx', '贞贞的AI工坊（默认）', '贞贞的平价AI小屋'),
]:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    old = (
        f'                    <option value="zhenzhen" style={{{{ background: \'#18181b\', color: \'#ffffff\' }}}}>{first_label}</option>\n'
        f'                    <option value="builtin:seedance-nz" style={{{{ background: \'#18181b\', color: \'#ffffff\' }}}}>{second_label}</option>\n'
    )
    if text.count(old) != 1:
        raise SystemExit(f'{path}: old provider options did not match exactly once')
    text = text.replace(old, '', 1)
    text = text.replace(first_label, 'Atlas Cloud')
    text = text.replace(second_label, 'Atlas Cloud')
    file.write_text(text, encoding='utf-8')
