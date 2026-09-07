import type { PricingModel, Vendor } from '../api/types'

interface ModelVendor {
  id: string
  name: string
  icon: string | null
}

const brands = [
  {
    id: 'openai', name: 'OpenAI', icon: 'OpenAI',
    model: /^(?:openai\/)?(?:gpt-\d|chatgpt(?:-|$)|o[134](?:-|$)|dall-e(?:-|$)|whisper(?:-|$)|tts-\d|text-embedding-(?:ada-002|3-))/i,
  },
  {
    id: 'anthropic', name: 'Anthropic', icon: 'Claude.Color',
    model: /^(?:anthropic\/)?claude(?:-|$)/i,
  },
]

export function resolveModelVendor(model: PricingModel, vendors: Vendor[], other: string): ModelVendor {
  const vendor = vendors.find((v) => v.id === model.vendor_id)
  // 明确的模型族优先于可能配置错误的厂商 ID；自定义别名保留后端归属。
  const brand = brands.find((b) => b.model.test(model.model_name.trim()))
    ?? brands.find((b) => b.name.toLowerCase() === vendor?.name.trim().toLowerCase())
  if (brand) {
    // 名称统一用原厂。图标：模型自身配置优先，但若与品牌名完全相同（如后台配成了 'Anthropic'
    // 而非产品图标 'Claude.Color'）则视为错配，改用品牌兜底产品图标。
    const modelIcon = model.icon?.trim() || null
    const icon = modelIcon && modelIcon.toLowerCase() !== brand.id && modelIcon.toLowerCase() !== brand.name.toLowerCase() ? modelIcon : brand.icon
    return { id: `brand:${brand.id}`, name: brand.name, icon }
  }
  return {
    id: `vendor:${model.vendor_id ?? 'other'}`,
    name: vendor?.name || other,
    icon: vendor?.icon || model.icon || null,
  }
}
