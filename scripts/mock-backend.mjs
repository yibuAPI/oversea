// 临时验证用 —— 模拟 New API 的 /api/status 响应体，
// 用于在不启动真实后端（不碰数据库）的前提下验证 proxy + 解包 + store 全链路。
// 验证完即可删除。
import { createServer } from 'node:http'

createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url?.startsWith('/api/status')) {
    res.end(
      JSON.stringify({
        success: true,
        message: '',
        data: {
          system_name: 'llmuni',
          logo: '',
          version: 'v0.9.9-mock',
          register_enabled: true,
          password_login_enabled: true,
          quota_per_unit: 500000,
          display_in_currency: true,
          github_oauth: true,
          email_verification: false,
        },
      }),
    )
    return
  }
  if (req.url?.startsWith('/api/user/self')) {
    // 未登录 —— 与真实后端一致返回 success:false
    res.statusCode = 401
    res.end(JSON.stringify({ success: false, message: '无权进行此操作，未登录且未提供 access token' }))
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ success: false, message: 'not found' }))
}).listen(3000, () => console.log('mock backend on :3000'))
