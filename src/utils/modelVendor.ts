import type { PricingModel, Vendor } from '../api/types'

interface ModelVendor {
  id: string
  name: string
  icon: string | null
}

/**
 * 已知原厂规则：按模型名前缀/模式匹配。
 * icon 是 lobehub 图标名；若模型自身配的 icon 不是品牌名本身则优先保留。
 */
const brands: { id: string; name: string; icon: string; model: RegExp }[] = [
  { id: 'openai',    name: 'OpenAI',    icon: 'OpenAI',          model: /^(?:openai\/)?(?:gpt-\d|chatgpt(?:-|$)|o[1-9]\d*(?:-|$)|dall-e(?:-|$)|whisper(?:-|$)|tts-\d|text-embedding-(?:ada-002|3-))/i },
  { id: 'anthropic', name: 'Anthropic', icon: 'Claude.Color',    model: /^(?:anthropic\/)?claude(?:-|$)/i },
  { id: 'google',    name: 'Google',    icon: 'Gemini.Color',     model: /^(?:google\/)?(?:gemini|gemma|palm)(?:-|$)/i },
  { id: 'deepseek',  name: 'DeepSeek',  icon: 'DeepSeek.Color',  model: /^(?:deepseek\/)?deepseek(?:-|$)/i },
  { id: 'alibaba',   name: '阿里巴巴',   icon: 'Qwen.Color',      model: /^(?:qwen\/)?qwen(?:\d|[.\-]|$)/i },
  { id: 'bytedance', name: '字节跳动',   icon: 'Doubao.Color',    model: /^(?:doubao|ep-\d)/i },
  { id: 'zhipu',     name: '智谱 AI',   icon: 'Zhipu.Color',     model: /^(?:chatglm|glm)(?:-|$)/i },
  { id: 'minimax',   name: 'MiniMax',   icon: 'MiniMax.Color',   model: /^(?:abab|minimax)(?:-|$)/i },
  { id: 'moonshot',  name: 'Moonshot',  icon: 'Kimi.Color',      model: /^moonshot(?:-|$)/i },
  { id: 'baidu',     name: '百度',       icon: 'Wenxin.Color',    model: /^(?:ernie|yi-34b)/i },
  { id: 'xai',       name: 'xAI',       icon: 'Grok.Color',      model: /^(?:x-ai\/)?grok(?:-|$)/i },
  { id: 'meta',      name: 'Meta',      icon: 'Meta.Color',      model: /^(?:meta-llama\/)?(?:llama|llama-\d)/i },
  { id: 'mistral',   name: 'Mistral',   icon: 'Mistral.Color',   model: /^(?:mistral|mixtral|mistral-(?:7b|8x))/i },
  { id: 'cohere',    name: 'Cohere',    icon: 'Cohere.Color',    model: /^(?:command|c4ai-)/i },
  { id: 'flux',      name: 'Flux',      icon: 'Flux.Color',      model: /^(?:flux(?:-|$)|black-forest)/i },
]

/** 检查 modelIcon 是否就是品牌名（如 'Anthropic'、'OpenAI'），若是则视为错配，用产品图标替代 */
function resolveIcon(modelIcon: string | null | undefined, brand: { name: string; id: string; icon: string }): string {
  const raw = modelIcon?.trim() || null
  if (!raw) return brand.icon
  const lower = raw.toLowerCase()
  if (lower === brand.id || lower === brand.name.toLowerCase()) return brand.icon
  return raw
}

export function resolveModelVendor(model: PricingModel, vendors: Vendor[], other: string): ModelVendor {
  const vendor = vendors.find((v) => v.id === model.vendor_id)

  // 1. 按模型名匹配已知品牌
  const byName = brands.find((b) => b.model.test(model.model_name.trim()))
  if (byName) return { id: `brand:${byName.id}`, name: byName.name, icon: resolveIcon(model.icon, byName) }

  // 2. 厂商名能匹配已知品牌（后端可能配了厂商但模型名不规范）
  if (vendor) {
    const byVendorName = brands.find((b) => b.name === vendor.name || b.id === vendor.name.toLowerCase())
    if (byVendorName) return { id: `brand:${byVendorName.id}`, name: byVendorName.name, icon: resolveIcon(model.icon, byVendorName) }
    // 3. 有后端 vendor 但未知品牌
    return { id: `vendor:${vendor.id}`, name: vendor.name, icon: vendor.icon || model.icon || null }
  }

  // 4. 无 vendor 且无法识别：统一归入同一"其他"桶，避免筛选面板出现重复条目
  return { id: 'vendor:other', name: other, icon: model.icon || null }
}
