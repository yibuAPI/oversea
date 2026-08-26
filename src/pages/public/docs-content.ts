/**
 * 文档站内容模型 —— /docs 的目录树与每页内容都从这里生成。
 *
 * 为什么不放 i18n：文档是「页 × 区块」的树，塞进扁平 key 里维护性极差；
 * 这里按 locale 二选一生成，动态值（基址 / 示例模型 / 站名）由调用方注入，
 * 保证文档里的代码复制即可用 —— 绝不写死示例域名。
 */

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h2'; id: string; text: string }
  | { type: 'list'; items: { strong?: string; text: string }[] }
  | { type: 'cards'; items: { title: string; desc: string; meta?: string }[] }
  | { type: 'code'; tabs: { key: string; label: string; code: string }[] }
  | { type: 'rows'; mono?: boolean; items: { a: string; b: string; c?: string }[] }
  | { type: 'callout'; tone: 'info' | 'warning'; text: string }
  | { type: 'link'; to: string; label: string }

export interface DocPage {
  key: string
  title: string
  emoji?: string
  subtitle?: string
  /** 仅首页有品牌渐变横幅 */
  banner?: boolean
  blocks: Block[]
  /** 子页 key（渲染成目录里的缩进项） */
  children?: string[]
}

export interface DocGroup {
  key: string
  title: string
  items: string[]
}

export interface DocsCtx {
  zh: boolean
  base: string
  model: string
  name: string
  faq: { q: string; a: string }[]
}

export interface DocsTree {
  groups: DocGroup[]
  pages: Record<string, DocPage>
  /** 侧栏顺序展平，供上一页/下一页用 */
  order: string[]
}

export function buildDocs(ctx: DocsCtx): DocsTree {
  const { zh, base, model, name } = ctx

  const chatSnippets: Block = {
    type: 'code',
    tabs: [
      {
        key: 'curl',
        label: 'cURL',
        code: `curl ${base}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ONESTEP_API_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'`,
      },
      {
        key: 'python',
        label: 'Python (openai)',
        code: `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["ONESTEP_API_KEY"],
    base_url="${base}/v1",
)

completion = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(completion.choices[0].message.content)`,
      },
      {
        key: 'node',
        label: 'Node.js',
        code: `import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.ONESTEP_API_KEY,
  baseURL: '${base}/v1',
})

const completion = await client.chat.completions.create({
  model: '${model}',
  messages: [{ role: 'user', content: 'Hello!' }],
})

console.log(completion.choices[0].message.content)`,
      },
    ],
  }

  const pages: Record<string, DocPage> = {
    // ─────────────── 概览 ───────────────
    quickstart: {
      key: 'quickstart',
      emoji: '👋',
      title: zh ? '快速开始' : 'Quickstart',
      subtitle: zh ? `开始使用 ${name}` : `Get started with ${name}`,
      banner: true,
      children: ['text', 'image', 'audio', 'embedding'],
      blocks: [
        {
          type: 'p',
          text: zh
            ? `${name} 提供统一的 OpenAI 兼容接口：一把密钥即可调用全部主流大模型 —— 对话、绘图、语音、向量，统一计费、统一额度管理。把 base_url 换成下方地址即可开始。`
            : `${name} provides one OpenAI-compatible API for every major model — chat, image, audio and embeddings, with unified billing and quota management. Point base_url at the address below and start calling.`,
        },
        { type: 'h2', id: 'capabilities', text: zh ? '能力总览' : 'Capabilities' },
        {
          type: 'cards',
          items: [
            {
              title: zh ? '文本生成' : 'Text Generation',
              desc: zh
                ? '对话补全与流式输出，覆盖全部主流对话模型。'
                : 'Chat completions with streaming, across every major chat model.',
              meta: 'POST /v1/chat/completions',
            },
            {
              title: zh ? '图像生成' : 'Image Generation',
              desc: zh
                ? '文生图与图生图，支持多个图像模型。'
                : 'Text-to-image and image editing with multiple image models.',
              meta: 'POST /v1/images/generations',
            },
            {
              title: zh ? '语音' : 'Audio',
              desc: zh ? '语音合成与语音转写。' : 'Speech synthesis and transcription.',
              meta: '/v1/audio/speech · /v1/audio/transcriptions',
            },
            {
              title: zh ? '向量' : 'Embeddings',
              desc: zh
                ? '文本向量化，用于检索与 RAG。'
                : 'Text embeddings for search and RAG.',
              meta: 'POST /v1/embeddings',
            },
            {
              title: zh ? '流式输出' : 'Streaming',
              desc: zh
                ? 'SSE 逐 token 返回，接口层与 OpenAI 协议完全一致。'
                : 'Token-by-token SSE responses, fully OpenAI-protocol compatible.',
              meta: '"stream": true',
            },
            {
              title: zh ? '模型列表' : 'Model List',
              desc: zh
                ? '实时拉取当前可用模型，无需硬编码。'
                : 'Fetch currently available models at runtime — no hardcoding.',
              meta: 'GET /v1/models',
            },
          ],
        },
        { type: 'h2', id: 'base-url', text: zh ? '接口基址' : 'Base URL' },
        {
          type: 'code',
          tabs: [{ key: 'base', label: 'Base URL', code: `${base}/v1` }],
        },
        {
          type: 'p',
          text: zh
            ? '所有 OpenAI SDK / 兼容工具都可直接使用，只需替换 base_url 与 api_key，业务代码零改动。'
            : 'Any OpenAI SDK or compatible tool works out of the box — swap base_url and api_key, keep your code unchanged.',
        },
        { type: 'h2', id: 'first-call', text: zh ? '第一次调用' : 'Your first call' },
        chatSnippets,
        {
          type: 'callout',
          tone: 'warning',
          text: zh
            ? '密钥等同于账号密码，请勿提交到代码仓库或暴露在前端页面。泄露后请立即到控制台「API 密钥」页删除并重建。'
            : 'API keys are credentials. Never commit them to a repository or expose them in frontend code. If a key leaks, delete and recreate it in the console immediately.',
        },
        {
          type: 'p',
          text: zh
            ? `示例中的模型 ${model} 取自当前在售模型列表，可在「模型库」查看全部可用模型与价格。`
            : `The model ${model} in the examples is taken from the live catalog — browse all available models and prices in the model library.`,
        },
        { type: 'link', to: '/models', label: zh ? '浏览模型库' : 'Browse the model library' },
      ],
    },

    text: {
      key: 'text',
      title: zh ? '文本生成' : 'Text',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '对话补全是最常用的接口，与 OpenAI Chat Completions 协议完全一致：传 model 与 messages，同步返回或流式返回。'
            : 'Chat completions follow the OpenAI protocol exactly: send model and messages, receive a full response or a stream.',
        },
        chatSnippets,
        { type: 'h2', id: 'stream', text: zh ? '流式输出' : 'Streaming' },
        {
          type: 'code',
          tabs: [
            {
              key: 'stream',
              label: 'JSON',
              code: `{
  "model": "${model}",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true
}`,
            },
          ],
        },
        {
          type: 'p',
          text: zh
            ? '加上 "stream": true 后响应以 SSE 逐块返回，以 data: [DONE] 结束。'
            : 'With "stream": true the response arrives as SSE chunks, terminated by data: [DONE].',
        },
      ],
    },

    image: {
      key: 'image',
      title: zh ? '图像生成' : 'Image',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '图像生成走 /v1/images/generations，传提示词与尺寸，返回图片 URL 或 base64。可用的图像模型见模型库的「绘画」标签。'
            : 'Image generation uses /v1/images/generations: send a prompt and size, get back a URL or base64. See models tagged for image in the library.',
        },
        {
          type: 'code',
          tabs: [
            {
              key: 'curl',
              label: 'cURL',
              code: `curl ${base}/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ONESTEP_API_KEY" \\
  -d '{
    "model": "<image-model>",
    "prompt": "A watercolor lighthouse at dawn",
    "size": "1024x1024"
  }'`,
            },
          ],
        },
      ],
    },

    audio: {
      key: 'audio',
      title: zh ? '语音' : 'Audio',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '语音包含两个方向：合成（文字 → 语音）与转写（语音 → 文字），均与 OpenAI Audio 协议一致。'
            : 'Audio covers both directions — synthesis (text → speech) and transcription (speech → text) — via the OpenAI audio protocol.',
        },
        {
          type: 'code',
          tabs: [
            {
              key: 'speech',
              label: zh ? '合成' : 'Speech',
              code: `curl ${base}/v1/audio/speech \\
  -H "Authorization: Bearer $ONESTEP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "<tts-model>", "input": "Hello!", "voice": "alloy" }' \\
  --output out.mp3`,
            },
            {
              key: 'stt',
              label: zh ? '转写' : 'Transcription',
              code: `curl ${base}/v1/audio/transcriptions \\
  -H "Authorization: Bearer $ONESTEP_API_KEY" \\
  -F model="<stt-model>" \\
  -F file="@audio.mp3"`,
            },
          ],
        },
      ],
    },

    embedding: {
      key: 'embedding',
      title: zh ? '向量' : 'Embedding',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '向量接口把文本编码为定长向量，用于语义检索、聚类与 RAG。'
            : 'The embeddings endpoint encodes text into fixed-length vectors for semantic search, clustering and RAG.',
        },
        {
          type: 'code',
          tabs: [
            {
              key: 'curl',
              label: 'cURL',
              code: `curl ${base}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ONESTEP_API_KEY" \\
  -d '{ "model": "<embedding-model>", "input": "The quick brown fox" }'`,
            },
          ],
        },
      ],
    },

    platform: {
      key: 'platform',
      title: zh ? '平台总览' : 'Platform Overview',
      blocks: [
        {
          type: 'p',
          text: zh
            ? `${name} 是一个大模型 API 聚合平台：把主流厂商的模型能力聚合到一个 OpenAI 兼容接口之后，统一鉴权、统一计费、统一额度管理。`
            : `${name} is an LLM API gateway: models from major vendors, aggregated behind one OpenAI-compatible endpoint with unified auth, billing and quota management.`,
        },
        {
          type: 'list',
          items: [
            {
              strong: zh ? '统一接口' : 'One endpoint',
              text: zh
                ? '一把密钥调用全部模型，切换模型只改 model 字段。'
                : 'one key for every model; switching models is a one-field change.',
            },
            {
              strong: zh ? '统一计费' : 'One bill',
              text: zh
                ? '按 token 实时结算，每次调用的扣费在控制台日志中可逐条对账。'
                : 'real-time token billing; every call is itemized in the console logs.',
            },
            {
              strong: zh ? '额度管理' : 'Quota control',
              text: zh
                ? '每把密钥可单独设置额度上限与可用模型，适合分发给团队或子系统。'
                : 'per-key quota caps and model allowlists — safe to hand out to teams and services.',
            },
          ],
        },
        { type: 'link', to: '/console', label: zh ? '进入控制台' : 'Open the console' },
      ],
    },

    faq: {
      key: 'faq',
      title: 'FAQ',
      blocks: [
        {
          type: 'p',
          text: zh ? '最常被问到的几个问题。' : 'The questions we hear most often.',
        },
        ...ctx.faq.flatMap((f, i): Block[] => [
          { type: 'h2', id: `faq-${i}`, text: f.q },
          { type: 'p', text: f.a },
        ]),
      ],
    },

    'pricing-structure': {
      key: 'pricing-structure',
      title: zh ? '价格与费用结构' : 'Pricing and Fee Structure',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '按用量计费，价格全部透明 —— 无月费、无最低消费，充值即用。'
            : 'Usage-based and fully transparent — no monthly fee, no minimum spend. Top up and go.',
        },
        { type: 'h2', id: 'model', text: zh ? '计费模式' : 'Pricing model' },
        {
          type: 'list',
          items: [
            {
              strong: zh ? '按量计费' : 'Usage-based pricing',
              text: zh
                ? '只为实际用掉的 token 付费，余额永不过期。'
                : 'pay only for the tokens you actually use; balance never expires.',
            },
            {
              strong: zh ? '按模型定价' : 'Per-model pricing',
              text: zh
                ? '每个模型有独立单价，价目表实时同步计费系统。'
                : 'each model has its own rate, synced live from billing.',
            },
            {
              strong: zh ? '无需订阅' : 'No subscription required',
              text: zh
                ? '没有月费和套餐门槛，充值即可调用全部模型。'
                : 'no monthly tiers — top up credits and call any model.',
            },
          ],
        },
        { type: 'h2', id: 'notes', text: zh ? '结算说明' : 'Important notes' },
        {
          type: 'list',
          items: [
            {
              text: zh
                ? '价格单位为美元 / 百万 token；按次计费的模型按单次调用价结算。'
                : 'Prices are in USD per million tokens; per-call models are billed per invocation.',
            },
            {
              text: zh
                ? '价格随上游厂商调整实时更新，以调用发生时页面公示的价格结算。'
                : 'Rates update in real time with upstream changes; you are billed at the rate shown when the call is made.',
            },
          ],
        },
      ],
    },

    // ─────────────── 接入 ───────────────
    auth: {
      key: 'auth',
      title: zh ? '鉴权' : 'Authentication',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '所有请求在 Authorization 头中携带 Bearer 密钥。密钥在控制台「API 密钥」页创建，可为每把密钥单独设置额度与可用模型。'
            : 'Every request carries a Bearer key in the Authorization header. Create keys in the console — each key can have its own quota cap and model allowlist.',
        },
        {
          type: 'code',
          tabs: [
            {
              key: 'header',
              label: 'HTTP Header',
              code: 'Authorization: Bearer sk-xxxxxxxxxxxxxxxx',
            },
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          text: zh
            ? '密钥泄露等于余额泄露。请通过环境变量注入密钥，泄露后立即在控制台删除重建。'
            : 'A leaked key is leaked balance. Inject keys via environment variables, and rotate immediately in the console if one leaks.',
        },
      ],
    },

    endpoints: {
      key: 'endpoints',
      title: zh ? '接口列表' : 'Endpoints',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '完整兼容 OpenAI 协议，常用接口如下：'
            : 'Fully OpenAI-compatible. The endpoints you will use most:',
        },
        {
          type: 'rows',
          mono: true,
          items: [
            { a: 'POST', b: '/v1/chat/completions', c: zh ? '对话补全' : 'Chat completions' },
            { a: 'POST', b: '/v1/embeddings', c: zh ? '向量' : 'Embeddings' },
            { a: 'POST', b: '/v1/images/generations', c: zh ? '图像生成' : 'Image generation' },
            { a: 'POST', b: '/v1/audio/speech', c: zh ? '语音合成' : 'Speech synthesis' },
            { a: 'POST', b: '/v1/audio/transcriptions', c: zh ? '语音转写' : 'Transcription' },
            { a: 'GET', b: '/v1/models', c: zh ? '模型列表' : 'Model list' },
          ],
        },
      ],
    },

    streaming: {
      key: 'streaming',
      title: zh ? '流式输出' : 'Streaming',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '在请求体中加 "stream": true，响应以 SSE 逐块返回，以 data: [DONE] 结束。所有 OpenAI SDK 的流式用法可直接照搬。'
            : 'Add "stream": true to the request body and the response arrives as SSE chunks, ending with data: [DONE]. All OpenAI SDK streaming patterns work unchanged.',
        },
        {
          type: 'code',
          tabs: [
            {
              key: 'json',
              label: 'JSON',
              code: `{
  "model": "${model}",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true
}`,
            },
            {
              key: 'python',
              label: 'Python (openai)',
              code: `stream = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="")`,
            },
          ],
        },
      ],
    },

    errors: {
      key: 'errors',
      title: zh ? '错误码' : 'Error Codes',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '错误以 HTTP 状态码 + JSON 消息体返回：'
            : 'Errors come back as an HTTP status code plus a JSON message body:',
        },
        {
          type: 'rows',
          mono: true,
          items: [
            { a: '401', b: zh ? '密钥无效、缺失或已被禁用' : 'Key invalid, missing or disabled' },
            { a: '403', b: zh ? '密钥无权访问该模型或分组' : 'Key lacks access to the model or group' },
            { a: '404', b: zh ? '模型不存在或未对当前分组开放' : 'Model not found or not enabled for this group' },
            { a: '429', b: zh ? '触发限流，请降低并发后重试' : 'Rate limited — back off and retry' },
            { a: '500', b: zh ? '上游或服务器错误，请稍后重试' : 'Upstream or server error — retry later' },
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          text: zh
            ? '排障时带上响应里的调用 ID 提交工单，我们可以直接定位到具体渠道与原始返回。'
            : 'When filing a support ticket, include the request ID from the response — it lets us trace the exact upstream channel and raw response.',
        },
      ],
    },

    limits: {
      key: 'limits',
      title: zh ? '限流与额度' : 'Rate Limits & Quota',
      blocks: [
        {
          type: 'p',
          text: zh
            ? '每把密钥可单独设置额度上限与可用模型；不同分组的计费倍率不同。触发 429 时按响应头 Retry-After 退避重试。'
            : 'Each key has its own quota cap and model allowlist; billing ratios vary by group. On 429, back off per the Retry-After response header.',
        },
        { type: 'link', to: '/console/limits', label: zh ? '在控制台管理额度' : 'Manage quota in the console' },
      ],
    },
  }

  const groups: DocGroup[] = [
    {
      key: 'overview',
      title: zh ? '概览' : 'OVERVIEW',
      items: ['quickstart', 'platform', 'faq', 'pricing-structure'],
    },
    {
      key: 'integrate',
      title: zh ? '接入' : 'INTEGRATION',
      items: ['auth', 'endpoints', 'streaming'],
    },
    {
      key: 'reference',
      title: zh ? '参考' : 'REFERENCE',
      items: ['errors', 'limits'],
    },
  ]

  /** 展平顺序：quickstart 的子页跟在它后面 */
  const order: string[] = []
  for (const g of groups)
    for (const k of g.items) {
      order.push(k)
      for (const c of pages[k]?.children ?? []) order.push(c)
    }

  return { groups, pages, order }
}
